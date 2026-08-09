import { sql } from "drizzle-orm";
import type { RunAttempt } from "./async-runs.ts";
import { Repository } from "./base.ts";

export type TopicModelGenerationInvocationAttemptStatus =
  | "reserved"
  | "succeeded"
  | "failed"
  | "rejected"
  | "outcome_unknown";

export interface TopicModelGenerationInvocationAttemptRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly topic_model_generation_run_id: string;
  readonly ordinal: number;
  readonly async_attempt_count: number;
  readonly provider: string;
  readonly model: string;
  readonly prompt_set_version: string;
  readonly input_hash: string;
  readonly planned_analysis_invocation_id: string;
  readonly status: TopicModelGenerationInvocationAttemptStatus;
  readonly analysis_invocation_id: string | null;
  readonly terminal_error_code: string | null;
  readonly reserved_at: string;
  readonly provider_returned_at: string | null;
  readonly finalized_at: string | null;
}

export interface TopicModelGenerationInvocationPreflight {
  readonly provider: string;
  readonly model: string;
  readonly promptSetVersion: string;
  readonly inputHash: string;
}

export interface TopicModelGenerationInvocationMetadata
  extends TopicModelGenerationInvocationPreflight {
  readonly outputHash: string | null;
  readonly status: "succeeded" | "failed" | "rejected";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly errorCode: string | null;
}

export type TopicModelGenerationInvocationReservationResult =
  | {
      readonly kind: "reserved" | "existing" | "unresolved";
      readonly reservation: TopicModelGenerationInvocationAttemptRow;
    }
  | {
      readonly kind:
        | "stale"
        | "budget_exhausted"
        | "configuration_mismatch";
    };

export type TopicModelGenerationInvocationFinalizeResult =
  | {
      readonly kind: "finalized";
      readonly reservation: TopicModelGenerationInvocationAttemptRow;
      readonly invocationId: string;
    }
  | { readonly kind: "stale_reservation" }
  | {
      readonly kind: "conflict";
      readonly reservation: TopicModelGenerationInvocationAttemptRow | null;
    };

export type TopicModelGenerationInvocationOutcomeUnknownResult =
  | {
      readonly kind: "marked";
      readonly reservation: TopicModelGenerationInvocationAttemptRow;
    }
  | {
      readonly kind: "finalized";
      readonly reservation: TopicModelGenerationInvocationAttemptRow;
      readonly invocationId: string;
    }
  | { readonly kind: "stale_reservation" }
  | {
      readonly kind: "conflict";
      readonly reservation: TopicModelGenerationInvocationAttemptRow | null;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const PROVIDERS = new Set(["openai", "google"]);
const STATUSES = new Set<TopicModelGenerationInvocationAttemptStatus>([
  "reserved",
  "succeeded",
  "failed",
  "rejected",
  "outcome_unknown",
]);

function validBoundedText(value: unknown, maximum = 200): value is string {
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
    attempt.attemptCount > 0 &&
    attempt.attemptCount <= POSTGRES_INTEGER_MAX
  );
}

function validPreflight(
  value: TopicModelGenerationInvocationPreflight,
): boolean {
  return (
    PROVIDERS.has(value.provider) &&
    validBoundedText(value.model) &&
    validBoundedText(value.promptSetVersion) &&
    SHA256_HEX.test(value.inputHash)
  );
}

function validNullableNonNegativeInteger(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= POSTGRES_INTEGER_MAX)
  );
}

function validMetadata(
  value: TopicModelGenerationInvocationMetadata,
): boolean {
  if (!validPreflight(value)) return false;
  if (
    !Number.isSafeInteger(value.latencyMs) ||
    value.latencyMs < 0 ||
    value.latencyMs > POSTGRES_INTEGER_MAX
  ) {
    return false;
  }
  if (
    !validNullableNonNegativeInteger(value.inputTokens) ||
    !validNullableNonNegativeInteger(value.outputTokens) ||
    (value.costUsd !== null &&
      (!Number.isFinite(value.costUsd) ||
        value.costUsd < 0 ||
        value.costUsd > 999_999.999_999))
  ) {
    return false;
  }
  if (value.status === "succeeded") {
    return (
      value.outputHash !== null &&
      SHA256_HEX.test(value.outputHash) &&
      value.errorCode === null
    );
  }
  return (
    value.outputHash === null &&
    typeof value.errorCode === "string" &&
    ERROR_CODE.test(value.errorCode)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return value;
}

function parseReservation(
  value: unknown,
): TopicModelGenerationInvocationAttemptRow | null {
  if (!isRecord(value)) return null;
  const status = value["status"];
  const provider = value["provider"];
  const reservedAt = parseTimestamp(value["reserved_at"]);
  const providerReturnedAt =
    value["provider_returned_at"] === null
      ? null
      : parseTimestamp(value["provider_returned_at"]);
  const finalizedAt =
    value["finalized_at"] === null
      ? null
      : parseTimestamp(value["finalized_at"]);
  const analysisInvocationId = value["analysis_invocation_id"];
  const terminalErrorCode = value["terminal_error_code"];

  if (
    typeof status !== "string" ||
    !STATUSES.has(status as TopicModelGenerationInvocationAttemptStatus) ||
    typeof provider !== "string" ||
    !PROVIDERS.has(provider) ||
    !UUID.test(String(value["id"])) ||
    !UUID.test(String(value["workspace_id"])) ||
    !UUID.test(String(value["project_id"])) ||
    !UUID.test(String(value["topic_model_generation_run_id"])) ||
    !Number.isInteger(value["ordinal"]) ||
    Number(value["ordinal"]) < 1 ||
    Number(value["ordinal"]) > 3 ||
    !Number.isSafeInteger(value["async_attempt_count"]) ||
    Number(value["async_attempt_count"]) < 1 ||
    !validBoundedText(value["model"]) ||
    !validBoundedText(value["prompt_set_version"]) ||
    !SHA256_HEX.test(String(value["input_hash"])) ||
    !UUID.test(String(value["planned_analysis_invocation_id"])) ||
    (analysisInvocationId !== null &&
      !UUID.test(String(analysisInvocationId))) ||
    (terminalErrorCode !== null &&
      (typeof terminalErrorCode !== "string" ||
        !ERROR_CODE.test(terminalErrorCode))) ||
    reservedAt === null
  ) {
    return null;
  }

  if (status === "reserved") {
    if (
      analysisInvocationId !== null ||
      terminalErrorCode !== null ||
      providerReturnedAt !== null ||
      finalizedAt !== null
    ) {
      return null;
    }
  } else if (status === "outcome_unknown") {
    if (
      analysisInvocationId !== null ||
      terminalErrorCode === null ||
      providerReturnedAt === null ||
      finalizedAt === null
    ) {
      return null;
    }
  } else if (
    analysisInvocationId !== value["planned_analysis_invocation_id"] ||
    providerReturnedAt === null ||
    finalizedAt === null ||
    (status === "succeeded"
      ? terminalErrorCode !== null
      : terminalErrorCode === null)
  ) {
    return null;
  }

  if (
    (providerReturnedAt !== null &&
      Date.parse(reservedAt) > Date.parse(providerReturnedAt)) ||
    (providerReturnedAt !== null &&
      finalizedAt !== null &&
      Date.parse(providerReturnedAt) > Date.parse(finalizedAt))
  ) {
    return null;
  }

  return value as unknown as TopicModelGenerationInvocationAttemptRow;
}

function readFunctionResult(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || typeof result["kind"] !== "string") {
    throw new Error("invalid Topic Model generation invocation result");
  }
  return result;
}

