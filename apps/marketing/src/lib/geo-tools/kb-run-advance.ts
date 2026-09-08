// @input  -- the durable operation ledger for one knowledge base update, plus an executor that can do one operation
// @output -- exactly one operation attempted per invocation and its outcome written back before returning
// @pos    -- orchestration only; it holds no transport and performs no fetch, SERP, Search Console or model call itself

/**
 * Resume, not replay.
 *
 * A single invocation of this function reads the ledger, asks `planGeoRun` what
 * to do next, attempts at most one operation, writes the outcome down, and
 * hands the run back. Being killed at any point is therefore survivable: the
 * next invocation reads the same rows and continues from what they say.
 *
 * The two rules everything else follows from:
 *
 *   1. The dispatch mark is written BEFORE the request leaves. A row still
 *      reading `claimed` provably sent nothing; a row reading `dispatched` may
 *      already have been billed.
 *   2. Anything that goes wrong AFTER the dispatch mark is `outcome_unknown`,
 *      never a retryable failure. We would rather leave a paid operation
 *      unresolved and say so than pay for it twice quietly.
 */

import {
  geoRunOperationAction,
  planGeoRun,
  type GeoRunAction,
  type GeoRunOperationKind,
} from "./kb-run-plan.ts";
import type {
  GeoRunLedgerStore,
  GeoRunOperationReason,
  GeoRunOperationRecord,
  GeoRunOperationSeed,
  GeoRunRecord,
  GeoRunScope,
} from "./kb-run-ledger.ts";

/**
 * How many times we ask "what happened to this?" before recording that we will
 * never know.
 *
 * Without a bound, an operation whose outcome cannot be recovered is probed on
 * every invocation and the run never completes: `planGeoRun` counts an
 * unresolved operation as outstanding forever. Giving up is not a retry -- it
 * spends nothing and it leaves the charge recorded as unresolved rather than
 * pretending it did not happen.
 */
export const GEO_RUN_PROBE_LIMIT = 3;

/**
 * A conservative wall-clock cost for one more operation of each kind.
 *
 * `model` is the sum of what the knowledge step actually does, not the model
 * call alone: the generation route's preparer runs the evidence collection
 * first, and that carries its own 70 s deadline
 * (`kb-knowledge-evidence.ts`), before the narrative runner's
 * `GEO_KNOWLEDGE_SYNTHESIS_V2_TIMEOUT_MS` (90 s) even starts. Costing it at the
 * synthesis timeout said an operation that can legitimately take 160 s fits in
 * 90 ms shy of 90 s of budget -- which is how a paid call gets started with
 * nothing left and killed mid-request, the one way a charge leaves no trace of
 * where it happened. The 10 s on top covers the free assemble that follows and
 * the writes on either side.
 */
export const GEO_RUN_ESTIMATED_MS: Readonly<Record<GeoRunOperationKind, number>> = {
  fetch: 10_000,
  serp: 15_000,
  gsc: 8_000,
  model: 170_000,
};

/** What one invocation may spend before it must hand back, inside a 300 s route. */
export const GEO_RUN_INVOCATION_BUDGET_MS = 250_000;

export type GeoRunStartOutcome =
  | { readonly kind: "succeeded"; readonly resultRef: string }
  /** We saw the response and it was not billed: a rate limit, a closed gate, a refused fetch. */
  | { readonly kind: "failed_retryable"; readonly reason: GeoRunOperationReason }
  | { readonly kind: "failed_permanent"; readonly reason: GeoRunOperationReason }
  /** We sent it and cannot say what happened. */
  | { readonly kind: "outcome_unknown" };

export type GeoRunProbeOutcome =
  | { readonly kind: "succeeded"; readonly resultRef: string }
  | { readonly kind: "failed_permanent"; readonly reason: GeoRunOperationReason }
  /**
   * Only meaningful for an expired claim: nothing was ever sent, so starting it
   * is not a second charge. The ledger refuses this from a dispatched or
   * unresolved operation even if an executor returns it.
   */
  | { readonly kind: "not_dispatched" }
  | { readonly kind: "unresolved" };

