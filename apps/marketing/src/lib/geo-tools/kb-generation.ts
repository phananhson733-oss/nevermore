// @input -- validated, owned semantic input and a durable generation store
// @output -- one persisted attempt; uncertain delivery never causes an automatic retry
// @pos -- shared roles/questions dispatch boundary, not an HTTP or provider adapter

import { createHash } from "node:crypto";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";

export const GEO_GENERATION_INPUT_BYTES = 196_608;
// A prepared candidate includes the complete Profile/payload and source context,
// not just the provider reply. Its own stricter parser is applied by the caller.
export const GEO_GENERATION_RESULT_BYTES = 2_097_152;

export type GeoKbGenerationKind = "roles" | "questions";
export type GeoKbGenerationState = "claimed" | "dispatched" | "succeeded" | "failed" | "uncertain";
export type GeoKbGenerationError = "rate_limited" | "quota_unavailable" | "invalid_output" | "provider_rejected" | "outcome_unknown" | "input_stale" | "model_unavailable";
export type GeoGenerationValue = null | string | boolean | number | readonly GeoGenerationValue[] | { readonly [key: string]: GeoGenerationValue };
export interface GeoGenerationAttempt {
  readonly attemptedCalls: 0 | 1;
  readonly delivery: "not_attempted" | "response_received" | "outcome_unknown";
  readonly modelRequested: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Transport-reported usage; zero is not proof that the provider did not bill. */
  readonly requestCount: number | null;
}
export interface GeoKbGenerationRecord {
  readonly generationId: string;
  readonly userId: string;
  readonly kbId: string;
  readonly kind: GeoKbGenerationKind;
  readonly inputHash: string;
  readonly state: GeoKbGenerationState;
  readonly result: GeoGenerationValue;
  readonly errorReason: GeoKbGenerationError | null;
  readonly attempt: GeoGenerationAttempt | null;
}
export interface GeoKbGenerationInput {
  readonly userId: string;
  readonly kbId: string;
  readonly kind: GeoKbGenerationKind;
  readonly idempotencyKey: string;
  readonly input: Readonly<Record<string, GeoGenerationValue>>;
}
export interface GeoKbGenerationScope {
  readonly userId: string;
  readonly kbId: string;
  readonly generationId: string;
  /** Internal lease capability. Never returned in a browser response. */
  readonly claimToken: string;
}
export type GeoKbGenerationFinish = {
  readonly state: "succeeded" | "failed" | "uncertain";
  readonly result: GeoGenerationValue;
  readonly errorReason: GeoKbGenerationError | null;
  readonly attempt: GeoGenerationAttempt | null;
};
export type GeoKbGenerationInvocation = { readonly ok: true; readonly value: GeoGenerationValue; readonly attempt?: GeoGenerationAttempt } | {
  readonly ok: false;
  readonly reason: GeoKbGenerationError;
  readonly delivery: "not_attempted" | "response_received" | "outcome_unknown";
  readonly attempt?: GeoGenerationAttempt;
};
export interface GeoKbGenerationDependencies {
  readonly configured: boolean;
  readonly claim: (input: GeoKbGenerationInput & { readonly inputHash: string }) => Promise<
    | { readonly kind: "claimed"; readonly generation: GeoKbGenerationRecord; readonly claimToken: string }
    | { readonly kind: "existing"; readonly generation: GeoKbGenerationRecord }
    | { readonly kind: "conflict" | "unavailable" }>;
  readonly consumeQuota: () => Promise<"allowed" | "limited" | "unavailable">;
  readonly markDispatched: (scope: GeoKbGenerationScope) => Promise<
    | { readonly kind: "dispatched" | "existing"; readonly generation: GeoKbGenerationRecord }
    | { readonly kind: "unavailable" }>;
  readonly invoke: (generationId: string) => Promise<GeoKbGenerationInvocation>;
  readonly finish: (scope: GeoKbGenerationScope, outcome: GeoKbGenerationFinish) => Promise<
    | { readonly kind: "ok"; readonly generation: GeoKbGenerationRecord }
    | { readonly kind: "unavailable" }>;
}
export type GeoKbGenerationOutcome =
  | { readonly kind: "ok"; readonly generation: GeoKbGenerationRecord; readonly reused: boolean }
  | { readonly kind: "invalid_input" | "model_unavailable" | "conflict" | "store_unavailable" };

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const errors: readonly string[] = ["rate_limited", "quota_unavailable", "invalid_output", "provider_rejected", "outcome_unknown", "input_stale", "model_unavailable"];
function boundedCanonical(value: unknown, limit: number): string {
  const text = canonicalGeoV2Text(value);
  if (Buffer.byteLength(text, "utf8") > limit) throw new Error("generation exceeds byte limit");
  return text;
}
function validAttempt(attempt: GeoGenerationAttempt | null): boolean {
  if (attempt === null) return true;
  return [0, 1].includes(attempt.attemptedCalls) && ["not_attempted", "response_received", "outcome_unknown"].includes(attempt.delivery) &&
    (attempt.attemptedCalls === 0) === (attempt.delivery === "not_attempted") &&
    (attempt.modelRequested === null || (typeof attempt.modelRequested === "string" && attempt.modelRequested.length > 0 && attempt.modelRequested.length <= 200)) &&
    [attempt.inputTokens, attempt.outputTokens, attempt.requestCount].every(value => value === null || (Number.isSafeInteger(value) && value >= 0));
}
function invocationAttempt(result: GeoKbGenerationInvocation): GeoGenerationAttempt {
  const delivery = result.ok ? "response_received" : result.delivery;
  return result.attempt ?? { attemptedCalls: delivery === "not_attempted" ? 0 : 1, delivery, modelRequested: null, inputTokens: null, outputTokens: null, requestCount: null };
}
export function geoGenerationInputHash(kind: GeoKbGenerationKind, input: Readonly<Record<string, GeoGenerationValue>>): string {
  return createHash("sha256").update(boundedCanonical({ kind, input }, GEO_GENERATION_INPUT_BYTES)).digest("hex");
}

