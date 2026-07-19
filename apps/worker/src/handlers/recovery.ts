import {
  AsyncRunsRepository,
  ExecutionArtifactsRepository,
  IdempotencyRepository,
  OAuthIntentsRepository,
  type AsyncRunRow,
  type JobWithMetadata,
  type ProjectScope,
  type QueueName,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";

export const RUN_RECOVERY_INTERVAL_MS = 60_000;
export const RUN_RECOVERY_MISSING_AFTER_MS = 60 * 60 * 1_000;
export const RUN_RECOVERY_BATCH_SIZE = 100;

interface CanonicalJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

interface ReconcileOptions {
  readonly scope?: ProjectScope;
  readonly now?: Date;
  readonly missingAfterMs?: number;
  readonly limit?: number;
}

interface RecoveryLoopOptions {
  readonly intervalMs?: number;
  readonly missingAfterMs?: number;
  readonly reconcile?: () => Promise<void>;
}

export interface RunRecoveryLoop {
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

const COLLECTION_QUEUE_BY_PROVIDER: Readonly<Record<string, QueueName>> = {
  crawl: "collect.crawl",
  gsc: "collect.gsc",
  ga4: "collect.ga4",
  csv: "collect.csv",
};

/** Map a canonical run to the one public pg-boss queue that may own it. */
export function queueForRun(
  run: Pick<AsyncRunRow, "kind" | "request_payload">,
): QueueName | null {
  switch (run.kind) {
    case "collection": {
      const provider = run.request_payload["provider"];
      return typeof provider === "string"
        ? (COLLECTION_QUEUE_BY_PROVIDER[provider] ?? null)
        : null;
    }
    case "diagnostic":
      return "diagnose";
    case "artifact_generation":
      return "artifact.generate";
    case "export":
      return "export.bundle";
    default:
      return null;
  }
}

/**
 * Gate a pg-boss delivery against the canonical ledger before invoking a
 * runner. Delivery metadata is part of the safety condition: only a genuine
 * later retry may recover a canonical row left running by a crashed process.
 */
export async function prepareRunDelivery<T extends CanonicalJobPayload>(
  ctx: WorkerContext,
  job: JobWithMetadata<T>,
  execute: (payload: T) => Promise<void>,
): Promise<void> {
  const scope = scopeFromPayload(job.data);
  const runs = new AsyncRunsRepository(ctx.db);
  const prepared = await runs.prepareDelivery(
    scope,
    job.data.runId,
    job.retryCount,
  );

  if (!prepared) {
    ctx.logger.warn("run_delivery_skipped", {
      code: "CANONICAL_RUN_NOT_DELIVERABLE",
      runId: job.data.runId,
      retryCount: job.retryCount,
    });
    return;
  }

  try {
    await execute(job.data);
  } catch (error: unknown) {
    if (job.retryCount >= job.retryLimit) {
      let reconciled = false;
      try {
        reconciled = await reconcileCanonicalAndProjection(
          ctx,
          prepared,
          scope,
          {
            status: "failed",
            lastErrorCode: "QUEUE_RETRY_EXHAUSTED",
            lastErrorSummary:
              "Queue retries exhausted before the run completed.",
          },
        );
      } catch {
        // Preserve the runner error for pg-boss. A later recovery sweep will
        // retry the atomic canonical/projection reconciliation.
        ctx.logger.error("run_delivery_reconciliation_failed", {
          code: "QUEUE_RETRY_EXHAUSTED",
          runId: job.data.runId,
        });
      }
      if (reconciled) {
        ctx.logger.error("run_delivery_reconciled", {
          code: "QUEUE_RETRY_EXHAUSTED",
          runId: job.data.runId,
        });
      }
    }
    throw error;
  }
}

/**
 * Reconcile canonical active rows with pg-boss using public APIs only. Live
 * queue states remain untouched. Terminal/missing jobs are converted into a
 * stable canonical terminal result through a scope-checked compare-and-set.
 */
export async function reconcileActiveRuns(
  ctx: WorkerContext,
  options: ReconcileOptions = {},
): Promise<void> {
  const runs = new AsyncRunsRepository(ctx.db);
  const active = await runs.listActiveForRecovery(
    options.scope ?? null,
    options.limit ?? RUN_RECOVERY_BATCH_SIZE,
  );
  const now = options.now ?? new Date();
  const missingAfterMs =
    options.missingAfterMs ?? RUN_RECOVERY_MISSING_AFTER_MS;

  for (const run of active) {
    try {
      await reconcileOne(ctx, run, now, missingAfterMs);
    } catch {
      // Lookup/database errors are retryable on the next sweep. Never include a
      // raw exception or job payload in logs because those may carry secrets.
      ctx.logger.error("run_recovery_failed", {
        code: "RUN_RECOVERY_CHECK_FAILED",
        runId: run.id,
      });
    }
  }
}

/** One startup/minutely maintenance sweep: scrub OAuth temporaries, then runs. */
export async function runRecoverySweep(
  ctx: WorkerContext,
  options: ReconcileOptions = {},
): Promise<void> {
  const now = options.now ?? new Date();
  try {
    const count = await new OAuthIntentsRepository(ctx.db).scrubExpired(now);
    if (count > 0) ctx.logger.info("oauth_intents_scrubbed", { count });
  } catch {
    // Cleanup is retried next minute. Never log rows/errors: both may contain
    // credential material from a legacy intent.
    ctx.logger.error("oauth_intent_scrub_failed", {
      code: "OAUTH_INTENT_SCRUB_FAILED",
    });
  }
  try {
    const count = await new IdempotencyRepository(ctx.db).pruneExpired();
    if (count > 0) ctx.logger.info("idempotency_keys_pruned", { count });
  } catch {
    // Expiry correctness is enforced atomically in the repository; this sweep
    // is capacity maintenance and can safely retry next minute.
    ctx.logger.error("idempotency_key_prune_failed", {
      code: "IDEMPOTENCY_KEY_PRUNE_FAILED",
    });
  }
  await reconcileActiveRuns(ctx, { ...options, now });
}

/** Start one immediate sweep plus an unref'd, closeable periodic sweep. */
export function startRunRecoveryLoop(
  ctx: WorkerContext,
  options: RecoveryLoopOptions = {},
): RunRecoveryLoop {
  const intervalMs = options.intervalMs ?? RUN_RECOVERY_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("run recovery interval must be positive");
  }

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const reconcile =
    options.reconcile ??
    (() =>
      runRecoverySweep(ctx, {
        missingAfterMs:
          options.missingAfterMs ?? RUN_RECOVERY_MISSING_AFTER_MS,
      }));

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    const current = Promise.resolve()
      .then(reconcile)
      .finally(() => {
        if (inFlight === current) inFlight = null;
      });
    inFlight = current;
    return inFlight;
  };

  const reportPeriodicFailure = (): void => {
    ctx.logger.error("run_recovery_failed", {
      code: "RUN_RECOVERY_SWEEP_FAILED",
    });
  };
  const timer = setInterval(() => {
    void runNow().catch(reportPeriodicFailure);
  }, intervalMs);
  timer.unref();

  // Start now; callers may await runNow() to make this startup sweep a
  // readiness condition without scheduling it twice.
  void runNow().catch(reportPeriodicFailure);

  return {
    runNow,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await inFlight?.catch(() => undefined);
    },
  };
}

