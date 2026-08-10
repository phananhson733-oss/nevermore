import { randomUUID } from "node:crypto";
import {
  KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  LLMError,
  createOpenAIKeywordGovernanceSuggestionClient,
  prepareKeywordGovernanceSuggestionGeneration,
  type AnalysisInvocationRecord,
  type KeywordGovernanceSuggestionGenerationClient,
  type KeywordGovernanceSuggestionClientOptions,
} from "@sf/artifacts";
import {
  KeywordGovernanceSuggestionInputManifest,
  Uuid,
  type KeywordGovernanceSuggestionInputManifest as SuggestionManifest,
} from "@sf/contracts";
import {
  AsyncRunsRepository,
  KeywordGovernanceSuggestionGenerationRunsRepository,
  KeywordGovernanceSuggestionInvocationAttemptsRepository,
  KeywordReviewSuggestionsRepository,
  contentHash,
  toRunAttempt,
  type CanonicalValue,
  type AsyncRunRow,
  type KeywordGovernanceSuggestionGenerationRunRow,
  type KeywordGovernanceSuggestionInvocationMetadata,
  type KeywordReviewSuggestionBatchItem,
  type ProjectScope,
  type RunAttempt,
} from "@sf/db";
import { z } from "zod";
import type { WorkerContext } from "../context.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";
import { resolveKeywordGovernanceSuggestions } from "./resolution.ts";

export const KEYWORD_GOVERNANCE_SUGGESTION_GENERATION_VERSION =
  "keyword-governance-suggestion-generation.v1" as const;
export const KEYWORD_GOVERNANCE_SUGGESTION_GENERATION_OUTCOME_SCHEMA_VERSION =
  "keyword-governance-suggestion-generation-outcome.v1" as const;
export const KEYWORD_GOVERNANCE_SUGGESTION_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_HOSTED_OPENAI_TEMPERATURE = 0.2;

export interface KeywordGovernanceSuggestionGenerationJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export type KeywordGovernanceSuggestionGenerationOutcome =
  | {
      readonly kind: "completed";
      readonly requestNextBatch: true;
      readonly initiatedBy: string;
    }
  | {
      readonly kind: "reschedule";
      readonly reason: "stale_authority" | "concurrent_human" | "conflict";
      readonly requestNextBatch: true;
      readonly initiatedBy: string;
    }
  | { readonly kind: "settled"; readonly requestNextBatch: false };

export interface KeywordGovernanceSuggestionGenerationDependencies {
  readonly createClient?: (
    options: KeywordGovernanceSuggestionClientOptions,
  ) => KeywordGovernanceSuggestionGenerationClient;
  readonly createSuggestionId?: (
    keywordId: string,
    ordinal: number,
  ) => string;
}

const JobPayloadSchema = z
  .object({ runId: Uuid, workspaceId: Uuid, projectId: Uuid })
  .strict();
const InvocationSchema = z
  .object({
    task: z.literal("keyword_governance_suggestion_generation"),
    provider: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
    promptSetVersion: z.string().trim().min(1).max(200),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    outputHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
    status: z.enum(["succeeded", "failed", "rejected"]),
    inputTokens: z.number().int().nonnegative().safe().nullable(),
    outputTokens: z.number().int().nonnegative().safe().nullable(),
    costUsd: z.number().finite().nonnegative().nullable(),
    latencyMs: z.number().int().nonnegative().safe(),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u).nullable(),
  })
  .strict()
  .superRefine((invocation, issue) => {
    const consistent =
      invocation.status === "succeeded"
        ? invocation.outputHash !== null && invocation.errorCode === null
        : invocation.outputHash === null && invocation.errorCode !== null;
    if (!consistent) {
      issue.addIssue({
        code: "custom",
        message: "invocation terminal facts are inconsistent",
      });
    }
  });