function matches(record: GeoKbGenerationRecord, input: GeoKbGenerationInput, inputHash: string): boolean {
  if (!uuid.test(record.generationId) || record.userId !== input.userId || record.kbId !== input.kbId || record.kind !== input.kind || record.inputHash !== inputHash || !validAttempt(record.attempt)) return false;
  if (record.state === "claimed" || record.state === "dispatched") return record.result === null && record.errorReason === null && record.attempt === null;
  if (record.state === "failed" || record.state === "uncertain") return record.result === null && record.errorReason !== null && errors.includes(record.errorReason) && (record.state !== "uncertain" || record.errorReason === "outcome_unknown");
  return record.state === "succeeded" && record.result !== null && record.errorReason === null && boundedCanonical(record.result, GEO_GENERATION_RESULT_BYTES).length > 0;
}

export async function executeGeoKbGeneration(input: GeoKbGenerationInput, dependencies: GeoKbGenerationDependencies): Promise<GeoKbGenerationOutcome> {
  if (!dependencies.configured) return { kind: "model_unavailable" };
  let inputHash: string;
  try {
    if (!uuid.test(input.userId) || !uuid.test(input.kbId) || !["roles", "questions"].includes(input.kind) || !/^[a-zA-Z0-9_-]{8,128}$/u.test(input.idempotencyKey) || input.input === null || typeof input.input !== "object" || Array.isArray(input.input)) return { kind: "invalid_input" };
    inputHash = geoGenerationInputHash(input.kind, input.input);
  } catch { return { kind: "invalid_input" }; }

  try {
    const claimed = await dependencies.claim({ ...input, inputHash });
    if (claimed.kind === "conflict") return { kind: "conflict" };
    if (claimed.kind === "unavailable" || !("generation" in claimed) || !matches(claimed.generation, input, inputHash)) return { kind: "store_unavailable" };
    if (claimed.kind === "existing") return { kind: "ok", generation: claimed.generation, reused: true };
    if (claimed.generation.state !== "claimed" || !uuid.test(claimed.claimToken)) return { kind: "store_unavailable" };
    const scope: GeoKbGenerationScope = { userId: input.userId, kbId: input.kbId, generationId: claimed.generation.generationId, claimToken: claimed.claimToken };
    const finish = async (outcome: GeoKbGenerationFinish): Promise<GeoKbGenerationOutcome> => {
      const stored = await dependencies.finish(scope, outcome);
      if (stored.kind !== "ok" || !matches(stored.generation, input, inputHash) || stored.generation.generationId !== scope.generationId) return { kind: "store_unavailable" };
      // A final source/draft CAS may reject an otherwise valid model result.
      // Never expose the transient output instead of the stored rejection.
      if (stored.generation.state !== outcome.state && !(stored.generation.state === "failed" && stored.generation.errorReason === "input_stale")) return { kind: "store_unavailable" };
      if (canonicalGeoV2Text(stored.generation.attempt) !== canonicalGeoV2Text(outcome.attempt)) return { kind: "store_unavailable" };
      if (stored.generation.state === "succeeded" && boundedCanonical(stored.generation.result, GEO_GENERATION_RESULT_BYTES) !== boundedCanonical(outcome.result, GEO_GENERATION_RESULT_BYTES)) return { kind: "store_unavailable" };
      return { kind: "ok", generation: stored.generation, reused: false };
    };
    const quota = await dependencies.consumeQuota().catch(() => "unavailable" as const);
    if (quota !== "allowed") return await finish({ state: "failed", result: null, errorReason: quota === "limited" ? "rate_limited" : "quota_unavailable", attempt: null });

    // Only the acknowledged lease winner may call the provider. An ambiguous
    // acknowledgement is not permission to retry either dispatch or the call.
    const dispatched = await dependencies.markDispatched(scope);
    if (dispatched.kind === "unavailable" || !matches(dispatched.generation, input, inputHash) || dispatched.generation.generationId !== scope.generationId) return { kind: "store_unavailable" };
    if (dispatched.kind === "existing") return { kind: "ok", generation: dispatched.generation, reused: true };
    if (dispatched.generation.state !== "dispatched") return { kind: "store_unavailable" };

    let result: GeoKbGenerationInvocation;
    try { result = await dependencies.invoke(scope.generationId); }
    catch { result = { ok: false, reason: "outcome_unknown", delivery: "outcome_unknown" }; }
    const attempt = invocationAttempt(result);
    if (!validAttempt(attempt) || attempt.delivery !== (result.ok ? "response_received" : result.delivery)) return { kind: "store_unavailable" };
    if (!result.ok) {
      const uncertain = result.delivery === "outcome_unknown";
      return await finish({ state: uncertain ? "uncertain" : "failed", result: null, errorReason: uncertain ? "outcome_unknown" : errors.includes(result.reason) ? result.reason : "invalid_output", attempt });
    }
    try {
      if (result.value === null) throw new Error("empty generation");
      boundedCanonical(result.value, GEO_GENERATION_RESULT_BYTES);
    } catch { return await finish({ state: "failed", result: null, errorReason: "invalid_output", attempt }); }
    return await finish({ state: "succeeded", result: result.value, errorReason: null, attempt });
  } catch { return { kind: "store_unavailable" }; }
}