/**
 * The capability an operation gets while it runs.
 *
 * Narrow on purpose: a collect step may append the targets it discovered, and
 * the roles step may bind the generation input hash, but neither can change
 * another operation's state or close the run.
 */
export interface GeoRunContext {
  readonly userId: string;
  readonly kbId: string;
  readonly runId: string;
  readonly run: GeoRunRecord;
  readonly appendOperations: (operations: readonly GeoRunOperationSeed[]) => Promise<boolean>;
  /**
   * Record what this run's paid generations are pinned to.
   *
   * Three answers, not two. `conflict` is the run already carrying a different
   * locked input, which never resolves by waiting and must not be reported as
   * an outage -- an executor that read a boolean here would retry a refusal
   * forever. Re-binding the same value is the resume case and answers `bound`.
   */
  readonly bindGenerationInput: (
    generationInputHash: string,
  ) => Promise<"bound" | "conflict" | "unavailable">;
}

export interface GeoRunExecutor {
  /** Send this operation. Called only after the dispatch mark is durable. */
  readonly start: (
    operation: GeoRunOperationRecord,
    context: GeoRunContext,
  ) => Promise<GeoRunStartOutcome>;
  /** Find out what happened to an operation whose outcome we never saw. Must not send it. */
  readonly probe: (
    operation: GeoRunOperationRecord,
    context: GeoRunContext,
  ) => Promise<GeoRunProbeOutcome>;
}

export interface GeoRunAdvanceInput {
  readonly userId: string;
  readonly kbId: string;
  /** Resuming a known run; null when starting one from an idempotency key. */
  readonly runId: string | null;
  readonly idempotencyKey: string | null;
  /** Operations to seed when the run is created, or extend an existing run with. */
  readonly seed: readonly GeoRunOperationSeed[];
  readonly budgetMs?: number;
}

export interface GeoRunAdvanceDependencies {
  readonly store: GeoRunLedgerStore;
  readonly executor: GeoRunExecutor;
  readonly now: () => Date;
  readonly estimatedMs?: Readonly<Record<GeoRunOperationKind, number>>;
}

export type GeoRunAdvanceStatus =
  /** Nothing is outstanding; the run is closed. */
  | "complete"
  /** More to do; call again with the same run id. */
  | "in_progress"
  /** Everything left is held by another executor's live claim. Poll, do not force. */
  | "blocked"
  /** Another invocation holds this run's lease right now. */
  | "busy"
  /** A different run is already open on this knowledge base. */
  | "run_active"
  /** The run is already complete or abandoned. */
  | "finished"
  | "not_found"
  | "invalid"
  | "unavailable";

export interface GeoRunAdvanceResult {
  readonly status: GeoRunAdvanceStatus;
  readonly runId: string | null;
  readonly run: GeoRunRecord | null;
  readonly operations: readonly GeoRunOperationRecord[];
  /** Keys another executor holds. */
  readonly waiting: readonly string[];
  /** Keys that permanently failed, so the caller can say what is missing. */
  readonly skipped: readonly string[];
  readonly remaining: number;
  /** What this invocation did, if anything. */
  readonly acted: {
    readonly key: string;
    readonly action: GeoRunAction;
    readonly state: GeoRunOperationRecord["state"];
  } | null;
}

function result(
  status: GeoRunAdvanceStatus,
  run: GeoRunRecord | null,
  operations: readonly GeoRunOperationRecord[],
  extra: Partial<GeoRunAdvanceResult> = {},
): GeoRunAdvanceResult {
  return {
    status,
    runId: run?.runId ?? null,
    run,
    operations,
    waiting: [],
    skipped: [],
    remaining: 0,
    acted: null,
    ...extra,
  };
}

/**
 * Do the next thing this run needs, and only that.
 *
 * Returning `in_progress` is a normal, successful outcome: it is the shape
 * "hand back before the platform kills you" takes, and the caller's job is to
 * call again rather than to keep the request open.
 */
