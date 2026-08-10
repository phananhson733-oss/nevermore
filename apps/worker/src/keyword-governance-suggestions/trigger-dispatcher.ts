import {
  KeywordGovernanceScheduleRequestsRepository,
  type ClaimedKeywordGovernanceScheduleRequest,
  type ProjectScope,
} from "@sf/db";
import {
  scheduleKeywordGovernanceSuggestions,
  type ScheduleKeywordGovernanceSuggestionsResult,
} from "@sf/db/keyword-governance-suggestion-scheduler";
import type { WorkerContext } from "../context.ts";

export const KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_INTERVAL_MS = 30_000;
export const KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_BATCH_SIZE = 25;
export const KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_LEASE_SECONDS = 60;
const DISPATCH_FAILURE_CODE =
  "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED" as const;

type ScheduleSuggestions = (
  context: Parameters<typeof scheduleKeywordGovernanceSuggestions>[0],
  input: Parameters<typeof scheduleKeywordGovernanceSuggestions>[1],
) => Promise<ScheduleKeywordGovernanceSuggestionsResult>;

interface DispatchDependencies {
  readonly schedule?: ScheduleSuggestions;
  readonly leaseSeconds?: number;
}

interface DispatchRequestInput {
  readonly scope: ProjectScope;
  readonly requestId: string;
}

interface DispatchContinuationRequestInput {
  readonly scope: ProjectScope;
  readonly sourceKind: "generation_continuation";
  readonly sourceRef: string;
}

export type KeywordGovernanceScheduleDispatchResult =
  | { readonly kind: "completed" }
  | { readonly kind: "stale" }
  | { readonly kind: "unavailable" };

export interface KeywordGovernanceTriggerDispatcherSummary {
  readonly claimedCount: number;
  readonly completedCount: number;
  readonly releasedCount: number;
  readonly staleCount: number;
}

interface TriggerDispatcherSweepOptions {
  readonly limit?: number;
  readonly leaseSeconds?: number;
  readonly signal?: AbortSignal;
  readonly schedule?: ScheduleSuggestions;
}

interface TriggerDispatcherLoopOptions {
  readonly intervalMs?: number;
  readonly sweep?: () => Promise<unknown>;
}

