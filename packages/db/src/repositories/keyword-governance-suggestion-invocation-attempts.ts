import { sql } from "drizzle-orm";
import type { RunAttempt } from "./async-runs.ts";
import { Repository } from "./base.ts";

export type KeywordGovernanceSuggestionInvocationAttemptStatus =
  | "reserved"
  | "succeeded"
  | "failed"
  | "rejected"
  | "outcome_unknown";

export interface KeywordGovernanceSuggestionInvocationAttemptRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly generation_run_id: string;
  readonly ordinal: number;
  readonly async_attempt_count: number;
  readonly provider: string;
  readonly model: string;
  readonly prompt_set_version: string;
  readonly input_hash: string;
  readonly planned_analysis_invocation_id: string;
  readonly status: KeywordGovernanceSuggestionInvocationAttemptStatus;
  readonly analysis_invocation_id: string | null;
  readonly terminal_error_code: string | null;
  readonly reserved_at: string;
  readonly provider_returned_at: string | null;
  readonly finalized_at: string | null;
}

export interface KeywordGovernanceSuggestionInvocationPreflight {
  readonly provider: string;
  readonly model: string;
  readonly promptSetVersion: string;
  readonly inputHash: string;
}

export interface KeywordGovernanceSuggestionInvocationMetadata
  extends KeywordGovernanceSuggestionInvocationPreflight {
  readonly outputHash: string | null;
  readonly status: "succeeded" | "failed" | "rejected";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly errorCode: string | null;
}

export type KeywordGovernanceSuggestionInvocationReservationResult =
  | {
      readonly kind: "reserved" | "existing" | "unresolved";
      readonly reservation: KeywordGovernanceSuggestionInvocationAttemptRow;
    }
  | {
      readonly kind: "stale" | "budget_exhausted" | "configuration_mismatch";
    };

export type KeywordGovernanceSuggestionInvocationFinalizeResult =
  | {
      readonly kind: "finalized";
      readonly reservation: KeywordGovernanceSuggestionInvocationAttemptRow;
      readonly invocationId: string;
    }
  | { readonly kind: "stale_reservation" }
  | {
      readonly kind: "conflict";
      readonly reservation: KeywordGovernanceSuggestionInvocationAttemptRow | null;
    };

export type KeywordGovernanceSuggestionInvocationOutcomeUnknownResult =
  | {
      readonly kind: "marked";
      readonly reservation: KeywordGovernanceSuggestionInvocationAttemptRow;
    }
  | KeywordGovernanceSuggestionInvocationFinalizeResult;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const PROVIDERS = new Set(["openai", "google"]);
const STATUSES = new Set<KeywordGovernanceSuggestionInvocationAttemptStatus>([
  "reserved",
  "succeeded",
  "failed",
  "rejected",
  "outcome_unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown, maximum = 200): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= maximum
  );
}

function validAttempt(attempt: RunAttempt): boolean {
  return (
    UUID.test(attempt.workspaceId) &&
    UUID.test(attempt.projectId) &&
    UUID.test(attempt.runId) &&
    Number.isSafeInteger(attempt.attemptCount) &&
    attempt.attemptCount >= 1 &&
    attempt.attemptCount <= 2_147_483_647
  );
}

function validPreflight(
  value: KeywordGovernanceSuggestionInvocationPreflight,
): boolean {
  return (
    PROVIDERS.has(value.provider) &&
    validText(value.model) &&
    value.promptSetVersion === "keyword-governance-suggestion.prompt.v1" &&
    HASH.test(value.inputHash)
  );
}

function validNullableInteger(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 2_147_483_647)
  );
}

