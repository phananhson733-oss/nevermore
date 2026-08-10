import {
  LLMError,
  MAX_TOPIC_MODEL_GROUPS,
  MAX_TOPIC_MODEL_CHILDREN,
  MAX_TOPIC_MODEL_DESCRIPTION_CHARS,
  MAX_TOPIC_MODEL_LABEL_CHARS,
  TOPIC_MODEL_PROMPT_SET_VERSION,
  createOpenAITopicModelClient,
  prepareTopicModelGeneration,
  type AnalysisInvocationRecord,
  type TopicModelClientOptions,
  type TopicModelGenerationClient,
  type TopicModelGenerationInput,
  type TopicModelGenerationResult,
  type TopicModelSearchIntent,
} from "@sf/artifacts";
import {
  Uuid,
  parseTopicModelGenerationInputManifest,
  type TopicModelGenerationInputManifest,
} from "@sf/contracts";
import {
  AsyncRunsRepository,
  KeywordGovernanceRepository,
  TopicModelConflictError,
  TopicModelGenerationInvocationAttemptsRepository,
  TopicModelGenerationRunsRepository,
  TopicModelsRepository,
  contentHash,
  toRunAttempt,
  type CanonicalValue,
  type GeneratedTopicAssignmentReport,
  type ProjectScope,
  type RunAttempt,
  type TopicModelGenerationInvocationMetadata,
  type TopicModelGenerationRunRow,
} from "@sf/db";
import { scheduleKeywordGovernanceSuggestions } from "@sf/db/keyword-governance-suggestion-scheduler";
import { z } from "zod";
import type { WorkerContext } from "../context.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";

export const TOPIC_MODEL_GENERATION_VERSION =
  "topic-model-generation.v1" as const;
export const TOPIC_MODEL_GENERATION_OUTCOME_SCHEMA_VERSION =
  "topic-model-generation-outcome.v1" as const;
export const TOPIC_MODEL_GENERATION_REQUEST_TIMEOUT_MS = 45_000;

const GROUP_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SEARCH_INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const;
const MAX_GROUP_KEY_CHARS = 128;

const BoundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim());
const NullableBoundedText = (maximum: number) =>
  BoundedText(maximum).nullable();
const NonNegativeSafeInteger = z.number().int().nonnegative().safe();
/** The only projection admitted to the LLM; keyword IDs and lineage stay local. */
export function buildTopicModelGenerationClientInput(
  value: unknown,
): TopicModelGenerationInput {
  const manifest = parseTopicModelGenerationInputManifest(value);
  return {
    market: manifest.market,
    language: manifest.language,
    groups: manifest.groups,
    productProfile: manifest.productProfile,
    icp: manifest.icp,
  };
}

export interface TopicModelGenerationJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface TopicModelGenerationDependencies {
  readonly createClient?: (
    options: TopicModelClientOptions,
  ) => TopicModelGenerationClient;
  readonly scheduleKeywordGovernanceSuggestions?: typeof scheduleKeywordGovernanceSuggestions;
}

const JobPayloadSchema = z
  .object({ runId: Uuid, workspaceId: Uuid, projectId: Uuid })
  .strict();
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const TOPIC_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TopicKeySchema = BoundedText(80).regex(TOPIC_KEY);
const IntentEnvelopeSchema = z
  .array(z.enum(SEARCH_INTENTS))
  .max(SEARCH_INTENTS.length)
  .refine((values) => new Set(values).size === values.length);
const InvocationSchema = z
  .object({
    task: z.literal("topic_model_generation"),
    provider: BoundedText(200),
    model: BoundedText(200),
    promptSetVersion: BoundedText(200),
    inputHash: z.string().regex(SHA256_HEX),
    outputHash: z.string().regex(SHA256_HEX).nullable(),
    status: z.enum(["succeeded", "failed", "rejected"]),
    inputTokens: NonNegativeSafeInteger.nullable(),
    outputTokens: NonNegativeSafeInteger.nullable(),
    costUsd: z.number().finite().nonnegative().nullable(),
    latencyMs: NonNegativeSafeInteger,
    errorCode: z.string().regex(ERROR_CODE).nullable(),
  })
  .strict()
  .superRefine((invocation, ctx) => {
    const valid =
      invocation.status === "succeeded"
        ? invocation.outputHash !== null && invocation.errorCode === null
        : invocation.outputHash === null && invocation.errorCode !== null;
    if (!valid) {
      ctx.addIssue({
        code: "custom",
        message: "invocation terminal facts are inconsistent",
      });
    }
  });
