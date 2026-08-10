import { randomUUID } from "node:crypto";
import { CONTRACT_VERSION } from "@sf/contracts";
import { sql } from "drizzle-orm";
import type { Db, DbTx } from "./client.ts";
import {
  freezeKeywordGovernanceSuggestionInput,
} from "./keyword-governance-suggestion-freezer.ts";
import {
  enqueueRunInTx,
  type PgBoss,
} from "./queue.ts";
import {
  AsyncRunsRepository,
  type AsyncRunRow,
} from "./repositories/async-runs.ts";
import type { ProjectScope } from "./repositories/base.ts";
import { KeywordGovernanceSuggestionGenerationRunsRepository } from "./repositories/keyword-governance-suggestion-generation-runs.ts";
import {
  KeywordReviewSuggestionsRepository,
  type ReusableKeywordReviewSuggestionBatchResult,
} from "./repositories/keyword-review-suggestions.ts";

export const KEYWORD_GOVERNANCE_SUGGESTION_QUEUE =
  "keyword-governance-suggestion.generate" as const;
export const KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY =
  "keyword-governance-suggestion:generation" as const;

export type ScheduleKeywordGovernanceSuggestionsResult =
  | {
      readonly kind: "queued";
      readonly runId: string;
      readonly inputHash: string;
      readonly candidateCount: number;
      readonly hasMore: boolean;
    }
  /** An existing generation owns this signal and its own follow-on chain. */
  | { readonly kind: "active"; readonly runId: string }
  | {
      readonly kind: "exact_pending_reused";
      readonly generationRunId: string;
      readonly inputHash: string;
      readonly suggestionCount: number;
    }
  | { readonly kind: "no_candidates" }
  /** Stable missing Profile/Topic authority; a future authority producer retries. */
  | { readonly kind: "authority_unavailable" };

export interface KeywordGovernanceSuggestionSchedulerContext {
  readonly db: Db;
  readonly boss: PgBoss;
}

export interface ScheduleKeywordGovernanceSuggestionsInput {
  readonly scope: ProjectScope;
  readonly initiatedBy: string;
}

export interface KeywordGovernanceSuggestionSchedulerDependencies {
  readonly createRunId?: () => string;
  readonly enqueueRunInTx?: typeof enqueueRunInTx;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIVE_RUN_UNIQUE_CONSTRAINT = "async_runs_one_active_key_idx";
const MAX_CAUSE_DEPTH = 8;

function readProperty(
  value: object,
  property: "code" | "constraint" | "cause",
): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function isActiveRunRace(error: unknown): boolean {
  let current = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (
      current === null ||
      (typeof current !== "object" && typeof current !== "function")
    ) {
      return false;
    }
    const object = current as object;
    if (seen.has(object)) return false;
    seen.add(object);
    if (
      readProperty(object, "code") === "23505" &&
      readProperty(object, "constraint") === ACTIVE_RUN_UNIQUE_CONSTRAINT
    ) {
      return true;
    }
    current = readProperty(object, "cause");
  }
  return false;
}

function activeResult(
  run: AsyncRunRow,
  scope: ProjectScope,
): ScheduleKeywordGovernanceSuggestionsResult {
  if (
    run.workspace_id !== scope.workspaceId ||
    run.project_id !== scope.projectId ||
    run.kind !== "keyword_governance_suggestion_generation" ||
    (run.status !== "queued" && run.status !== "running") ||
    run.active_key !== KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY ||
    run.result_type !== "keyword_governance_suggestion_generation_run" ||
    run.result_id !== run.id
  ) {
    throw new Error("Keyword suggestion scheduler active run projection is invalid");
  }
  return { kind: "active", runId: run.id };
}

function reusableResult(
  reusable: Extract<
    ReusableKeywordReviewSuggestionBatchResult,
    { kind: "reusable" }
  >,
): ScheduleKeywordGovernanceSuggestionsResult {
  return {
    kind: "exact_pending_reused",
    generationRunId: reusable.generationRunId,
    inputHash: reusable.inputHash,
    suggestionCount: reusable.suggestions.length,
  };
}

function assertSchedulerInput(
  input: ScheduleKeywordGovernanceSuggestionsInput,
): void {
  if (
    !UUID.test(input.scope.workspaceId) ||
    !UUID.test(input.scope.projectId) ||
    !UUID.test(input.initiatedBy)
  ) {
    throw new RangeError("Keyword suggestion scheduler scope is invalid");
  }
}

async function lockSchedulerScope(
  tx: DbTx,
  scope: ProjectScope,
): Promise<void> {
  // Serialize producers for this project so a winning generation cannot finish
  // between another producer's reuse probe and active-run insert.
  await tx.execute(sql`
    select pg_advisory_xact_lock(
      hashtext(${scope.workspaceId}),
      hashtext(${scope.projectId})
    )
  `);
}