const RescheduleReasonSchema = z.enum([
  "stale_authority",
  "concurrent_human",
  "conflict",
]);
const TerminalProgressSchema = z
  .object({
    schemaVersion: z.literal(
      KEYWORD_GOVERNANCE_SUGGESTION_GENERATION_OUTCOME_SCHEMA_VERSION,
    ),
    candidateCount: z.number().int().nonnegative().safe(),
    suggestionCount: z.number().int().nonnegative().safe(),
    limitations: z.array(z.string().trim().min(1).max(200)).max(20),
    terminalDisposition: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("completed"),
          requestNextBatch: z.literal(true),
        })
        .strict(),
      z
        .object({
          kind: z.literal("reschedule"),
          reason: RescheduleReasonSchema,
          requestNextBatch: z.literal(true),
        })
        .strict(),
    ]),
  })
  .strict();
const SAFE_FAILURE_SUMMARY =
  "Keyword governance suggestion generation failed.";
const OUTCOME_UNKNOWN_CODE =
  "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN";
const OUTCOME_UNKNOWN_SUMMARY =
  "The provider invocation outcome could not be safely recovered.";
const SUPERSEDED_SUMMARY =
  "Keyword governance suggestion generation was superseded.";
const TERMINAL_CODE_BY_RESCHEDULE_REASON = {
  stale_authority: "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
  concurrent_human: "KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN",
  conflict: "KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT",
} as const;

interface FrozenInput {
  readonly ledger: KeywordGovernanceSuggestionGenerationRunRow;
  readonly manifest: SuggestionManifest;
  readonly promptInputHash: string;
}

interface ExpectedInvocationIdentity {
  readonly provider: "openai";
  readonly model: string;
  readonly promptSetVersion: string;
  readonly inputHash: string;
}

function terminalProgress(
  candidateCount: number,
  suggestionCount: number,
  terminalDisposition:
    | { readonly kind: "completed"; readonly requestNextBatch: true }
    | {
        readonly kind: "reschedule";
        readonly reason: z.infer<typeof RescheduleReasonSchema>;
        readonly requestNextBatch: true;
      },
): Record<string, unknown> {
  return {
    schemaVersion:
      KEYWORD_GOVERNANCE_SUGGESTION_GENERATION_OUTCOME_SCHEMA_VERSION,
    candidateCount,
    suggestionCount,
    limitations: [],
    terminalDisposition,
  };
}

function recoverTerminalOutcome(
  run: AsyncRunRow | null,
  scope: ProjectScope,
  runId: string,
): KeywordGovernanceSuggestionGenerationOutcome {
  if (
    run === null ||
    run.id !== runId ||
    run.workspace_id !== scope.workspaceId ||
    run.project_id !== scope.projectId ||
    run.kind !== "keyword_governance_suggestion_generation" ||
    run.result_type !== "keyword_governance_suggestion_generation_run" ||
    run.result_id !== runId ||
    !Uuid.safeParse(run.initiated_by).success
  ) {
    return { kind: "settled", requestNextBatch: false };
  }
  const progress = TerminalProgressSchema.safeParse(run.progress);
  if (!progress.success) {
    return { kind: "settled", requestNextBatch: false };
  }
  const disposition = progress.data.terminalDisposition;
  if (
    disposition.kind === "completed" &&
    run.status === "completed" &&
    run.last_error_code === null &&
    run.last_error_summary === null
  ) {
    return {
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: run.initiated_by,
    };
  }
  if (
    disposition.kind === "reschedule" &&
    run.status === "cancelled" &&
    run.last_error_code ===
      TERMINAL_CODE_BY_RESCHEDULE_REASON[disposition.reason] &&
    run.last_error_summary === SUPERSEDED_SUMMARY
  ) {
    return {
      kind: "reschedule",
      reason: disposition.reason,
      requestNextBatch: true,
      initiatedBy: run.initiated_by,
    };
  }
  return { kind: "settled", requestNextBatch: false };
}

function loadManifest(
  ledger: KeywordGovernanceSuggestionGenerationRunRow,
  scope: ProjectScope,
  runId: string,
): FrozenInput {
  const manifest = KeywordGovernanceSuggestionInputManifest.parse(
    ledger.input_manifest,
  );
  const promptInputHash =
    prepareKeywordGovernanceSuggestionGeneration(manifest).inputHash;
  if (
    ledger.id !== runId ||
    ledger.workspace_id !== scope.workspaceId ||
    ledger.project_id !== scope.projectId ||
    ledger.generation_version !==
      KEYWORD_GOVERNANCE_SUGGESTION_GENERATION_VERSION ||
    ledger.prompt_set_version !==
      KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION ||
    ledger.result_output_hash !== null ||
    manifest.workspaceId !== scope.workspaceId ||
    manifest.projectId !== scope.projectId ||
    contentHash(manifest as unknown as CanonicalValue) !== ledger.input_hash ||
    (ledger.prompt_input_hash !== null &&
      ledger.prompt_input_hash !== promptInputHash)
  ) {
    throw new Error("invalid Keyword governance suggestion frozen input");
  }
  return { ledger, manifest, promptInputHash };
}