const ResultNodeSchema = z
  .object({
    topicKey: TopicKeySchema,
    label: BoundedText(MAX_TOPIC_MODEL_LABEL_CHARS),
    description: NullableBoundedText(MAX_TOPIC_MODEL_DESCRIPTION_CHARS),
    intentEnvelope: IntentEnvelopeSchema,
  })
  .strict();
const ResultSchema = z
  .object({
    rootIntent: ResultNodeSchema.extend({
      kind: z.literal("create_root"),
    }).strict(),
    childIntents: z
      .array(
        ResultNodeSchema.extend({
          kind: z.literal("create_child"),
          parentTopicKey: TopicKeySchema,
        }).strict(),
      )
      .min(1)
      .max(MAX_TOPIC_MODEL_CHILDREN),
    groupAssignments: z
      .array(
        z
          .object({
            groupKey: BoundedText(MAX_GROUP_KEY_CHARS).regex(GROUP_KEY),
            topicKey: TopicKeySchema,
            generatedIntent: z.enum(SEARCH_INTENTS),
          })
          .strict(),
      )
      .max(MAX_TOPIC_MODEL_GROUPS),
    unassignedGroupKeys: z
      .array(BoundedText(MAX_GROUP_KEY_CHARS).regex(GROUP_KEY))
      .max(MAX_TOPIC_MODEL_GROUPS),
    invocation: InvocationSchema,
  })
  .strict();

class TopicModelGenerationInputError extends Error {
  override readonly name = "TopicModelGenerationInputError";
}

class TopicModelGenerationResultError extends Error {
  override readonly name = "TopicModelGenerationResultError";
}

interface FrozenTopicModelGenerationInput {
  readonly ledger: TopicModelGenerationRunRow;
  readonly manifest: TopicModelGenerationInputManifest;
  readonly providerInput: TopicModelGenerationInput;
  readonly promptInputHash: string;
}

interface ExpectedInvocationIdentity {
  readonly provider: "openai";
  readonly model: string;
  readonly promptSetVersion: string;
  readonly inputHash: string;
}

const GENERATED_ASSIGNMENT_SKIP_REASONS = [
  "unknown_group",
  "topic_revision_moved",
  "topic_node_absent",
  "intent_unavailable",
  "keyword_absent",
  "human_decision_exists",
  "revision_moved",
  "revision_exhausted",
  "ledger_unreadable",
  "conflict",
] as const;
type GeneratedAssignmentSkipReason =
  (typeof GENERATED_ASSIGNMENT_SKIP_REASONS)[number];

const SAFE_FAILURE_SUMMARY = "Topic Model generation failed.";
const SAFE_RETRY_SUMMARY = "Topic Model generation will be retried.";
const SUPERSEDED = {
  status: "cancelled" as const,
  resultTopicModelRevisionId: null,
  lastErrorCode: "TOPIC_MODEL_GENERATION_SUPERSEDED",
  lastErrorSummary: "Topic Model generation was superseded.",
};
const INVOCATION_OUTCOME_UNKNOWN_CODE =
  "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN";
const INVOCATION_OUTCOME_UNKNOWN_SUMMARY =
  "The provider invocation outcome could not be safely recovered.";
const PROVIDER_OUTCOME_UNKNOWN = "PROVIDER_OUTCOME_UNKNOWN";
const INVOCATION_IDENTITY_MISMATCH = "INVOCATION_IDENTITY_MISMATCH";
const POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN =
  "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN";

function invalidInput(): never {
  throw new TopicModelGenerationInputError();
}

function invalidResult(): never {
  throw new TopicModelGenerationResultError();
}

