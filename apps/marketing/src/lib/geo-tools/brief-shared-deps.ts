// @input -- authenticated owner and immutable selection IDs
// @output -- actual frozen/context/run evidence for the shared Brief route
// @pos -- no browser metrics or pasted fingerprints acquire server trust here
import { randomUUID } from "node:crypto";
import { canonicalize, fingerprintCanonical } from "@sf/public-tools/content-brief/canonical";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { readFrozenGeoKb } from "./kb-store.ts";
import { readGeoSnapshotContext } from "./asset-context-store.ts";
import { resolveOwnedVisibilityGap } from "./owned-gap.ts";
import { resolveGeoBriefLlmConfig } from "./brief-llm.ts";
import { runSharedGeoBriefLlm } from "./brief-shared-llm.ts";
import type { SharedBriefHandlerDependencies } from "./brief-shared-handler.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";

export async function resolveSharedBriefRunEvidence(input: Parameters<SharedBriefHandlerDependencies["readRunEvidence"]>[0], deps = { resolveGap: resolveOwnedVisibilityGap }): ReturnType<SharedBriefHandlerDependencies["readRunEvidence"]> {
  const resolved = await deps.resolveGap({ userId: input.userId, runId: input.runId, gapId: input.gapId, questionId: input.questionId, snapshotId: input.frozen.snapshotId });
  if (resolved.kind === "missing") return { kind: "not_found" };
  if (resolved.kind === "not_eligible") return { kind: "not_eligible" };
  if (resolved.kind !== "ok") return { kind: "unavailable", reason: "run_unavailable" };
  const { report, gap, siteEvidence } = resolved.value;
  const manifest = report.manifest;
  if (report.context.targetHost !== normalizeGeoHost(input.frozen.payload.targetUrl) || siteEvidence.index.targetHost !== report.context.targetHost) return { kind: "unavailable", reason: "run_site_mismatch" };
  const frozenQuestion = input.frozen.questionSet.questions.find(question => question.id === input.questionId);
  const question = report.questions.find(row => row.questionId === input.questionId);
  if (manifest.kbId !== input.frozen.kbId || manifest.snapshotId !== input.frozen.snapshotId || manifest.snapshotRevision !== input.frozen.revision || manifest.questionSetHash !== input.frozen.questionSetHash || manifest.marketCode !== input.frozen.payload.market.country || manifest.language !== input.frozen.payload.market.language || frozenQuestion === undefined || question === undefined || canonicalize(question.definition) !== canonicalize(frozenQuestion)) return { kind: "unavailable", reason: "run_snapshot_mismatch" };
  const samples: GeoContentBrief["evidence"]["samples"] = [];
  for (const sample of question.samples) {
    if (sample.status === "ok" && (sample.answerExcerpt === null || sample.subtopics === null || sample.subtopicsOmitted !== 0 || sample.observedAt === null)) return { kind: "unavailable", reason: "run_evidence_incomplete" };
    samples.push({ id: sample.slotId, run_id: manifest.runId, question_id: question.questionId, engine: sample.engine, collected_at: sample.observedAt ?? manifest.finishedAt, status: sample.status === "ok" ? "answered" : "failed", search_enabled: sample.webSearchPerformed, excerpt: sample.status === "ok" ? sample.answerExcerpt ?? "" : "", topics: sample.status === "ok" ? [...sample.subtopics ?? []] : [] });
  }
  if (!samples.length) return { kind: "unavailable", reason: "run_evidence_missing" };
  const pages = siteEvidence.index.pages.filter(page => page.state === "read" && page.finalUrl !== null && page.matches.some(match => match.questionId === input.questionId));
  return { kind: "ok", value: { runId: manifest.runId, fingerprint: await fingerprintCanonical(report), gap: gap.kind, samples, siteIndex: pages.map(page => ({ id: page.id, url: page.finalUrl!, title: page.title ?? "", observed_at: page.fetchedAt })) } };
}
export const DEFAULT_SHARED_BRIEF_DEPENDENCIES: SharedBriefHandlerDependencies = {
  readFrozen: async input => { const value = await readFrozenGeoKb(input); return value.kind === "ok" ? value : value.kind === "missing" ? { kind: "not_found" } : { kind: "unavailable", reason: "snapshot_unavailable" }; },
  readContext: async input => { const value = await readGeoSnapshotContext(input); return value.kind === "ok" ? value : { kind: "unavailable", reason: "context_unavailable" }; },
  readRunEvidence: resolveSharedBriefRunEvidence,
  configured: () => resolveGeoBriefLlmConfig() !== null,
  assemble: runSharedGeoBriefLlm,
  runId: randomUUID,
};
