// @input -- authenticated user, exact versioned selection IDs, and server-owned readers
// @output -- shared GEO Brief, with all immutable reads complete before quota/model work
// @pos -- called by the existing route; legacy unversioned requests remain readable
import { GEO_CONTENT_BRIEF_SCHEMA, geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";
import { parseGeoContentBriefShape } from "@sf/public-tools/content-brief/parse-geo-brief";
import { privateError, privateJson } from "../account-websites/route-http.ts";
import type { VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import type { AnyGeoSnapshotContext } from "./snapshot-context-v2.ts";
import type { BriefStoreOutcome } from "./brief-handler.ts";
import { assembleSharedGeoBrief, sharedGeoBriefBasis, type SharedBriefRunEvidence } from "./brief-shared.ts";
import type { runSharedGeoBriefLlm } from "./brief-shared-llm.ts";
import { assessGeoQuestionQuality, geoQuestionLanguageIssue, geoQuestionProperNames } from "./question-quality.ts";

export interface SharedBriefHandlerDependencies {
  readonly readFrozen: (input: { userId: string; kbId: string; snapshotId: string }) => Promise<BriefStoreOutcome<VersionedGeoKbFrozenSnapshot>>;
  readonly readContext: (input: { userId: string; kbId: string; snapshotId: string }) => Promise<BriefStoreOutcome<AnyGeoSnapshotContext | null>>;
  readonly readRunEvidence: (input: { userId: string; runId: string; gapId: string; questionId: string; frozen: VersionedGeoKbFrozenSnapshot }) => Promise<BriefStoreOutcome<SharedBriefRunEvidence> | { kind: "not_eligible" }>;
  readonly configured: () => boolean;
  readonly assemble: typeof runSharedGeoBriefLlm;
  readonly runId: () => string;
}
export interface SharedBriefSelection { schema: typeof GEO_CONTENT_BRIEF_SCHEMA; kbId: string; snapshotId: string; questionId: string | null; manualQuestion: string | null; runId: string | null; gapId: string | null }
export function parseSharedBriefSelection(raw: unknown): SharedBriefSelection | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const keys = ["schema", "kbId", "snapshotId", "questionId", "manualQuestion", "runId", "gapId"];
  if (Object.keys(row).length !== keys.length || !Object.keys(row).every(key => keys.includes(key)) || row.schema !== GEO_CONTENT_BRIEF_SCHEMA) return null;
  for (const key of ["kbId", "snapshotId"]) if (typeof row[key] !== "string" || !row[key].length || row[key].length > 200) return null;
  for (const key of ["questionId", "runId", "gapId"]) if (row[key] !== null && (typeof row[key] !== "string" || !row[key].length || row[key].length > 200)) return null;
  if (row.questionId === null ? typeof row.manualQuestion !== "string" || !row.manualQuestion.trim() || row.manualQuestion.length > 300 : row.manualQuestion !== null) return null;
  if ((row.runId === null) !== (row.gapId === null) || (row.runId !== null && row.questionId === null)) return null;
  return row as unknown as SharedBriefSelection;
}
export async function runSharedBrief(userId: string, raw: unknown, deps: SharedBriefHandlerDependencies | undefined, consume: (userId: string) => Promise<boolean>, now: () => number): Promise<Response> {
  const selection = parseSharedBriefSelection(raw);
  if (selection === null) return privateError("invalid_request", 400);
  if (deps === undefined) return privateError("store_unavailable", 503);
  const input = { userId, kbId: selection.kbId, snapshotId: selection.snapshotId };
  const frozen = await deps.readFrozen(input);
  if (frozen.kind === "unavailable") return privateError("store_unavailable", 503);
  if (frozen.kind !== "ok" || frozen.value.kbId !== selection.kbId || frozen.value.snapshotId !== selection.snapshotId) return privateError("not_found", 404);
  if (geoGenerationLanguage(frozen.value.payload.market.language) === null) return privateError("unsupported_language", 422);
  if (selection.questionId !== null && !frozen.value.questionSet.questions.some(question => question.id === selection.questionId)) return privateError("not_found", 404);
  const picked = frozen.value.questionSet.questions.find(question => question.id === selection.questionId);
  const questionInvalid = picked
    ? !assessGeoQuestionQuality(frozen.value.payload, picked).ok
    : geoQuestionLanguageIssue(selection.manualQuestion ?? "", frozen.value.payload.market.language, geoQuestionProperNames(frozen.value.payload));
  if (questionInvalid) return privateError("question_needs_review", 422);
  const context = await deps.readContext(input);
  if (context.kind !== "ok") return privateError("store_unavailable", 503);
  let evidence: SharedBriefRunEvidence | null = null;
  if (selection.runId !== null && selection.gapId !== null && selection.questionId !== null) {
    const resolved = await deps.readRunEvidence({ userId, runId: selection.runId, gapId: selection.gapId, questionId: selection.questionId, frozen: frozen.value });
    if (resolved.kind === "not_eligible") return privateError("gap_not_eligible", 422);
    if (resolved.kind === "not_found") return privateError("not_found", 404);
    if (resolved.kind !== "ok") return privateError("run_evidence_unavailable", 503);
    if (resolved.value.runId !== selection.runId) return privateError("run_evidence_unavailable", 503);
    evidence = resolved.value;
  }
  const start = now();
  let basis;
  try { basis = sharedGeoBriefBasis({ frozen: frozen.value, context: context.value, questionId: selection.questionId, questionText: selection.manualQuestion?.trim() ?? "", runEvidence: evidence, runId: deps.runId(), now: new Date(start).toISOString() }); } catch { return privateError("store_unavailable", 503); }
  if (!parseGeoContentBriefShape(basis).ok) return privateError("brief_unavailable", 422);
  if (!deps.configured()) return privateError("provider_unconfigured", 503);
  if (!await consume(userId)) return privateJson({ error: { code: "daily_limit" }, limit: 20 }, 429);
  const reply = await deps.assemble(basis, { properNames: geoQuestionProperNames(frozen.value.payload) });
  basis.run.elapsed_ms = Math.max(0, now() - start);
  const brief = await assembleSharedGeoBrief(basis, reply);
  return privateJson({ data: { brief } });
}