async function loadFrozenInput(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
): Promise<FrozenTopicModelGenerationInput> {
  const ledger = await new TopicModelGenerationRunsRepository(ctx.db).findById(
    scope,
    runId,
  );
  if (
    ledger === null ||
    ledger.id !== runId ||
    ledger.workspace_id !== scope.workspaceId ||
    ledger.project_id !== scope.projectId ||
    ledger.generation_version !== TOPIC_MODEL_GENERATION_VERSION ||
    ledger.prompt_set_version !== TOPIC_MODEL_PROMPT_SET_VERSION ||
    ledger.result_topic_model_revision_id !== null
  ) {
    invalidInput();
  }
  const manifest = parseTopicModelGenerationInputManifest(
    ledger.input_manifest,
  );
  if (
    manifest.projectId !== scope.projectId ||
    manifest.analysisRefreshRunId !== ledger.analysis_refresh_run_id ||
    contentHash(ledger.input_manifest as CanonicalValue) !== ledger.input_hash
  ) {
    invalidInput();
  }
  const providerInput = buildTopicModelGenerationClientInput(manifest);
  const promptInputHash = prepareTopicModelGeneration(providerInput).inputHash;
  if (
    ledger.prompt_input_hash !== null &&
    ledger.prompt_input_hash !== promptInputHash
  ) {
    invalidInput();
  }
  return { ledger, manifest, providerInput, promptInputHash };
}

function invocationMetadata(
  invocation: AnalysisInvocationRecord,
  expected: ExpectedInvocationIdentity,
): TopicModelGenerationInvocationMetadata {
  const parsed = InvocationSchema.safeParse(invocation);
  if (
    !parsed.success ||
    parsed.data.provider !== expected.provider ||
    parsed.data.model !== expected.model ||
    parsed.data.promptSetVersion !== expected.promptSetVersion ||
    parsed.data.inputHash !== expected.inputHash
  ) {
    invalidResult();
  }
  return {
    provider: parsed.data.provider,
    model: parsed.data.model,
    promptSetVersion: parsed.data.promptSetVersion,
    inputHash: parsed.data.inputHash,
    outputHash: parsed.data.outputHash,
    status: parsed.data.status,
    inputTokens: parsed.data.inputTokens,
    outputTokens: parsed.data.outputTokens,
    costUsd: parsed.data.costUsd,
    latencyMs: parsed.data.latencyMs,
    errorCode: parsed.data.errorCode,
  };
}

function validateResult(
  value: unknown,
  frozen: FrozenTopicModelGenerationInput,
  expected: ExpectedInvocationIdentity,
): TopicModelGenerationResult {
  const parsed = ResultSchema.safeParse(value);
  if (!parsed.success) invalidResult();
  const result = parsed.data;
  const topicKeys = [
    result.rootIntent.topicKey,
    ...result.childIntents.map((child) => child.topicKey),
  ];
  const labels = [
    result.rootIntent.label,
    ...result.childIntents.map((child) => child.label),
  ];
  if (
    new Set(topicKeys).size !== topicKeys.length ||
    new Set(labels).size !== labels.length ||
    result.childIntents.some(
      (child) => child.parentTopicKey !== result.rootIntent.topicKey,
    )
  ) {
    invalidResult();
  }
  const inputGroups = new Set(
    frozen.manifest.groups.map((group) => group.groupKey),
  );
  const assignedGroups = new Set<string>();
  const assignedIntents = new Map<string, Set<TopicModelSearchIntent>>();
  for (const assignment of result.groupAssignments) {
    if (
      !inputGroups.has(assignment.groupKey) ||
      !topicKeys.includes(assignment.topicKey) ||
      assignedGroups.has(assignment.groupKey)
    ) {
      invalidResult();
    }
    assignedGroups.add(assignment.groupKey);
    const intents = assignedIntents.get(assignment.topicKey) ?? new Set();
    intents.add(assignment.generatedIntent);
    assignedIntents.set(assignment.topicKey, intents);
  }
  const unassigned = new Set(result.unassignedGroupKeys);
  if (
    unassigned.size !== result.unassignedGroupKeys.length ||
    result.unassignedGroupKeys.some(
      (groupKey) => !inputGroups.has(groupKey) || assignedGroups.has(groupKey),
    ) ||
    assignedGroups.size + unassigned.size !== inputGroups.size
  ) {
    invalidResult();
  }
  const nodes = [result.rootIntent, ...result.childIntents];
  for (const node of nodes) {
    const expectedEnvelope = SEARCH_INTENTS.filter((intent) =>
      assignedIntents.get(node.topicKey)?.has(intent),
    );
    if (
      expectedEnvelope.length !== node.intentEnvelope.length ||
      expectedEnvelope.some(
        (intent, index) => node.intentEnvelope[index] !== intent,
      )
    ) {
      invalidResult();
    }
  }
  const metadata = invocationMetadata(result.invocation, expected);
  if (metadata.status !== "succeeded") invalidResult();
  return result as TopicModelGenerationResult;
}