function invocationMetadata(
  value: unknown,
  expected: ExpectedInvocationIdentity,
): KeywordGovernanceSuggestionInvocationMetadata {
  const parsed = InvocationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid Keyword governance suggestion invocation");
  }
  const invocation = parsed.data;
  if (
    invocation.task !== "keyword_governance_suggestion_generation" ||
    invocation.provider !== expected.provider ||
    invocation.model !== expected.model ||
    invocation.promptSetVersion !== expected.promptSetVersion ||
    invocation.inputHash !== expected.inputHash ||
    !["succeeded", "failed", "rejected"].includes(invocation.status) ||
    (invocation.status === "succeeded"
      ? invocation.outputHash === null || invocation.errorCode !== null
      : invocation.outputHash !== null || invocation.errorCode === null)
  ) {
    throw new Error("invalid Keyword governance suggestion invocation");
  }
  return {
    provider: invocation.provider,
    model: invocation.model,
    promptSetVersion: invocation.promptSetVersion,
    inputHash: invocation.inputHash,
    outputHash: invocation.outputHash,
    status: invocation.status,
    inputTokens: invocation.inputTokens,
    outputTokens: invocation.outputTokens,
    costUsd: invocation.costUsd,
    latencyMs: invocation.latencyMs,
    errorCode: invocation.errorCode,
  };
}

function hasExactGenerationResultEnvelope(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return keys.length === 2 && keys[0] === "invocation" && keys[1] === "output";
}

function validReservation(
  reservation: {
    readonly workspace_id: string;
    readonly project_id: string;
    readonly generation_run_id: string;
    readonly async_attempt_count: number;
    readonly provider: string;
    readonly model: string;
    readonly prompt_set_version: string;
    readonly input_hash: string;
    readonly status: string;
  },
  attempt: RunAttempt,
  expected: ExpectedInvocationIdentity,
): boolean {
  return (
    reservation.workspace_id === attempt.workspaceId &&
    reservation.project_id === attempt.projectId &&
    reservation.generation_run_id === attempt.runId &&
    reservation.async_attempt_count === attempt.attemptCount &&
    reservation.provider === expected.provider &&
    reservation.model === expected.model &&
    reservation.prompt_set_version === expected.promptSetVersion &&
    reservation.input_hash === expected.inputHash &&
    reservation.status === "reserved"
  );
}

async function terminalizeFailure(
  ctx: WorkerContext,
  attempt: RunAttempt,
  code: string,
  summary = SAFE_FAILURE_SUMMARY,
): Promise<"terminalized" | "stale"> {
  const terminalized =
    await new KeywordGovernanceSuggestionGenerationRunsRepository(
      ctx.db,
    ).terminalize(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode: code,
      lastErrorSummary: summary,
    });
  if (terminalized.kind === "conflict") {
    throw new Error("Keyword suggestion generation terminal state conflicted");
  }
  return terminalized.kind;
}

async function markOutcomeUnknown(
  ctx: WorkerContext,
  attempt: RunAttempt,
  reservationId: string,
  code: string,
): Promise<void> {
  try {
    await new KeywordGovernanceSuggestionInvocationAttemptsRepository(
      ctx.db,
    ).markOutcomeUnknown(attempt, reservationId, code);
  } catch {
    // The durable reservation still prevents an unproven paid replay.
  }
}

async function resetForRetry(
  runs: AsyncRunsRepository,
  attempt: RunAttempt,
  error: unknown,
): Promise<boolean> {
  return runs.resetToQueued(attempt, {
    code: error instanceof LLMError ? error.code : transientFailureCode(error),
    summary: "Keyword governance suggestion generation will be retried.",
  });
}