async function reconcileOne(
  ctx: WorkerContext,
  run: AsyncRunRow,
  now: Date,
  missingAfterMs: number,
): Promise<void> {
  const scope: ProjectScope = {
    workspaceId: run.workspace_id,
    projectId: run.project_id,
  };
  const queue = queueForRun(run);
  if (!queue) {
    await terminalize(ctx, run, scope, {
      status: "failed",
      code: "QUEUE_MAPPING_INVALID",
      summary: "The active run cannot be mapped to a supported queue.",
    });
    return;
  }

  const jobs = await findCanonicalJobs(ctx, queue, run);
  if (jobs.some((job) => isLiveQueueState(job.state))) return;

  if (jobs.some((job) => job.state === "failed")) {
    await terminalize(ctx, run, scope, {
      status: "failed",
      code: "QUEUE_JOB_FAILED",
      summary: "The queue job failed before the run completed.",
    });
    return;
  }
  if (jobs.some((job) => job.state === "cancelled")) {
    await terminalize(ctx, run, scope, {
      status: "cancelled",
      code: "QUEUE_JOB_CANCELLED",
      summary: "The queue job was cancelled before the run completed.",
    });
    return;
  }
  if (jobs.some((job) => job.state === "completed")) {
    await terminalize(ctx, run, scope, {
      status: "failed",
      code: "QUEUE_JOB_COMPLETED_WITHOUT_CANONICAL_RESULT",
      summary:
        "The queue job completed without recording a canonical run result.",
    });
    return;
  }

  const activeSince = new Date(run.started_at ?? run.queued_at).getTime();
  if (
    Number.isFinite(activeSince) &&
    now.getTime() - activeSince >= missingAfterMs
  ) {
    await terminalize(ctx, run, scope, {
      status: "failed",
      code: "QUEUE_JOB_MISSING",
      summary: "No queue job could be found for this active run.",
    });
  }
}