function validReservation(
  reservation: {
    readonly workspace_id: string;
    readonly project_id: string;
    readonly topic_model_generation_run_id: string;
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
    reservation.topic_model_generation_run_id === attempt.runId &&
    reservation.async_attempt_count === attempt.attemptCount &&
    reservation.provider === expected.provider &&
    reservation.model === expected.model &&
    reservation.prompt_set_version === expected.promptSetVersion &&
    reservation.input_hash === expected.inputHash &&
    reservation.status === "reserved"
  );
}

function isTransientTopicModelError(error: unknown): boolean {
  return (
    (error instanceof LLMError &&
      ["NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED", "SERVER_ERROR"].includes(
        error.code,
      )) ||
    isTransientInfrastructureError(error)
  );
}

function stableErrorCode(error: unknown): string {
  if (error instanceof LLMError) return error.code;
  if (error instanceof TopicModelGenerationInputError) {
    return "TOPIC_MODEL_GENERATION_INPUT_INVALID";
  }
  if (error instanceof TopicModelGenerationResultError) {
    return "TOPIC_MODEL_GENERATION_RESULT_INVALID";
  }
  return "TOPIC_MODEL_GENERATION_FAILED";
}

async function terminalizeFailure(
  ctx: WorkerContext,
  attempt: RunAttempt,
  code: string,
  summary = SAFE_FAILURE_SUMMARY,
): Promise<boolean> {
  const result = await new TopicModelGenerationRunsRepository(ctx.db).terminalize(
    attempt,
    {
      status: "failed",
      resultTopicModelRevisionId: null,
      lastErrorCode: code,
      lastErrorSummary: summary,
    },
  );
  if (result.kind === "conflict") {
    throw new Error("Topic Model generation terminal state conflicted");
  }
  return result.kind === "terminalized";
}

async function resetForRetry(
  ctx: WorkerContext,
  runs: AsyncRunsRepository,
  attempt: RunAttempt,
  error: unknown,
): Promise<boolean> {
  const code = error instanceof LLMError ? error.code : transientFailureCode(error);
  const reset = await runs.resetToQueued(attempt, {
    code,
    summary: SAFE_RETRY_SUMMARY,
  });
  if (reset) {
    try {
      ctx.logger.warn("topic_model_generation_retry", { code });
    } catch {
      // Durable run state is canonical.
    }
  }
  return reset;
}

async function markOutcomeUnknown(
  attempts: TopicModelGenerationInvocationAttemptsRepository,
  attempt: RunAttempt,
  reservationId: string,
  code: string,
): Promise<void> {
  try {
    await attempts.markOutcomeUnknown(attempt, reservationId, code);
  } catch {
    // The reservation itself prevents an unproven replay.
  }
}

type KnownInvocationDisposition =
  | "terminalized"
  | "reset"
  | "stale"
  | "outcome_unknown";