function isTransientModelError(error: LLMError): boolean {
  return ["RATE_LIMITED", "SERVER_ERROR"].includes(error.code);
}

function isAmbiguousTransportModelError(error: LLMError): boolean {
  return ["NETWORK_ERROR", "TIMEOUT"].includes(error.code);
}

async function commitKnownInvocationWithoutSuggestions(
  ctx: WorkerContext,
  attempt: RunAttempt,
  reservationId: string,
  invocation: AnalysisInvocationRecord,
  expected: ExpectedInvocationIdentity,
  outcome: {
    readonly retry: boolean;
    readonly errorCode: string;
  },
): Promise<"terminalized" | "reset" | "stale" | "outcome_unknown"> {
  let metadata: KeywordGovernanceSuggestionInvocationMetadata;
  try {
    metadata = invocationMetadata(invocation, expected);
  } catch {
    await markOutcomeUnknown(
      ctx,
      attempt,
      reservationId,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    return "outcome_unknown";
  }
  if (
    metadata.status === "succeeded" ||
    metadata.errorCode !== outcome.errorCode ||
    (outcome.retry && metadata.status !== "failed")
  ) {
    await markOutcomeUnknown(
      ctx,
      attempt,
      reservationId,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    return "outcome_unknown";
  }
  try {
    return await ctx.db.transaction(async (tx) => {
      const runs = new AsyncRunsRepository(tx);
      if ((await runs.lockAttemptForUpdate(attempt)) === null) return "stale";
      const finalized =
        await new KeywordGovernanceSuggestionInvocationAttemptsRepository(
          tx,
        ).finalizeWithInvocation(attempt, reservationId, metadata);
      if (finalized.kind !== "finalized") {
        throw new Error("Keyword suggestion invocation finalization failed");
      }
      if (outcome.retry) {
        if (
          !(await runs.resetToQueued(attempt, {
            code: outcome.errorCode,
            summary:
              "Keyword governance suggestion generation will be retried.",
          }))
        ) {
          throw new Error("Keyword suggestion retry fence changed");
        }
        return "reset";
      }
      const terminalized =
        await new KeywordGovernanceSuggestionGenerationRunsRepository(
          tx,
        ).terminalize(attempt, {
          status: "failed",
          resultOutputHash: null,
          lastErrorCode: outcome.errorCode,
          lastErrorSummary: SAFE_FAILURE_SUMMARY,
        });
      if (terminalized.kind !== "terminalized") {
        throw new Error("Keyword suggestion failure terminalization failed");
      }
      return "terminalized";
    });
  } catch {
    await markOutcomeUnknown(
      ctx,
      attempt,
      reservationId,
      "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    );
    return "outcome_unknown";
  }
}

async function commitSuccessfulResult(
  ctx: WorkerContext,
  scope: ProjectScope,
  attempt: RunAttempt,
  initiatedBy: string,
  reservationId: string,
  frozen: FrozenInput,
  expected: ExpectedInvocationIdentity,
  result: Awaited<
    ReturnType<
      KeywordGovernanceSuggestionGenerationClient["generateKeywordGovernanceSuggestions"]
    >
  >,
  suggestions: readonly KeywordReviewSuggestionBatchItem[],
): Promise<KeywordGovernanceSuggestionGenerationOutcome> {
  return ctx.db.transaction(async (tx) => {
    const runs = new AsyncRunsRepository(tx);
    if ((await runs.lockAttemptForUpdate(attempt)) === null) {
      throw new Error("Keyword suggestion generation attempt became stale");
    }
    const finalized =
      await new KeywordGovernanceSuggestionInvocationAttemptsRepository(
        tx,
      ).finalizeWithInvocation(
        attempt,
        reservationId,
        invocationMetadata(result.invocation, expected),
      );
    if (finalized.kind !== "finalized") {
      throw new Error("Keyword suggestion invocation finalization failed");
    }
    const inserted = await new KeywordReviewSuggestionsRepository(tx).insertBatch(
      scope,
      {
        generationRunId: attempt.runId,
        inputHash: frozen.ledger.input_hash,
        outputHash: result.invocation.outputHash!,
        analysisInvocationId: finalized.invocationId,
        suggestions,
      },
    );
    if (
      inserted.kind === "stale_authority" ||
      inserted.kind === "concurrent_human" ||
      inserted.kind === "conflict"
    ) {
      if (
        !(await runs.setProgress(
          attempt,
          terminalProgress(frozen.manifest.candidates.length, 0, {
            kind: "reschedule",
            reason: inserted.kind,
            requestNextBatch: true,
          }),
        ))
      ) {
        throw new Error("Keyword suggestion generation progress fence changed");
      }
      const terminalized =
        await new KeywordGovernanceSuggestionGenerationRunsRepository(
          tx,
        ).terminalize(attempt, {
          status: "cancelled",
          resultOutputHash: null,
          lastErrorCode: TERMINAL_CODE_BY_RESCHEDULE_REASON[inserted.kind],
          lastErrorSummary: SUPERSEDED_SUMMARY,
        });
      if (terminalized.kind !== "terminalized") {
        throw new Error("Keyword suggestion supersession failed");
      }
      return {
        kind: "reschedule",
        reason: inserted.kind,
        requestNextBatch: true,
        initiatedBy,
      };
    }
    if (inserted.kind !== "inserted" && inserted.kind !== "replayed") {
      throw new Error("Keyword review suggestion batch was not inserted");
    }
    if (
      !(await runs.setProgress(
        attempt,
        terminalProgress(
          frozen.manifest.candidates.length,
          suggestions.length,
          { kind: "completed", requestNextBatch: true },
        ),
      ))
    ) {
      throw new Error("Keyword suggestion generation progress fence changed");
    }
    const terminalized =
      await new KeywordGovernanceSuggestionGenerationRunsRepository(
        tx,
      ).terminalize(attempt, {
        status: "completed",
        resultOutputHash: result.invocation.outputHash,
        lastErrorCode: null,
        lastErrorSummary: null,
      });
    if (terminalized.kind !== "terminalized") {
      throw new Error("Keyword suggestion generation completion failed");
    }
    return { kind: "completed", requestNextBatch: true, initiatedBy };
  });
}

/**
 * Execute one claimed Keyword-governance suggestion batch. The provider call
 * begins only after the database has durably reserved its paid attempt and no
 * transaction remains open across the network boundary.
 */
export async function runKeywordGovernanceSuggestionGeneration(
  ctx: WorkerContext,
  payloadValue: unknown,
  dependencies: KeywordGovernanceSuggestionGenerationDependencies = {},
): Promise<KeywordGovernanceSuggestionGenerationOutcome> {
  const parsedPayload = JobPayloadSchema.safeParse(payloadValue);
  if (!parsedPayload.success) {
    return { kind: "settled", requestNextBatch: false };
  }
  const payload = parsedPayload.data;
  const scope: ProjectScope = {
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
  };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(scope, payload.runId);
  if (claimed === null) {
    return recoverTerminalOutcome(
      await runs.findById(scope, payload.runId),
      scope,
      payload.runId,
    );
  }
  if (
    claimed.id !== payload.runId ||
    claimed.workspace_id !== scope.workspaceId ||
    claimed.project_id !== scope.projectId ||
    claimed.kind !== "keyword_governance_suggestion_generation" ||
    claimed.result_type !== "keyword_governance_suggestion_generation_run" ||
    claimed.result_id !== payload.runId
  ) {
    await terminalizeFailure(
      ctx,
      toRunAttempt(claimed),
      "KEYWORD_GOVERNANCE_SUGGESTION_RUN_INVALID",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  const attempt = toRunAttempt(claimed);
  let ledger: KeywordGovernanceSuggestionGenerationRunRow | null;
  try {
    ledger =
      await new KeywordGovernanceSuggestionGenerationRunsRepository(
        ctx.db,
      ).findById(scope, payload.runId);
  } catch (error) {
    if (
      isTransientInfrastructureError(error) &&
      (await resetForRetry(runs, attempt, error))
    ) {
      throw error;
    }
    await terminalizeFailure(
      ctx,
      attempt,
      "KEYWORD_GOVERNANCE_SUGGESTION_INPUT_INVALID",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  if (ledger === null) {
    await terminalizeFailure(
      ctx,
      attempt,
      "KEYWORD_GOVERNANCE_SUGGESTION_INPUT_INVALID",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  let frozen: FrozenInput;
  try {
    frozen = loadManifest(ledger, scope, payload.runId);
  } catch {
    await terminalizeFailure(
      ctx,
      attempt,
      "KEYWORD_GOVERNANCE_SUGGESTION_INPUT_INVALID",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  const expected: ExpectedInvocationIdentity = {
    provider: "openai",
    model: ctx.openai.model,
    promptSetVersion: frozen.ledger.prompt_set_version,
    inputHash: frozen.promptInputHash,
  };
  const createClient =
    dependencies.createClient ?? createOpenAIKeywordGovernanceSuggestionClient;
  let client: KeywordGovernanceSuggestionGenerationClient;
  const omitTemperature =
    ctx.openai.authScheme === "api-key" &&
    ctx.openai.temperature === DEFAULT_HOSTED_OPENAI_TEMPERATURE;
  try {
    client = createClient({
      apiKey: ctx.openai.apiKey,
      model: ctx.openai.model,
      ...(ctx.openai.temperature === undefined || omitTemperature
        ? {}
        : { temperature: ctx.openai.temperature }),
      ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
      ...(ctx.openai.authScheme ? { authScheme: ctx.openai.authScheme } : {}),
      timeoutMs: KEYWORD_GOVERNANCE_SUGGESTION_REQUEST_TIMEOUT_MS,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
  } catch (error) {
    await terminalizeFailure(
      ctx,
      attempt,
      error instanceof LLMError ? error.code : "CONFIG_INVALID",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  let reservationResult: Awaited<
    ReturnType<
      KeywordGovernanceSuggestionInvocationAttemptsRepository["reserve"]
    >
  >;
  try {
    reservationResult =
      await new KeywordGovernanceSuggestionInvocationAttemptsRepository(
        ctx.db,
      ).reserve(attempt, expected);
  } catch (error) {
    if (
      isTransientInfrastructureError(error) &&
      (await resetForRetry(runs, attempt, error))
    ) {
      throw error;
    }
    await terminalizeFailure(
      ctx,
      attempt,
      "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_RESERVATION_FAILED",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  if (
    reservationResult.kind === "stale" ||
    reservationResult.kind === "existing"
  ) {
    return { kind: "settled", requestNextBatch: false };
  }
  if (reservationResult.kind === "unresolved") {
    await terminalizeFailure(
      ctx,
      attempt,
      OUTCOME_UNKNOWN_CODE,
      OUTCOME_UNKNOWN_SUMMARY,
    );
    return { kind: "settled", requestNextBatch: false };
  }
  if (reservationResult.kind === "budget_exhausted") {
    await terminalizeFailure(
      ctx,
      attempt,
      "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_BUDGET_EXHAUSTED",
      "Keyword governance suggestion invocation budget was exhausted.",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  if (reservationResult.kind === "configuration_mismatch") {
    await terminalizeFailure(
      ctx,
      attempt,
      "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_CONFIGURATION_MISMATCH",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  if (reservationResult.kind !== "reserved") {
    return { kind: "settled", requestNextBatch: false };
  }
  const reservation = reservationResult.reservation;
  if (!validReservation(reservation, attempt, expected)) {
    await terminalizeFailure(
      ctx,
      attempt,
      "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_CONFIGURATION_MISMATCH",
    );
    return { kind: "settled", requestNextBatch: false };
  }
  let result: Awaited<
    ReturnType<
      KeywordGovernanceSuggestionGenerationClient["generateKeywordGovernanceSuggestions"]
    >
  >;
  try {
    result = await client.generateKeywordGovernanceSuggestions(frozen.manifest);
  } catch (error) {
    if (error instanceof LLMError && error.invocation !== null) {
      if (isAmbiguousTransportModelError(error)) {
        await markOutcomeUnknown(
          ctx,
          attempt,
          reservation.id,
          "PROVIDER_OUTCOME_UNKNOWN",
        );
        await terminalizeFailure(
          ctx,
          attempt,
          OUTCOME_UNKNOWN_CODE,
          OUTCOME_UNKNOWN_SUMMARY,
        );
        return { kind: "settled", requestNextBatch: false };
      }
      const transient = isTransientModelError(error);
      const disposition = await commitKnownInvocationWithoutSuggestions(
        ctx,
        attempt,
        reservation.id,
        error.invocation,
        expected,
        { retry: transient, errorCode: error.code },
      );
      if (disposition === "outcome_unknown") {
        await terminalizeFailure(
          ctx,
          attempt,
          OUTCOME_UNKNOWN_CODE,
          OUTCOME_UNKNOWN_SUMMARY,
        );
        return { kind: "settled", requestNextBatch: false };
      }
      if (transient && disposition === "reset") throw error;
      return { kind: "settled", requestNextBatch: false };
    }
    await markOutcomeUnknown(
      ctx,
      attempt,
      reservation.id,
      "PROVIDER_OUTCOME_UNKNOWN",
    );
    await terminalizeFailure(
      ctx,
      attempt,
      OUTCOME_UNKNOWN_CODE,
      OUTCOME_UNKNOWN_SUMMARY,
    );
    return { kind: "settled", requestNextBatch: false };
  }
  const suggestionIdsByKeywordId = Object.fromEntries(
    frozen.manifest.candidates.map((candidate) => [
      candidate.keywordId,
      (dependencies.createSuggestionId ?? (() => randomUUID()))(
        candidate.keywordId,
        candidate.ordinal,
      ),
    ]),
  );
  let suggestions: readonly KeywordReviewSuggestionBatchItem[];
  try {
    invocationMetadata(result.invocation, expected);
  } catch {
    await markOutcomeUnknown(
      ctx,
      attempt,
      reservation.id,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    await terminalizeFailure(
      ctx,
      attempt,
      OUTCOME_UNKNOWN_CODE,
      OUTCOME_UNKNOWN_SUMMARY,
    );
    return { kind: "settled", requestNextBatch: false };
  }
  if (!hasExactGenerationResultEnvelope(result)) {
    const rejectedInvocation: AnalysisInvocationRecord = {
      ...result.invocation,
      outputHash: null,
      status: "rejected",
      errorCode: "SCHEMA_INVALID",
    };
    const disposition = await commitKnownInvocationWithoutSuggestions(
      ctx,
      attempt,
      reservation.id,
      rejectedInvocation,
      expected,
      { retry: false, errorCode: "SCHEMA_INVALID" },
    );
    if (disposition === "outcome_unknown") {
      await terminalizeFailure(
        ctx,
        attempt,
        OUTCOME_UNKNOWN_CODE,
        OUTCOME_UNKNOWN_SUMMARY,
      );
    }
    return { kind: "settled", requestNextBatch: false };
  }
  try {
    suggestions = resolveKeywordGovernanceSuggestions({
      manifest: frozen.manifest,
      output: result.output,
      suggestionIdsByKeywordId,
    });
  } catch (error) {
    if (error instanceof LLMError) {
      const rejectedInvocation: AnalysisInvocationRecord = {
        ...result.invocation,
        outputHash: null,
        status: "rejected",
        errorCode: error.code,
      };
      const disposition = await commitKnownInvocationWithoutSuggestions(
        ctx,
        attempt,
        reservation.id,
        rejectedInvocation,
        expected,
        { retry: false, errorCode: error.code },
      );
      if (disposition === "outcome_unknown") {
        await terminalizeFailure(
          ctx,
          attempt,
          OUTCOME_UNKNOWN_CODE,
          OUTCOME_UNKNOWN_SUMMARY,
        );
      }
      return { kind: "settled", requestNextBatch: false };
    }
    throw error;
  }
  try {
    return await commitSuccessfulResult(
      ctx,
      scope,
      attempt,
      claimed.initiated_by,
      reservation.id,
      frozen,
      expected,
      result,
      suggestions,
    );
  } catch {
    await markOutcomeUnknown(
      ctx,
      attempt,
      reservation.id,
      "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    );
    const failureDisposition = await terminalizeFailure(
      ctx,
      attempt,
      OUTCOME_UNKNOWN_CODE,
      OUTCOME_UNKNOWN_SUMMARY,
    );
    if (failureDisposition === "stale") {
      return recoverTerminalOutcome(
        await runs.findById(scope, attempt.runId),
        scope,
        attempt.runId,
      );
    }
    return { kind: "settled", requestNextBatch: false };
  }
}
