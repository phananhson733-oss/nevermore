// @input -- unknown model JSON or public review receipts
// @output -- client-safe, strictly validated semantic-assessment contracts
// @pos -- model wording never becomes deterministic checks or verified facts
import type { CitabilityCheck } from "./citability-contract.ts";

export const CITABILITY_AI_DIMENSIONS = ["answer_relevance", "answer_clarity", "attribution_clarity"] as const;
export type CitabilityAiDimensionId = typeof CITABILITY_AI_DIMENSIONS[number];
export type CitabilityAiVerdict = "clear" | "needs_work" | "insufficient_evidence";
export interface CitabilityAiExcerpt { readonly id: string; readonly text: string }
export interface CitabilityAiEvidence {
  readonly totalBodyChars: number;
  readonly includedBodyChars: number;
  readonly coverage: "full" | "excerpt";
  readonly excerpts: readonly CitabilityAiExcerpt[];
}
export interface CitabilityAiContext extends CitabilityAiEvidence {
  readonly schemaVersion: "citability-ai-context.v1";
  readonly inputFingerprint: string;
  readonly rawSha256: string;
  readonly finalUrl: string;
  readonly question: string | null;
  readonly capturedAt: string;
  readonly checks: readonly Pick<CitabilityCheck, "ruleId" | "state" | "kind">[];
}
export interface CitabilityAiDimension {
  readonly id: CitabilityAiDimensionId;
  readonly verdict: CitabilityAiVerdict;
  readonly reason: string;
  readonly suggestion: string | null;
  readonly evidenceIds: readonly string[];
}
export interface CitabilityAiModelAssessment {
  readonly summary: string;
  readonly dimensions: readonly CitabilityAiDimension[];
}
export interface CitabilityAiReview extends CitabilityAiEvidence, CitabilityAiModelAssessment {
  readonly schemaVersion: "citability-ai-review.v1";
  readonly inputFingerprint: string;
  readonly rawSha256: string;
  readonly finalUrl: string;
  readonly targetQuestion: string | null;
  readonly capturedAt: string;
  readonly provider: "dataforseo";
  readonly requestedModel: string;
  readonly actualModel: string;
  readonly providerTaskId: string;
  readonly observedAt: string;
  readonly costUsd: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly factVerification: "not_performed";
  readonly scope: "provided_excerpts";
  readonly webSearch: false;
  readonly assessmentKind: "model_assessment";
}