async function commitKnownInvocationWithoutDomainWrites(
  ctx: WorkerContext,
  attempt: RunAttempt,
  reservationId: string,
  invocation: AnalysisInvocationRecord,
  expected: ExpectedInvocationIdentity,
  outcome: {
    readonly retry: boolean;
    readonly errorCode: string;
    readonly errorSummary: string;
  },
): Promise<KnownInvocationDisposition> {
  let metadata: TopicModelGenerationInvocationMetadata;
  try {
    metadata = invocationMetadata(invocation, expected);
  } catch {
    await markOutcomeUnknown(
      new TopicModelGenerationInvocationAttemptsRepository(ctx.db),
      attempt,
      reservationId,
      INVOCATION_IDENTITY_MISMATCH,
    );
    return "outcome_unknown";
  }
  try {
    return await ctx.db.transaction(async (tx) => {
      const runs = new AsyncRunsRepository(tx);
      if (!(await runs.lockAttemptForUpdate(attempt))) return "stale";
      const finalized =
        await new TopicModelGenerationInvocationAttemptsRepository(
          tx,
        ).finalizeWithInvocation(attempt, reservationId, metadata);
      if (finalized.kind !== "finalized") invalidResult();
      if (outcome.retry) {
        const reset = await runs.resetToQueued(attempt, {
          code: outcome.errorCode,
          summary: outcome.errorSummary,
        });
        if (!reset) throw new Error("Topic Model retry fence changed");
        return "reset";
      }
      const terminalized = await new TopicModelGenerationRunsRepository(
        tx,
      ).terminalize(attempt, {
        status: "failed",
        resultTopicModelRevisionId: null,
        lastErrorCode: outcome.errorCode,
        lastErrorSummary: outcome.errorSummary,
      });
      if (terminalized.kind !== "terminalized") {
        throw new Error("Topic Model failure terminalization failed");
      }
      return "terminalized";
    });
  } catch {
    await markOutcomeUnknown(
      new TopicModelGenerationInvocationAttemptsRepository(ctx.db),
      attempt,
      reservationId,
      POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN,
    );
    return "outcome_unknown";
  }
}

function validateAssignmentReport(
  report: GeneratedTopicAssignmentReport,
  keywordCount: number,
): void {
  if (
    !Number.isSafeInteger(report.assignedCount) ||
    report.assignedCount < 0 ||
    !Number.isSafeInteger(report.skippedCount) ||
    report.skippedCount < 0 ||
    report.assignedCount + report.skippedCount !== keywordCount ||
    report.outcomes.length !== keywordCount
  ) {
    invalidResult();
  }
  let skipped = 0;
  for (const reason of GENERATED_ASSIGNMENT_SKIP_REASONS) {
    const count = report.skipped[reason];
    if (!Number.isSafeInteger(count) || count < 0) invalidResult();
    skipped += count;
  }
  if (skipped !== report.skippedCount) invalidResult();
}

function outcomeProgress(
  frozen: FrozenTopicModelGenerationInput,
  result: TopicModelGenerationResult,
  report: GeneratedTopicAssignmentReport,
): Record<string, unknown> {
  validateAssignmentReport(report, frozen.manifest.keywords.length);
  const limitations: string[] = [];
  if (report.skippedCount > 0) {
    limitations.push("keyword_assignments_skipped");
  }
  if (result.unassignedGroupKeys.length > 0) {
    limitations.push("topic_groups_unassigned");
  }
  const skipReasons = Object.fromEntries(
    GENERATED_ASSIGNMENT_SKIP_REASONS.map((reason) => [
      reason,
      report.skipped[reason],
    ]),
  ) as Record<GeneratedAssignmentSkipReason, number>;
  return {
    schemaVersion: TOPIC_MODEL_GENERATION_OUTCOME_SCHEMA_VERSION,
    keywordGroupCount: frozen.manifest.groups.length,
    keywordCount: frozen.manifest.keywords.length,
    assignedCount: report.assignedCount,
    skippedCount: report.skippedCount,
    unassignedGroupCount: result.unassignedGroupKeys.length,
    skipReasons,
    limitations,
  };
}