function validMetadata(
  value: KeywordGovernanceSuggestionInvocationMetadata,
): boolean {
  if (
    !validPreflight(value) ||
    !Number.isSafeInteger(value.latencyMs) ||
    value.latencyMs < 0 ||
    value.latencyMs > 2_147_483_647 ||
    !validNullableInteger(value.inputTokens) ||
    !validNullableInteger(value.outputTokens) ||
    (value.costUsd !== null &&
      (!Number.isFinite(value.costUsd) ||
        value.costUsd < 0 ||
        value.costUsd > 999_999.999_999))
  ) {
    return false;
  }
  return value.status === "succeeded"
    ? value.outputHash !== null &&
        HASH.test(value.outputHash) &&
        value.errorCode === null
    : value.outputHash === null &&
        value.errorCode !== null &&
        ERROR_CODE.test(value.errorCode);
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function parseReservation(
  value: unknown,
): KeywordGovernanceSuggestionInvocationAttemptRow | null {
  if (!isRecord(value)) return null;
  const status = value["status"];
  const providerReturnedAt =
    value["provider_returned_at"] === null
      ? null
      : timestamp(value["provider_returned_at"]);
  const finalizedAt =
    value["finalized_at"] === null ? null : timestamp(value["finalized_at"]);
  if (
    typeof status !== "string" ||
    !STATUSES.has(status as KeywordGovernanceSuggestionInvocationAttemptStatus) ||
    !UUID.test(String(value["id"])) ||
    !UUID.test(String(value["workspace_id"])) ||
    !UUID.test(String(value["project_id"])) ||
    !UUID.test(String(value["generation_run_id"])) ||
    !Number.isInteger(value["ordinal"]) ||
    Number(value["ordinal"]) < 1 ||
    Number(value["ordinal"]) > 3 ||
    !Number.isSafeInteger(value["async_attempt_count"]) ||
    Number(value["async_attempt_count"]) < 1 ||
    typeof value["provider"] !== "string" ||
    !PROVIDERS.has(value["provider"]) ||
    !validText(value["model"]) ||
    value["prompt_set_version"] !== "keyword-governance-suggestion.prompt.v1" ||
    !HASH.test(String(value["input_hash"])) ||
    !UUID.test(String(value["planned_analysis_invocation_id"])) ||
    timestamp(value["reserved_at"]) === null
  ) {
    return null;
  }
  const invocationId = value["analysis_invocation_id"];
  const errorCode = value["terminal_error_code"];
  if (
    (invocationId !== null && !UUID.test(String(invocationId))) ||
    (errorCode !== null &&
      (typeof errorCode !== "string" || !ERROR_CODE.test(errorCode)))
  ) {
    return null;
  }
  if (
    (status === "reserved" &&
      (invocationId !== null ||
        errorCode !== null ||
        providerReturnedAt !== null ||
        finalizedAt !== null)) ||
    (status === "outcome_unknown" &&
      (invocationId !== null ||
        errorCode === null ||
        providerReturnedAt === null ||
        finalizedAt === null)) ||
    (["succeeded", "failed", "rejected"].includes(status) &&
      (invocationId !== value["planned_analysis_invocation_id"] ||
        providerReturnedAt === null ||
        finalizedAt === null ||
        (status === "succeeded" ? errorCode !== null : errorCode === null)))
  ) {
    return null;
  }
  return value as unknown as KeywordGovernanceSuggestionInvocationAttemptRow;
}

function firstResult(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error("invalid Keyword suggestion invocation database response");
  }
  const first = raw["rows"][0];
  if (!isRecord(first) || !isRecord(first["result"])) {
    throw new Error("missing Keyword suggestion invocation database result");
  }
  return first["result"];
}

function parseReservationResult(
  value: Record<string, unknown>,
): KeywordGovernanceSuggestionInvocationReservationResult {
  const kind = value["kind"];
  if (
    kind === "stale" ||
    kind === "budget_exhausted" ||
    kind === "configuration_mismatch"
  ) {
    return { kind };
  }
  if (kind === "reserved" || kind === "existing" || kind === "unresolved") {
    const reservation = parseReservation(value["reservation"]);
    if (reservation) return { kind, reservation };
  }
  throw new Error("invalid Keyword suggestion invocation reservation result");
}