function firstResult(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error(
      "invalid Topic Model generation invocation database response",
    );
  }
  const first = raw["rows"][0];
  if (!isRecord(first)) {
    throw new Error("missing Topic Model generation invocation database result");
  }
  return readFunctionResult(first["result"]);
}

function parseReservationResult(
  value: Record<string, unknown>,
): TopicModelGenerationInvocationReservationResult {
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
    if (reservation !== null) return { kind, reservation };
  }
  throw new Error("invalid Topic Model generation invocation reservation result");
}

function parseFinalizeResult(
  value: Record<string, unknown>,
): TopicModelGenerationInvocationFinalizeResult {
  if (value["kind"] === "stale_reservation") {
    return { kind: "stale_reservation" };
  }
  if (value["kind"] === "conflict") {
    const reservation =
      value["reservation"] === null || value["reservation"] === undefined
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
      reservation !== null &&
      typeof invocationId === "string" &&
      UUID.test(invocationId) &&
      reservation.analysis_invocation_id === invocationId
    ) {
      return { kind: "finalized", reservation, invocationId };
    }
  }
  throw new Error("invalid Topic Model generation invocation finalization result");
}

function parseOutcomeUnknownResult(
  value: Record<string, unknown>,
): TopicModelGenerationInvocationOutcomeUnknownResult {
  if (value["kind"] === "marked") {
    const reservation = parseReservation(value["reservation"]);
    if (reservation?.status === "outcome_unknown") {
      return { kind: "marked", reservation };
    }
  }
  return parseFinalizeResult(value);
}

/**
 * Database-serialized pre-call reservation ledger for bounded Topic Model LLM
 * calls. It stores hashes and usage metadata only, never prompt or response
 * bodies, and fences every mutation to the exact AsyncRun delivery epoch.
 */
export class TopicModelGenerationInvocationAttemptsRepository extends Repository {
  async reserve(
    attempt: RunAttempt,
    preflight: TopicModelGenerationInvocationPreflight,
  ): Promise<TopicModelGenerationInvocationReservationResult> {
    if (!validAttempt(attempt)) return { kind: "stale" };
    if (!validPreflight(preflight)) {
      return { kind: "configuration_mismatch" };
    }
    const raw = await this.exec.execute(sql`
      select app.reserve_topic_model_generation_invocation_attempt(
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
    metadata: TopicModelGenerationInvocationMetadata,
  ): Promise<TopicModelGenerationInvocationFinalizeResult> {
    if (!validAttempt(attempt) || !UUID.test(reservationId)) {
      return { kind: "stale_reservation" };
    }
    if (!validMetadata(metadata)) {
      return { kind: "conflict", reservation: null };
    }
    const raw = await this.exec.execute(sql`
      select app.finalize_topic_model_generation_invocation_attempt(
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
  ): Promise<TopicModelGenerationInvocationOutcomeUnknownResult> {
    if (!validAttempt(attempt) || !UUID.test(reservationId)) {
      return { kind: "stale_reservation" };
    }
    if (!ERROR_CODE.test(errorCode)) {
      return { kind: "conflict", reservation: null };
    }
    const raw = await this.exec.execute(sql`
      select app.mark_topic_model_generation_invocation_outcome_unknown(
        ${attempt.workspaceId}::uuid,
        ${attempt.projectId}::uuid,
        ${attempt.runId}::uuid,
        ${attempt.attemptCount}::integer,
        ${reservationId}::uuid,
        ${errorCode}::text
      ) as result
    `);
    return parseOutcomeUnknownResult(firstResult(raw));
  }
}