async function commitSuccessfulResult(
  ctx: WorkerContext,
  scope: ProjectScope,
  attempt: RunAttempt,
  reservationId: string,
  frozen: FrozenTopicModelGenerationInput,
  expected: ExpectedInvocationIdentity,
  result: TopicModelGenerationResult,
): Promise<"completed" | "superseded" | "stale"> {
  return ctx.db.transaction(async (tx) => {
    const runs = new AsyncRunsRepository(tx);
    const lockedRun = await runs.lockAttemptForUpdate(attempt);
    if (lockedRun === null) return "stale";

    const attempts = new TopicModelGenerationInvocationAttemptsRepository(tx);
    const finalized = await attempts.finalizeWithInvocation(
      attempt,
      reservationId,
      invocationMetadata(result.invocation, expected),
    );
    if (finalized.kind !== "finalized") invalidResult();

    let materialized: Awaited<
      ReturnType<TopicModelsRepository["materializeSystemConfirmedFirstRevision"]>
    >;
    try {
      materialized = await new TopicModelsRepository(
        tx,
      ).materializeSystemConfirmedFirstRevision(scope, {
        initiatedBy: lockedRun.initiated_by,
        root: {
          topicKey: result.rootIntent.topicKey,
          label: result.rootIntent.label,
          description: result.rootIntent.description,
          intentEnvelope: result.rootIntent.intentEnvelope,
        },
        children: result.childIntents.map((child) => ({
          topicKey: child.topicKey,
          label: child.label,
          description: child.description,
          intentEnvelope: child.intentEnvelope,
        })),
        generationVersion: frozen.ledger.generation_version,
        analysisInvocationId: finalized.invocationId,
        promptSetVersion: frozen.ledger.prompt_set_version,
        inputHash: frozen.ledger.input_hash,
        keywordGroupCount: frozen.manifest.groups.length,
        keywordCount: frozen.manifest.keywords.length,
      });
    } catch (error) {
      if (
        error instanceof TopicModelConflictError &&
        (error.code === "DRAFT_EXISTS" ||
          error.code === "MODEL_REVISION_CONFLICT")
      ) {
        const terminalized = await new TopicModelGenerationRunsRepository(
          tx,
        ).terminalize(attempt, SUPERSEDED);
        if (terminalized.kind !== "terminalized") {
          throw new Error("Topic Model superseded terminalization failed");
        }
        return "superseded";
      }
      throw error;
    }

    const assignmentByGroup = new Map(
      result.groupAssignments.map((assignment) => [
        assignment.groupKey,
        assignment,
      ]),
    );
    const report = await new KeywordGovernanceRepository(
      tx,
    ).applyGeneratedTopicAssignments(scope, {
      groups: result.groupAssignments.map((assignment) => ({
        groupKey: assignment.groupKey,
        topicNodeId:
          materialized.topicNodeIdsByKey[assignment.topicKey] ?? invalidResult(),
        topicModelRevision: materialized.model.topicModelRevision,
      })),
      assignments: frozen.manifest.keywords.map((keyword) => {
        const providerIntent = keyword.providerSearchIntent?.value ?? null;
        const generated = assignmentByGroup.get(keyword.groupKey);
        return {
          groupKey: keyword.groupKey,
          keywordId: keyword.keywordId,
          expectedGovernanceRevision: keyword.expectedGovernanceRevision,
          resolvedIntent:
            providerIntent !== null
              ? {
                  authority: "provider_observed" as const,
                  value: providerIntent,
                  analysisInvocationId: null,
                }
              : generated === undefined
                ? null
                : {
                    authority: "llm_generated" as const,
                    value: generated.generatedIntent,
                    analysisInvocationId: finalized.invocationId,
                  },
        };
      }),
    });
    const progress = outcomeProgress(frozen, result, report);
    if (!(await runs.setProgress(attempt, progress))) {
      throw new Error("Topic Model generation progress fence changed");
    }
    const terminalized = await new TopicModelGenerationRunsRepository(
      tx,
    ).terminalize(attempt, {
      status: "completed",
      resultTopicModelRevisionId: materialized.topicModelRevisionId,
      lastErrorCode: null,
      lastErrorSummary: null,
    });
    if (terminalized.kind !== "terminalized") {
      throw new Error("Topic Model generation completion failed");
    }
    return "completed";
  });
}

/**
 * Execute one claimed Topic Model generation child. The paid provider boundary
 * is crossed only after a durable reservation and outside every transaction.
 */