export async function advanceGeoKbRun(
  input: GeoRunAdvanceInput,
  dependencies: GeoRunAdvanceDependencies,
): Promise<GeoRunAdvanceResult> {
  const invocationStartedAt = dependencies.now();
  const claim = await dependencies.store.claimRun({
    userId: input.userId,
    kbId: input.kbId,
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    operations: input.seed,
  });
  if (claim.kind === "busy" || claim.kind === "run_active" || claim.kind === "finished") {
    return result(claim.kind, claim.run, claim.operations);
  }
  if (claim.kind !== "claimed") return result(claim.kind, null, []);

  const scope: GeoRunScope = {
    userId: input.userId,
    runId: claim.run.runId,
    leaseToken: claim.leaseToken,
  };
  try {
    return await work(input, dependencies, scope, claim.run, claim.operations, invocationStartedAt);
  } finally {
    // The lease is handed back on every path, including a thrown one. Holding
    // it would make this run's own next invocation report `busy`; a process
    // that dies instead leaves it held, which is what protects a request that
    // may still be in flight.
    await dependencies.store.releaseRun(scope).catch(() => undefined);
  }
}

async function work(
  input: GeoRunAdvanceInput,
  dependencies: GeoRunAdvanceDependencies,
  scope: GeoRunScope,
  run: GeoRunRecord,
  seeded: readonly GeoRunOperationRecord[],
  invocationStartedAt: Date,
): Promise<GeoRunAdvanceResult> {
  const budgetMs = input.budgetMs ?? GEO_RUN_INVOCATION_BUDGET_MS;
  const estimatedMs = dependencies.estimatedMs ?? GEO_RUN_ESTIMATED_MS;
  let operations = seeded;
  let current = run;

  const context: GeoRunContext = {
    userId: input.userId,
    kbId: input.kbId,
    runId: scope.runId,
    run,
    appendOperations: async (extra) => {
      const appended = await dependencies.store.appendOperations(scope, extra);
      if (appended.kind !== "found") return false;
      operations = appended.operations;
      current = appended.run;
      return true;
    },
    bindGenerationInput: async (hash) => {
      const bound = await dependencies.store.bindGenerationInput(scope, hash);
      if (bound.kind === "conflict") return "conflict";
      if (bound.kind !== "ok") return "unavailable";
      current = bound.run;
      return "bound";
    },
  };

  const plan = planGeoRun({
    operations,
    now: dependencies.now(),
    invocationStartedAt,
    budgetMs,
    estimatedMs,
  });
  if (plan.next === null) {
    if (plan.status === "complete") return await close(dependencies, scope, current, operations, plan.skipped);
    return result(plan.status === "blocked" ? "blocked" : "in_progress", current, operations, {
      waiting: plan.waiting,
      skipped: plan.skipped,
      remaining: plan.remaining,
    });
  }

  const target = plan.next.operation as GeoRunOperationRecord;
  const acted =
    plan.next.action === "probe"
      ? await probeOne(dependencies, scope, target, context)
      : await startOne(dependencies, scope, target, context);

  // Re-read rather than patch the array in memory: the executor may have
  // appended operations, and the row we just wrote is authoritative only as the
  // ledger stored it.
  const reread = await dependencies.store.readRun({
    userId: input.userId,
    kbId: input.kbId,
    runId: scope.runId,
  });
  if (reread.kind === "found") {
    operations = reread.operations;
    current = reread.run;
  }
  const after = planGeoRun({
    operations,
    now: dependencies.now(),
    invocationStartedAt,
    budgetMs,
    estimatedMs,
  });
  const acting = {
    key: target.key,
    action: plan.next.action,
    state: acted,
  };
  if (after.status === "complete") {
    return await close(dependencies, scope, current, operations, after.skipped, acting);
  }
  return result(after.status === "blocked" ? "blocked" : "in_progress", current, operations, {
    waiting: after.waiting,
    skipped: after.skipped,
    remaining: after.remaining,
    acted: acting,
  });
}

async function close(
  dependencies: GeoRunAdvanceDependencies,
  scope: GeoRunScope,
  run: GeoRunRecord,
  operations: readonly GeoRunOperationRecord[],
  skipped: readonly string[],
  acted: GeoRunAdvanceResult["acted"] = null,
): Promise<GeoRunAdvanceResult> {
  const finished = await dependencies.store.finishRun(scope);
  // A refused close is not an error the caller can act on: everything is
  // settled either way, and the next invocation will try again.
  return result(finished.kind === "ok" ? "complete" : "in_progress", finished.kind === "ok" ? finished.run : run, operations, {
    skipped,
    acted,
    remaining: finished.kind === "ok" ? 0 : operations.length,
  });
}