async function findCanonicalJobs(
  ctx: WorkerContext,
  queue: QueueName,
  run: AsyncRunRow,
): Promise<JobWithMetadata<CanonicalJobPayload>[]> {
  const direct = await ctx.boss.getJobById<CanonicalJobPayload>(queue, run.id);
  if (direct && jobMatchesRun(direct, run)) return [direct];

  // Old releases generated a random pg-boss id. JSONB containment narrows the
  // public lookup; exact scope checks below prevent a cross-project collision.
  const legacy = await ctx.boss.findJobs<CanonicalJobPayload>(queue, {
    data: { runId: run.id },
  });
  return legacy.filter((job) => jobMatchesRun(job, run));
}

function jobMatchesRun(
  job: JobWithMetadata<CanonicalJobPayload>,
  run: AsyncRunRow,
): boolean {
  const data = job.data;
  return (
    isRecord(data) &&
    data.runId === run.id &&
    data.workspaceId === run.workspace_id &&
    data.projectId === run.project_id
  );
}

function isRecord(value: unknown): value is CanonicalJobPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["runId"] === "string" &&
    typeof candidate["workspaceId"] === "string" &&
    typeof candidate["projectId"] === "string"
  );
}

function isLiveQueueState(state: JobWithMetadata["state"]): boolean {
  return state === "created" || state === "retry" || state === "active";
}

async function terminalize(
  ctx: WorkerContext,
  run: AsyncRunRow,
  scope: ProjectScope,
  outcome: {
    readonly status: "failed" | "cancelled";
    readonly code: string;
    readonly summary: string;
  },
): Promise<void> {
  const reconciled = await reconcileCanonicalAndProjection(ctx, run, scope, {
    status: outcome.status,
    lastErrorCode: outcome.code,
    lastErrorSummary: outcome.summary,
  });
  if (reconciled) {
    ctx.logger.warn("run_recovery_reconciled", {
      code: outcome.code,
      runId: run.id,
      status: outcome.status,
    });
  }
}

async function reconcileCanonicalAndProjection(
  ctx: WorkerContext,
  run: AsyncRunRow,
  scope: ProjectScope,
  values: {
    readonly status: "failed" | "cancelled";
    readonly lastErrorCode: string;
    readonly lastErrorSummary: string;
  },
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const reconciled = await new AsyncRunsRepository(
      tx,
    ).reconcileActiveToTerminal(scope, run.id, values);
    if (!reconciled) return false;

    const artifactId = run.request_payload["artifactId"];
    if (run.kind === "artifact_generation" && typeof artifactId === "string") {
      await new ExecutionArtifactsRepository(tx).setFailedForGenerationRun(
        scope,
        artifactId,
        run.id,
      );
    }
    return true;
  });
}

function scopeFromPayload(payload: CanonicalJobPayload): ProjectScope {
  return {
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
  };
}