export async function runTopicModelGeneration(
  ctx: WorkerContext,
  payloadValue: unknown,
  dependencies: TopicModelGenerationDependencies = {},
): Promise<void> {
  const parsedPayload = JobPayloadSchema.safeParse(payloadValue);
  if (!parsedPayload.success) return;
  const payload: TopicModelGenerationJobPayload = parsedPayload.data;
  const scope: ProjectScope = {
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
  };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(scope, payload.runId);
  if (claimed === null) return;
  const attempt = toRunAttempt(claimed);
  if (
    claimed.id !== payload.runId ||
    claimed.workspace_id !== scope.workspaceId ||
    claimed.project_id !== scope.projectId ||
    claimed.kind !== "topic_model_generation" ||
    claimed.result_type !== "topic_model_generation_run" ||
    claimed.result_id !== payload.runId
  ) {
    await terminalizeFailure(
      ctx,
      attempt,
      "TOPIC_MODEL_GENERATION_RUN_INVALID",
    );
    return;
  }

  let frozen: FrozenTopicModelGenerationInput;
  try {
    frozen = await loadFrozenInput(ctx, scope, payload.runId);
  } catch (error) {
    if (isTransientTopicModelError(error)) {
      if (await resetForRetry(ctx, runs, attempt, error)) throw error;
      return;
    }
    await terminalizeFailure(
      ctx,
      attempt,
      "TOPIC_MODEL_GENERATION_INPUT_INVALID",
    );
    return;
  }

  const expected: ExpectedInvocationIdentity = {
    provider: "openai",
    model: ctx.openai.model,
    promptSetVersion: frozen.ledger.prompt_set_version,
    inputHash: frozen.promptInputHash,
  };
  let client: TopicModelGenerationClient;
  try {
    const createClient = dependencies.createClient ?? createOpenAITopicModelClient;
    client = createClient({
      apiKey: ctx.openai.apiKey,
      model: ctx.openai.model,
      ...(ctx.openai.temperature === undefined
        ? {}
        : { temperature: ctx.openai.temperature }),
      ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
      ...(ctx.openai.authScheme
        ? { authScheme: ctx.openai.authScheme }
        : {}),
      timeoutMs: TOPIC_MODEL_GENERATION_REQUEST_TIMEOUT_MS,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
  } catch (error) {
    await terminalizeFailure(ctx, attempt, stableErrorCode(error));
    return;
  }

  const attempts = new TopicModelGenerationInvocationAttemptsRepository(ctx.db);
  let reservationResult: Awaited<ReturnType<typeof attempts.reserve>>;
  try {
    reservationResult = await attempts.reserve(attempt, expected);
  } catch (error) {
    if (await resetForRetry(ctx, runs, attempt, error)) throw error;
    return;
  }
  if (reservationResult.kind === "stale" || reservationResult.kind === "existing") {
    return;
  }
  if (reservationResult.kind === "unresolved") {
    await terminalizeFailure(
      ctx,
      attempt,
      INVOCATION_OUTCOME_UNKNOWN_CODE,
      INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
    );
    return;
  }
  if (reservationResult.kind === "budget_exhausted") {
    await terminalizeFailure(
      ctx,
      attempt,
      "TOPIC_MODEL_GENERATION_INVOCATION_BUDGET_EXHAUSTED",
      "Topic Model generation invocation budget was exhausted.",
    );
    return;
  }
  if (reservationResult.kind === "configuration_mismatch") {
    await terminalizeFailure(
      ctx,
      attempt,
      "TOPIC_MODEL_GENERATION_INVOCATION_CONFIGURATION_MISMATCH",
    );
    return;
  }
  if (reservationResult.kind !== "reserved") return;
  const reservation = reservationResult.reservation;
  if (!validReservation(reservation, attempt, expected)) {
    await terminalizeFailure(
      ctx,
      attempt,
      "TOPIC_MODEL_GENERATION_INVOCATION_CONFIGURATION_MISMATCH",
    );
    return;
  }

  let rawResult: TopicModelGenerationResult;
  try {
    // No database transaction is open across this network boundary.
    rawResult = await client.generateTopicModel(frozen.providerInput);
  } catch (error) {
    if (error instanceof LLMError && error.invocation !== null) {
      const transient = isTransientTopicModelError(error);
      const disposition = await commitKnownInvocationWithoutDomainWrites(
        ctx,
        attempt,
        reservation.id,
        error.invocation,
        expected,
        {
          retry: transient,
          errorCode: stableErrorCode(error),
          errorSummary: transient ? SAFE_RETRY_SUMMARY : SAFE_FAILURE_SUMMARY,
        },
      );
      if (disposition === "outcome_unknown") {
        await terminalizeFailure(
          ctx,
          attempt,
          INVOCATION_OUTCOME_UNKNOWN_CODE,
          INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
        );
        return;
      }
      if (disposition === "reset") {
        try {
          ctx.logger.warn("topic_model_generation_retry", {
            code: error.code,
          });
        } catch {
          // The reset is already durable.
        }
        throw error;
      }
      return;
    }
    await markOutcomeUnknown(
      attempts,
      attempt,
      reservation.id,
      PROVIDER_OUTCOME_UNKNOWN,
    );
    await terminalizeFailure(
      ctx,
      attempt,
      INVOCATION_OUTCOME_UNKNOWN_CODE,
      INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
    );
    return;
  }

  let result: TopicModelGenerationResult;
  try {
    result = validateResult(rawResult, frozen, expected);
  } catch (error) {
    const candidateInvocation =
      typeof rawResult === "object" && rawResult !== null
        ? (rawResult as { readonly invocation?: unknown }).invocation
        : undefined;
    if (candidateInvocation === undefined) {
      await markOutcomeUnknown(
        attempts,
        attempt,
        reservation.id,
        INVOCATION_IDENTITY_MISMATCH,
      );
      await terminalizeFailure(
        ctx,
        attempt,
        INVOCATION_OUTCOME_UNKNOWN_CODE,
        INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
      );
    } else {
      const disposition = await commitKnownInvocationWithoutDomainWrites(
        ctx,
        attempt,
        reservation.id,
        candidateInvocation as AnalysisInvocationRecord,
        expected,
        {
          retry: false,
          errorCode: stableErrorCode(error),
          errorSummary: SAFE_FAILURE_SUMMARY,
        },
      );
      if (disposition === "outcome_unknown") {
        await terminalizeFailure(
          ctx,
          attempt,
          INVOCATION_OUTCOME_UNKNOWN_CODE,
          INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
        );
      }
    }
    return;
  }

  try {
    const committed = await commitSuccessfulResult(
      ctx,
      scope,
      attempt,
      reservation.id,
      frozen,
      expected,
      result,
    );
    if (committed === "completed") {
      try {
        const scheduleSuggestions =
          dependencies.scheduleKeywordGovernanceSuggestions ??
          scheduleKeywordGovernanceSuggestions;
        await scheduleSuggestions(
          { db: ctx.db, boss: ctx.boss },
          { scope, initiatedBy: claimed.initiated_by },
        );
      } catch {
        try {
          ctx.logger.warn("keyword_governance_suggestion_schedule_failed", {
            code: "KEYWORD_GOVERNANCE_SUGGESTION_SCHEDULE_FAILED",
            source: "topic_model_confirmation",
          });
        } catch {
          // Topic confirmation is already committed.
        }
      }
      try {
        ctx.logger.info("topic_model_generation_completed", {
          status: "completed",
          keywordGroupCount: frozen.manifest.groups.length,
          keywordCount: frozen.manifest.keywords.length,
        });
      } catch {
        // Canonical database state is already committed.
      }
    }
    if (committed !== "stale") return;
  } catch {
    // The successful invocation and all domain writes shared Tx B; a rejected
    // commit leaves only the durable pre-call reservation.
  }
  await markOutcomeUnknown(
    attempts,
    attempt,
    reservation.id,
    POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN,
  );
  await terminalizeFailure(
    ctx,
    attempt,
    INVOCATION_OUTCOME_UNKNOWN_CODE,
    INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
  );
}