/**
 * Claim, mark dispatched, send, record.
 *
 * The order is the guarantee. Between the dispatch mark and the outcome write
 * there is exactly one awaited call, and every way it can end -- returning a
 * failure, rejecting, or the process disappearing -- leaves a row that says
 * "this may have been billed" rather than one that says "free to send again".
 */
async function startOne(
  dependencies: GeoRunAdvanceDependencies,
  scope: GeoRunScope,
  operation: GeoRunOperationRecord,
  context: GeoRunContext,
): Promise<GeoRunOperationRecord["state"]> {
  const claimed = await dependencies.store.claimOperation(scope, operation.key);
  // Someone else moved it, or the lease is gone. Nothing was sent.
  if (claimed.kind !== "ok") return claimed.kind === "conflict" && claimed.operation !== null ? claimed.operation.state : operation.state;
  const dispatched = await dependencies.store.dispatchOperation(scope, operation.key);
  if (dispatched.kind !== "ok") {
    return dispatched.kind === "conflict" && dispatched.operation !== null
      ? dispatched.operation.state
      : "claimed";
  }

  let outcome: GeoRunStartOutcome;
  try {
    outcome = await dependencies.executor.start(dispatched.operation, context);
  } catch {
    // The request went out. We do not know what came back, and that is exactly
    // the case that must not become a retry.
    outcome = { kind: "outcome_unknown" };
  }
  const written = await dependencies.store.finishOperation(
    scope,
    operation.key,
    outcome.kind === "succeeded"
      ? { state: "succeeded", resultRef: outcome.resultRef }
      : outcome.kind === "outcome_unknown"
        ? { state: "outcome_unknown" }
        : { state: outcome.kind, reason: outcome.reason },
  );
  return written.kind === "ok" ? written.operation.state : "dispatched";
}

/**
 * Find out what happened, then say so -- or say we never will.
 *
 * `not_dispatched` is honoured only for an operation the ledger still shows as
 * claimed, because that is the only state in which "nothing was sent" is a
 * fact rather than a hope. Everywhere else it is treated as unresolved, and the
 * ledger would refuse it anyway.
 */
async function probeOne(
  dependencies: GeoRunAdvanceDependencies,
  scope: GeoRunScope,
  operation: GeoRunOperationRecord,
  context: GeoRunContext,
): Promise<GeoRunOperationRecord["state"]> {
  let found: GeoRunProbeOutcome;
  try {
    found = await dependencies.executor.probe(operation, context);
  } catch {
    found = { kind: "unresolved" };
  }
  const neverSent = operation.state === "claimed";
  const resolved: GeoRunOperationRecord["state"] | null =
    found.kind === "succeeded"
      ? "succeeded"
      : found.kind === "failed_permanent"
        ? "failed_permanent"
        : found.kind === "not_dispatched" && neverSent
          ? "failed_retryable"
          : null;
  const giveUp = resolved === null && operation.probeCount + 1 >= GEO_RUN_PROBE_LIMIT;
  const written = await dependencies.store.probeOperation(
    scope,
    operation.key,
    found.kind === "succeeded"
      ? { state: "succeeded", resultRef: found.resultRef }
      : found.kind === "failed_permanent"
        ? { state: "failed_permanent", reason: found.reason }
        : resolved === "failed_retryable"
          ? { state: "failed_retryable", reason: "lease_expired" }
          : giveUp
            ? { state: "failed_permanent", reason: "outcome_unknown" }
            : { state: "outcome_unknown" },
  );
  return written.kind === "ok" ? written.operation.state : operation.state;
}

/** The action a plan would take for one stored operation, for callers that only want to report. */
export function geoRunOperationActionNow(
  operation: GeoRunOperationRecord,
  now: Date,
): GeoRunAction {
  return geoRunOperationAction(operation, now);
}