const HASH = /^[a-f0-9]{64}$/;
// New snapshots require explicit registry verification before this mapping is
// extended. A date-shaped suffix is not proof of an actual provider model.
const APPROVED_MODEL_SNAPSHOTS: Readonly<Record<string, string>> = {
  "gpt-4.1": "gpt-4.1-2025-04-14",
  "gpt-4.1-mini": "gpt-4.1-mini-2025-04-14",
  "gpt-4.1-nano": "gpt-4.1-nano-2025-04-14",
};
const REQUESTED_MODELS = new Set([...Object.keys(APPROVED_MODEL_SNAPSHOTS), ...Object.values(APPROVED_MODEL_SNAPSHOTS)]);
export function isCitabilityAiRequestedModel(value: unknown): value is string {
  return typeof value === "string" && REQUESTED_MODELS.has(value);
}
export function isCitabilityAiModel(value: unknown): value is string {
  return isCitabilityAiRequestedModel(value);
}
export function matchesCitabilityAiModel(requested: string, actual: string): boolean {
  return isCitabilityAiRequestedModel(requested) && isCitabilityAiModel(actual)
    && (actual === requested || APPROVED_MODEL_SNAPSHOTS[requested] === actual);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function nullableNumber(value: unknown, whole = false): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && (!whole || Number.isSafeInteger(value)));
}
export function isCitabilityAiUrl(value: unknown): value is string {
  if (!text(value, 8192)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
function parseEvidence(value: Record<string, unknown>): CitabilityAiEvidence | null {
  if (!integer(value.totalBodyChars) || !integer(value.includedBodyChars) || value.includedBodyChars < 1
    || value.includedBodyChars > value.totalBodyChars || !Array.isArray(value.excerpts)
    || value.excerpts.length < 1 || value.excerpts.length > 8) return null;
  const coverage = value.includedBodyChars === value.totalBodyChars ? "full" : "excerpt";
  if (value.coverage !== coverage) return null;
  const excerpts: CitabilityAiExcerpt[] = [];
  let count = 0;
  for (const [index, item] of value.excerpts.entries()) {
    if (!object(item) || typeof item.id !== "string" || item.id !== `E${index + 1}` || !text(item.text, 360)) return null;
    count += item.text.length;
    excerpts.push({ id: item.id, text: item.text });
  }
  return count === value.includedBodyChars ? {
    totalBodyChars: value.totalBodyChars, includedBodyChars: value.includedBodyChars, coverage, excerpts,
  } : null;
}
export function isCitabilityAiContext(value: unknown): value is CitabilityAiContext {
  if (!object(value) || value.schemaVersion !== "citability-ai-context.v1"
    || typeof value.rawSha256 !== "string" || !HASH.test(value.rawSha256)
    || typeof value.inputFingerprint !== "string" || !HASH.test(value.inputFingerprint)
    || !isCitabilityAiUrl(value.finalUrl) || !timestamp(value.capturedAt)
    || !(value.question === null || text(value.question, 2000)) || !parseEvidence(value)
    || !Array.isArray(value.checks) || value.checks.length > 30) return false;
  return value.checks.every((item) => object(item) && text(item.ruleId, 80)
    && typeof item.state === "string" && ["pass", "fail", "fetchError", "notApplicable"].includes(item.state)
    && typeof item.kind === "string" && ["deterministic", "heuristic"].includes(item.kind))
    && new Set(value.checks.map((item: { ruleId: string }) => item.ruleId)).size === value.checks.length;
}
function modelAssessment(value: unknown, evidenceIds: readonly string[]): CitabilityAiModelAssessment | null {
  if (!object(value) || Object.keys(value).sort().join() !== "dimensions,summary" || !text(value.summary, 600)
    || !Array.isArray(value.dimensions) || value.dimensions.length !== 3 || evidenceIds.length < 1
    || evidenceIds.length > 8 || new Set(evidenceIds).size !== evidenceIds.length
    || !evidenceIds.every((id) => /^E[1-8]$/.test(id))) return null;
  const dimensions: CitabilityAiDimension[] = [];
  for (const item of value.dimensions) {
    if (!object(item) || Object.keys(item).sort().join() !== "evidenceIds,id,reason,suggestion,verdict"
      || (item.id !== "answer_relevance" && item.id !== "answer_clarity" && item.id !== "attribution_clarity")
      || (item.verdict !== "clear" && item.verdict !== "needs_work" && item.verdict !== "insufficient_evidence")
      || !text(item.reason, 400) || !(item.suggestion === null || text(item.suggestion, 400))
      || !Array.isArray(item.evidenceIds) || item.evidenceIds.length > 8
      || new Set(item.evidenceIds).size !== item.evidenceIds.length
      || !item.evidenceIds.every((id) => typeof id === "string" && evidenceIds.includes(id))
      || (item.verdict !== "insufficient_evidence" && item.evidenceIds.length < 1)) return null;
    dimensions.push({ id: item.id, verdict: item.verdict,
      reason: item.reason, suggestion: item.suggestion, evidenceIds: [...item.evidenceIds] });
  }
  if (new Set(dimensions.map((item) => item.id)).size !== 3) return null;
  return { summary: value.summary, dimensions };
}
export function parseCitabilityAiModelAssessment(body: string, evidenceIds: readonly string[]): CitabilityAiModelAssessment | null {
  if (!text(body, 10000)) return null;
  try { return modelAssessment(JSON.parse(body), evidenceIds); } catch { return null; }
}
export function parseCitabilityAiReview(value: unknown): CitabilityAiReview | null {
  const keys = ["schemaVersion", "inputFingerprint", "rawSha256", "finalUrl", "targetQuestion", "capturedAt", "observedAt",
    "totalBodyChars", "includedBodyChars", "coverage", "excerpts", "provider", "requestedModel", "actualModel", "providerTaskId",
    "costUsd", "inputTokens", "outputTokens", "factVerification", "scope", "webSearch", "assessmentKind", "summary", "dimensions"];
  if (!object(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))
    || value.schemaVersion !== "citability-ai-review.v1"
    || typeof value.rawSha256 !== "string" || !HASH.test(value.rawSha256)
    || typeof value.inputFingerprint !== "string" || !HASH.test(value.inputFingerprint)
    || !isCitabilityAiUrl(value.finalUrl) || !(value.targetQuestion === null || text(value.targetQuestion, 2000))
    || !timestamp(value.capturedAt) || !timestamp(value.observedAt) || Date.parse(value.observedAt) < Date.parse(value.capturedAt)
    || value.provider !== "dataforseo" || !isCitabilityAiRequestedModel(value.requestedModel) || !isCitabilityAiModel(value.actualModel)
    || !matchesCitabilityAiModel(value.requestedModel, value.actualModel)
    || !text(value.providerTaskId, 128) || !/^[a-zA-Z0-9-]+$/.test(value.providerTaskId)
    || !nullableNumber(value.costUsd) || !nullableNumber(value.inputTokens, true) || !nullableNumber(value.outputTokens, true)
    || value.factVerification !== "not_performed" || value.scope !== "provided_excerpts"
    || value.webSearch !== false || value.assessmentKind !== "model_assessment") return null;
  const evidence = parseEvidence(value);
  if (!evidence) return null;
  const parsed = modelAssessment({ summary: value.summary, dimensions: value.dimensions }, evidence.excerpts.map((item) => item.id));
  if (!parsed || (value.targetQuestion === null && parsed.dimensions.find((item) => item.id === "answer_relevance")?.verdict !== "insufficient_evidence")) return null;
  return { schemaVersion: "citability-ai-review.v1", inputFingerprint: value.inputFingerprint, rawSha256: value.rawSha256,
    finalUrl: value.finalUrl, targetQuestion: value.targetQuestion, capturedAt: value.capturedAt, observedAt: value.observedAt,
    ...evidence, ...parsed, provider: "dataforseo", requestedModel: value.requestedModel, actualModel: value.actualModel,
    providerTaskId: value.providerTaskId, costUsd: value.costUsd, inputTokens: value.inputTokens, outputTokens: value.outputTokens,
    factVerification: "not_performed", scope: "provided_excerpts", webSearch: false, assessmentKind: "model_assessment" };
}
export function isCitabilityAiReview(value: unknown): value is CitabilityAiReview { return parseCitabilityAiReview(value) !== null; }