async function scheduleInTransaction(
  ctx: KeywordGovernanceSuggestionSchedulerContext,
  tx: DbTx,
  input: ScheduleKeywordGovernanceSuggestionsInput,
  dependencies: Required<KeywordGovernanceSuggestionSchedulerDependencies>,
): Promise<ScheduleKeywordGovernanceSuggestionsResult> {
  await lockSchedulerScope(tx, input.scope);
  const runs = new AsyncRunsRepository(tx);
  const active = await runs.findActive(
    input.scope,
    KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY,
  );
  if (active !== null) return activeResult(active, input.scope);

  const generationRuns =
    new KeywordGovernanceSuggestionGenerationRunsRepository(tx);
  const authority = await generationRuns.readPrimaryFreezeAuthority(
    input.scope,
  );
  if (authority.kind === "unavailable") {
    return { kind: "authority_unavailable" };
  }

  const suggestions = new KeywordReviewSuggestionsRepository(tx);
  if (authority.kind === "no_candidates") {
    const current = await suggestions.findCurrentReusableCompletedBatch(
      input.scope,
    );
    return current.kind === "reusable"
      ? reusableResult(current)
      : { kind: "no_candidates" };
  }

  const frozen = freezeKeywordGovernanceSuggestionInput(authority.authority);
  const reusable = await suggestions.findReusableCompletedBatch(
    input.scope,
    frozen.inputHash,
  );
  if (reusable.kind === "reusable") {
    if (reusable.inputHash !== frozen.inputHash) {
      throw new Error("Reusable Keyword suggestion input hash drifted");
    }
    return reusableResult(reusable);
  }

  const runId = dependencies.createRunId();
  if (!UUID.test(runId)) {
    throw new Error("Keyword suggestion scheduler generated an invalid run id");
  }
  const run = await runs.insertQueued({
    runId,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    kind: "keyword_governance_suggestion_generation",
    activeKey: KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY,
    initiatedBy: input.initiatedBy,
    contractVersion: CONTRACT_VERSION,
    requestPayload: { inputHash: frozen.inputHash },
    resultType: "keyword_governance_suggestion_generation_run",
    resultId: runId,
  });
  if (
    run.id !== runId ||
    run.workspace_id !== input.scope.workspaceId ||
    run.project_id !== input.scope.projectId ||
    run.kind !== "keyword_governance_suggestion_generation" ||
    run.status !== "queued" ||
    run.active_key !== KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY ||
    run.result_type !== "keyword_governance_suggestion_generation_run" ||
    run.result_id !== runId
  ) {
    throw new Error("Keyword suggestion scheduler run projection is invalid");
  }
  await generationRuns.insertPlaceholder({
    runId,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    inputManifest: frozen.manifest,
    inputHash: frozen.inputHash,
  });
  const jobId = await dependencies.enqueueRunInTx(
    ctx.boss,
    tx,
    KEYWORD_GOVERNANCE_SUGGESTION_QUEUE,
    {
      runId,
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      contractVersion: CONTRACT_VERSION,
    },
  );
  if (jobId !== runId) {
    throw new Error("Keyword suggestion scheduler queue identity is invalid");
  }
  return {
    kind: "queued",
    runId,
    inputHash: frozen.inputHash,
    candidateCount: frozen.manifest.candidates.length,
    hasMore: authority.hasMore,
  };
}

/**
 * Freeze and atomically enqueue one bounded Keyword-governance suggestion
 * batch. Source producers call this only after their own authoritative commit;
 * callers decide how to log this best-effort derivative operation.
 */
export async function scheduleKeywordGovernanceSuggestions(
  ctx: KeywordGovernanceSuggestionSchedulerContext,
  input: ScheduleKeywordGovernanceSuggestionsInput,
  dependencies: KeywordGovernanceSuggestionSchedulerDependencies = {},
): Promise<ScheduleKeywordGovernanceSuggestionsResult> {
  assertSchedulerInput(input);
  const resolvedDependencies = {
    createRunId: dependencies.createRunId ?? randomUUID,
    enqueueRunInTx: dependencies.enqueueRunInTx ?? enqueueRunInTx,
  };
  try {
    return await ctx.db.transaction((tx) =>
      scheduleInTransaction(ctx, tx, input, resolvedDependencies)
    );
  } catch (error) {
    if (!isActiveRunRace(error)) throw error;
    const winner = await new AsyncRunsRepository(ctx.db).findActive(
      input.scope,
      KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY,
    );
    if (winner === null) throw error;
    return activeResult(winner, input.scope);
  }
}