function parseFinalizeResult(
  value: Record<string, unknown>,
): KeywordGovernanceSuggestionInvocationFinalizeResult {
  if (value["kind"] === "stale_reservation") {
    return { kind: "stale_reservation" };
  }
  if (value["kind"] === "conflict") {
    const reservation =
      value["reservation"] == null
        ? null
        : parseReservation(value["reservation"]);
    if (reservation !== null || value["reservation"] == null) {
      return { kind: "conflict", reservation };
    }
  }
  if (value["kind"] === "finalized") {
    const reservation = parseReservation(value["reservation"]);
    const invocationId = value["invocationId"];
    if (
      reservation &&
      typeof invocationId === "string" &&
      UUID.test(invocationId) &&
      reservation.analysis_invocation_id === invocationId
    ) {
      return { kind: "finalized", reservation, invocationId };
    }
  }
  throw new Error("invalid Keyword suggestion invocation finalization result");
}

export class KeywordGovernanceSuggestionInvocationAttemptsRepository extends Repository {
  async reserve(
    attempt: RunAttempt,
    preflight: KeywordGovernanceSuggestionInvocationPreflight,
  ): Promise<KeywordGovernanceSuggestionInvocationReservationResult> {
    if (!validAttempt(attempt)) return { kind: "stale" };
    if (!validPreflight(preflight)) return { kind: "configuration_mismatch" };
    const raw = await this.exec.execute(sql`
      select app.reserve_keyword_governance_suggestion_invocation_attempt(
        ${attempt.workspaceId}::uuid,
        ${attempt.projectId}::uuid,
        ${attempt.runId}::uuid,
        ${attempt.attemptCount}::integer,
        ${preflight.provider}::text,
        ${preflight.model}::text,
        ${preflight.promptSetVersion}::text,
        ${preflight.inputHash}::text
      ) as result
    `);
    return parseReservationResult(firstResult(raw));
  }

  async finalizeWithInvocation(
    attempt: RunAttempt,
    reservationId: string,
    metadata: KeywordGovernanceSuggestionInvocationMetadata,
  ): Promise<KeywordGovernanceSuggestionInvocationFinalizeResult> {
    if (!validAttempt(attempt) || !UUID.test(reservationId)) {
      return { kind: "stale_reservation" };
    }
    if (!validMetadata(metadata)) return { kind: "conflict", reservation: null };
    const raw = await this.exec.execute(sql`
      select app.finalize_keyword_governance_suggestion_invocation_attempt(
        ${attempt.workspaceId}::uuid,
        ${attempt.projectId}::uuid,
        ${attempt.runId}::uuid,
        ${attempt.attemptCount}::integer,
        ${reservationId}::uuid,
        ${metadata.provider}::text,
        ${metadata.model}::text,
        ${metadata.promptSetVersion}::text,
        ${metadata.inputHash}::text,
        ${metadata.outputHash}::text,
        ${metadata.status}::text,
        ${metadata.inputTokens}::integer,
        ${metadata.outputTokens}::integer,
        ${metadata.costUsd}::numeric,
        ${metadata.latencyMs}::integer,
        ${metadata.errorCode}::text
      ) as result
    `);
    return parseFinalizeResult(firstResult(raw));
  }

  async markOutcomeUnknown(
    attempt: RunAttempt,
    reservationId: string,
    errorCode: string,
  ): Promise<KeywordGovernanceSuggestionInvocationOutcomeUnknownResult> {
    if (!validAttempt(attempt) || !UUID.test(reservationId)) {
      return { kind: "stale_reservation" };
    }
    if (!ERROR_CODE.test(errorCode)) return { kind: "conflict", reservation: null };
    const raw = await this.exec.execute(sql`
      select app.mark_keyword_governance_suggestion_invocation_outcome_unknown(
        ${attempt.workspaceId}::uuid,
        ${attempt.projectId}::uuid,
        ${attempt.runId}::uuid,
        ${attempt.attemptCount}::integer,
        ${reservationId}::uuid,
        ${errorCode}::text
      ) as result
    `);
    const result = firstResult(raw);
    if (result["kind"] === "marked") {
      const reservation = parseReservation(result["reservation"]);
      if (reservation?.status === "outcome_unknown") {
        return { kind: "marked", reservation };
      }
    }
    return parseFinalizeResult(result);
  }
}
