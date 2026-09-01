// Local-only evidence. All reports originate in the real measurement builders;
// account/store/provider dependencies are deterministic and never use a service.
import type { WebsiteDetails } from "../src/lib/account-websites/contracts.ts";
import type { GeoKbSummary } from "../src/lib/geo-tools/kb-store.ts";
import type { VisibilityContextDependencies } from "../src/lib/geo-tools/visibility-context-handler.ts";
import type { VisibilityHistoryDependencies } from "../src/lib/geo-tools/visibility-history.ts";
import { createVisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2.ts";
import type { VisibilityReportV2, VisibilitySampleV2 } from "../src/lib/geo-tools/visibility-v2-contract.ts";
import { encodeVisibilityWire } from "../src/lib/geo-tools/visibility-wire.ts";
import { createGeoChainFixture, GEO_CHAIN_USER, GEO_CHAIN_NOW } from "./geo-chain-fixtures.ts";

export const ARTIFACT_CURRENT_RUN = "33333333-3333-4333-8333-333333333331";
export const ARTIFACT_PREVIOUS_RUN = "33333333-3333-4333-8333-333333333332";
export const ARTIFACT_LEGACY_RUN = "33333333-3333-4333-8333-333333333333";
export const ARTIFACT_UNKNOWN_RUN = "33333333-3333-4333-8333-333333333339";
export const ARTIFACT_UNREADY_SITE = "33333333-3333-4333-8333-333333333334";

export function visibilityHistoryRow(report: VisibilityReportV2) {
  const m = report.manifest;
  return { id: m.runId, user_id: GEO_CHAIN_USER, kb_id: m.kbId, snapshot_id: m.snapshotId,
    question_set_hash: m.questionSetHash, created_at: m.finishedAt, manifest: m,
    context: report.context, report: encodeVisibilityWire(report) };
}

export async function createVisibilityArtifactFixture(outcome: "ok" | "partial" | "insufficient" = "ok") {
  const chain = createGeoChainFixture("D");
  await chain.kbDependencies.freeze({ userId: GEO_CHAIN_USER, kbId: chain.frozen.kbId,
    baseVersion: 1, questionSet: chain.frozen.questionSet, context: chain.context });
  const source = await chain.run(["chatgpt", "perplexity"], 3);
  const observed = source.questions.flatMap(question => question.samples);
  // The omission is a storage-budget state, not a negative observation. The
  // original answer and mention scalar remain unchanged, exactly as production.
  const samples: VisibilitySampleV2[] = observed.map((sample, index) => {
    const failed = sample.engine === "perplexity" && (outcome === "insufficient" || outcome === "partial" && sample.sampleIndex === 3);
    if (failed) return { ...sample, status: "timeout", webSearchPerformed: null, mentioned: false, cited: null,
      competitorsMentioned: [], citedUrls: [], citedDomains: [], excerpt: null, excerptOmitted: false,
      answerExcerpt: null, answerExcerptTruncated: null, subtopics: null, subtopicsOmitted: null,
      competitorPositions: null, listPosition: null, modelObserved: null, providerTaskId: null,
      costUsd: null, observedAt: null, citedDomainsOmitted: null, citedUrlsOmitted: null };
    return index === 0 ? { ...sample, excerpt: null, excerptOmitted: true } : sample;
  });
  const input = { ...source.manifest, context: source.context,
    questions: source.questions.map(question => question.definition), samples,
    engines: source.manifest.engines.map(engine => engine.engine) };
  const current = { ...createVisibilityReportV2({ ...input, runId: ARTIFACT_CURRENT_RUN }),
    limits: [...source.limits, "answerEvidenceTruncated"] };
  const previous = { ...createVisibilityReportV2({ ...input, runId: ARTIFACT_PREVIOUS_RUN,
    startedAt: "2026-08-30T01:00:00.000Z", finishedAt: "2026-08-30T02:00:00.000Z" }),
    limits: [...source.limits, "answerEvidenceTruncated"] };
  const firstQuestion = current.questions[0]!;
  const legacyManifest = { schemaVersion: "marketing-geo-visibility.v1", kbId: input.kbId,
    snapshotId: input.snapshotId, snapshotRevision: input.snapshotRevision, questionSetHash: input.questionSetHash,
    questionCount: current.questions.length, samplesPerQuestion: 3, marketCode: "US", model: "gpt-5-2025-08-07",
    surface: "dataforseo_chat_gpt_llm_responses_api", startedAt: "2026-08-29T01:00:00.000Z",
    finishedAt: "2026-08-29T02:00:00.000Z", calls: current.questions.length * 3,
    answered: current.questions.length * 3, successRatio: 1, costUsd: null, status: "ok" };
  const single = current.byEngine[0]!;
  const legacy = { id: ARTIFACT_LEGACY_RUN, user_id: GEO_CHAIN_USER, kb_id: input.kbId,
    snapshot_id: input.snapshotId, question_set_hash: input.questionSetHash, samples_per_question: 3,
    created_at: legacyManifest.finishedAt, manifest: legacyManifest,
    metrics: { unpromptedMention: single.metrics.unpromptedMention, promptedMention: single.metrics.promptedMention,
      citation: single.metrics.citation, questionsMentioned: single.metrics.questionsMentioned,
      questionsCited: single.metrics.questionsCited, questionsAsked: single.metrics.questionsAsked,
      questionsAnswered: single.metrics.questionsAnswered,
      byLayer: single.metrics.byLayer.map(({ layer, mention, citation }) => ({ layer, mention, citation })) },
    per_question: single.questions.map(({ questionId, text, layer, mode, prompted, answered, mentioned, citationEvaluable, cited }) =>
      ({ questionId, text, layer, mode, prompted, answered, mentioned, citationEvaluable, cited })),
    cited_domains: single.citedDomains };
  const unready: WebsiteDetails = { ...chain.website, websiteId: ARTIFACT_UNREADY_SITE,
    submittedUrl: "https://unready.test/", origin: "https://unready.test", host: "unready.test",
    canonicalSiteKey: "unready.test", displayName: "Awaiting profile", isPrimary: false,
    profileState: "not_generated", confirmedSnapshotId: null, confirmedSnapshotRevision: null,
    confirmedAt: null, draft: null, currentConfirmedSnapshot: null };
  const websites = [chain.website, unready];
  const kb: GeoKbSummary = { kbId: chain.frozen.kbId, origin: chain.website.origin,
    host: chain.website.host, canonicalSiteKey: chain.website.canonicalSiteKey,
    createdAt: GEO_CHAIN_NOW, updatedAt: GEO_CHAIN_NOW,
    draft: { draftVersion: 1, contentHash: chain.context.payloadHash, updatedAt: GEO_CHAIN_NOW },
    frozen: chain.frozen };
  const contextDependencies: VisibilityContextDependencies = {
    authenticate: chain.auth,
    listWebsites: async userId => ({ kind: "ok", value: userId === GEO_CHAIN_USER ? websites : [] }),
    readWebsite: async (userId, websiteId) => {
      const website = userId === GEO_CHAIN_USER ? websites.find(site => site.websiteId === websiteId) : undefined;
      return website ? { kind: "ok", value: website } : { kind: "missing" };
    },
    listKnowledgeBases: async ({ userId }) => ({ kind: "ok", value: userId === GEO_CHAIN_USER ? [kb] : [] }),
    readFrozen: async ({ userId, kbId, snapshotId }) => userId === GEO_CHAIN_USER && kbId === chain.frozen.kbId && snapshotId === chain.frozen.snapshotId
      ? { kind: "ok", value: chain.frozen } : { kind: "missing" },
    readContext: async ({ userId, kbId, snapshotId }) => userId === GEO_CHAIN_USER && kbId === chain.frozen.kbId && snapshotId === chain.frozen.snapshotId
      ? { kind: "ok", value: chain.context } : { kind: "missing" },
  };
  const historyReads: string[] = [];
  const v2Rows = [visibilityHistoryRow(current), visibilityHistoryRow(previous)];
  const historyDependencies: VisibilityHistoryDependencies = {
    listRuns: async ({ userId, version }) => ({ kind: "ok", data: userId !== GEO_CHAIN_USER ? [] : version === "v2" ? v2Rows : [legacy] }),
    readRun: async ({ userId, version, runId }) => {
      historyReads.push(`${version}:${runId}`);
      return { kind: "ok", data: userId !== GEO_CHAIN_USER ? null : version === "v2"
        ? v2Rows.find(row => row.id === runId) ?? null : runId === ARTIFACT_LEGACY_RUN ? legacy : null };
    },
  };
  return { chain, current, previous, legacy, firstQuestion, websites, contextDependencies, historyDependencies, historyReads };
}
export type VisibilityArtifactFixture = Awaited<ReturnType<typeof createVisibilityArtifactFixture>>;