export interface KeywordGovernanceSuggestionTriggerDispatcherLoop {
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

type ClaimedDispatchResult =
  | { readonly kind: "completed" }
  | { readonly kind: "stale" }
  | {
      readonly kind: "failed";
      readonly releaseKind: "released" | "stale";
      readonly error: unknown;
    };

function integerInRange(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function safeError(
  ctx: WorkerContext,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    ctx.logger.error(event, fields);
  } catch {
    // Durable request state remains authoritative when logging is unavailable.
  }
}

async function dispatchClaimedRequest(
  ctx: WorkerContext,
  request: ClaimedKeywordGovernanceScheduleRequest,
  schedule: ScheduleSuggestions,
): Promise<ClaimedDispatchResult> {
  const scope = {
    workspaceId: request.workspaceId,
    projectId: request.projectId,
  };
  try {
    await schedule(
      { db: ctx.db, boss: ctx.boss },
      { scope, initiatedBy: request.initiatedBy },
    );
  } catch (error) {
    let releaseKind: "released" | "stale" = "stale";
    try {
      const released = await new KeywordGovernanceScheduleRequestsRepository(
        ctx.db,
      ).release(scope, {
        requestId: request.id,
        claimToken: request.claimToken,
        errorCode: DISPATCH_FAILURE_CODE,
      });
      releaseKind = released.kind;
    } catch {
      // The unexpired lease prevents a competing claim; expiry makes it due.
    }
    safeError(ctx, "keyword_governance_schedule_dispatch_failed", {
      code: DISPATCH_FAILURE_CODE,
      requestId: request.id,
      sourceKind: request.sourceKind,
    });
    return { kind: "failed", releaseKind, error };
  }

  const completed = await new KeywordGovernanceScheduleRequestsRepository(
    ctx.db,
  ).complete(scope, {
    requestId: request.id,
    claimToken: request.claimToken,
  });
  return completed.kind === "completed"
    ? { kind: "completed" }
    : { kind: "stale" };
}

async function dispatchClaim(
  ctx: WorkerContext,
  claim:
    | { readonly kind: "claimed"; readonly request: ClaimedKeywordGovernanceScheduleRequest }
    | { readonly kind: "unavailable" },
  schedule: ScheduleSuggestions,
): Promise<KeywordGovernanceScheduleDispatchResult> {
  if (claim.kind === "unavailable") return claim;
  const result = await dispatchClaimedRequest(ctx, claim.request, schedule);
  if (result.kind === "failed") throw result.error;
  return result;
}

/** Best-effort low-latency dispatch after the producer transaction commits. */
export async function dispatchKeywordGovernanceScheduleRequest(
  ctx: WorkerContext,
  input: DispatchRequestInput,
  dependencies: DispatchDependencies = {},
): Promise<KeywordGovernanceScheduleDispatchResult> {
  const leaseSeconds = integerInRange(
    dependencies.leaseSeconds ??
      KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_LEASE_SECONDS,
    "Keyword governance trigger lease",
    5,
    300,
  );
  const claim = await new KeywordGovernanceScheduleRequestsRepository(
    ctx.db,
  ).claimRequest(input.scope, {
    requestId: input.requestId,
    leaseSeconds,
  });
  return dispatchClaim(
    ctx,
    claim,
    dependencies.schedule ?? scheduleKeywordGovernanceSuggestions,
  );
}

/** Best-effort dispatch of the durable continuation created by the terminal-run trigger. */
export async function dispatchKeywordGovernanceScheduleRequestBySource(
  ctx: WorkerContext,
  input: DispatchContinuationRequestInput,
  dependencies: DispatchDependencies = {},
): Promise<KeywordGovernanceScheduleDispatchResult> {
  const leaseSeconds = integerInRange(
    dependencies.leaseSeconds ??
      KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_LEASE_SECONDS,
    "Keyword governance trigger lease",
    5,
    300,
  );
  const claim = await new KeywordGovernanceScheduleRequestsRepository(
    ctx.db,
  ).claimBySource(input.scope, {
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    leaseSeconds,
  });
  return dispatchClaim(
    ctx,
    claim,
    dependencies.schedule ?? scheduleKeywordGovernanceSuggestions,
  );
}

/** Claim one bounded SKIP LOCKED batch and converge every claimed request. */
export async function runKeywordGovernanceSuggestionTriggerDispatcherSweep(
  ctx: WorkerContext,
  options: TriggerDispatcherSweepOptions = {},
): Promise<KeywordGovernanceTriggerDispatcherSummary> {
  if (options.signal?.aborted || ctx.signal?.aborted) {
    return {
      claimedCount: 0,
      completedCount: 0,
      releasedCount: 0,
      staleCount: 0,
    };
  }
  const limit = integerInRange(
    options.limit ?? KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_BATCH_SIZE,
    "Keyword governance trigger batch size",
    1,
    100,
  );
  const leaseSeconds = integerInRange(
    options.leaseSeconds ??
      KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_LEASE_SECONDS,
    "Keyword governance trigger lease",
    5,
    300,
  );
  const requests = await new KeywordGovernanceScheduleRequestsRepository(
    ctx.db,
  ).claimDue({ limit, leaseSeconds });
  const schedule = options.schedule ?? scheduleKeywordGovernanceSuggestions;
  let completedCount = 0;
  let releasedCount = 0;
  let staleCount = 0;

  for (const request of requests) {
    const result = await dispatchClaimedRequest(ctx, request, schedule);
    if (result.kind === "completed") completedCount += 1;
    else if (result.kind === "stale") staleCount += 1;
    else if (result.releaseKind === "released") releasedCount += 1;
    else staleCount += 1;
  }
  const summary = {
    claimedCount: requests.length,
    completedCount,
    releasedCount,
    staleCount,
  } as const;
  try {
    ctx.logger.info("keyword_governance_trigger_dispatch_completed", summary);
  } catch {
    // Durable request state remains authoritative when logging is unavailable.
  }
  return summary;
}

/** Immediate bounded sweep plus a short recovery polling interval. */
export function startKeywordGovernanceSuggestionTriggerDispatcherLoop(
  ctx: WorkerContext,
  options: TriggerDispatcherLoopOptions = {},
): KeywordGovernanceSuggestionTriggerDispatcherLoop {
  const intervalMs = integerInRange(
    options.intervalMs ?? KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_INTERVAL_MS,
    "Keyword governance trigger dispatcher interval",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const sweep =
    options.sweep ??
    (() => runKeywordGovernanceSuggestionTriggerDispatcherSweep(ctx));
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight !== null) return inFlight;
    const current = (async () => {
      try {
        await sweep();
      } catch {
        safeError(ctx, "keyword_governance_trigger_dispatcher_failed", {
          code: "KEYWORD_GOVERNANCE_TRIGGER_DISPATCHER_FAILED",
        });
      }
    })().finally(() => {
      if (inFlight === current) inFlight = null;
    });
    inFlight = current;
    return current;
  };
  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  timer.unref();
  void runNow();

  const stop = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise;
    stopped = true;
    clearInterval(timer);
    stopPromise = inFlight ?? Promise.resolve();
    return stopPromise;
  };
  return { runNow, stop };
}
