import { sql } from "drizzle-orm";
import { PgBoss, fromDrizzle } from "pg-boss";
import type { DbTx } from "./client.ts";

/**
 * pg-boss queue integration (spec §13). pg-boss owns its own `pgboss` schema —
 * created by the library at start(), never mirrored into Drizzle migrations
 * (spec AC-004). Enqueue joins the caller's canonical transaction via the
 * built-in Drizzle adapter so a Run row and its job commit or roll back together
 * (spec §13.2, AC-006).
 */

export const PGBOSS_SCHEMA = "pgboss";

/** Frozen spec §13.1 queue window. Provider work must finish before this cap. */
export const COLLECT_CRAWL_JOB_EXPIRY_SECONDS = 15 * 60;

/**
 * Seconds before the first retry of a job that failed on a transient dependency.
 *
 * pg-boss defaults `retryDelay` to 1 second whenever `retryBackoff` is enabled,
 * and its backoff is `retryDelay * (2^n / 2 + 2^n / 2 * random())`. At the
 * default that spends every attempt inside the first ~6 seconds, so a run that
 * hit a saturated connection pooler retried twice against the same outage and
 * failed as if retries were switched off — observed in production when the
 * Supabase session pooler ran out of client slots and a crawl burned all three
 * attempts within ten seconds.
 *
 * The failures these retries exist for — an exhausted pooler, a rate-limited or
 * briefly unavailable provider — clear on a scale of tens of seconds, so start
 * there. Verified against pg-boss 12.26.1: the n-th retry waits between
 * 30*2^n/2 and 30*2^n seconds, so the last attempt starts after a cumulative
 * 1.5-3 minutes of delay at retryLimit 2 and 3.5-7 minutes at retryLimit 3.
 * Retry delays never consume `expireInSeconds` (a per-attempt execution
 * timeout); the invariant that bounds them is the run recovery missing-job
 * window (RUN_RECOVERY_MISSING_AFTER_MS, one hour) — worst case, attempts
 * plus delays total ~48 minutes for collect.crawl. Jobs awaiting a retry hold
 * `retry` state, which run recovery treats as live (`isLiveQueueState`), so a
 * longer wait is not mistaken for a stalled run.
 *
 * Rollback caveat: pg-boss's updateQueue COALESCEs omitted keys, so reverting
 * to code that does not pass `retryDelay` leaves 30 in every pgboss.queue row.
 * Lowering the delay requires a forward-fix passing an explicit smaller value.
 */
export const TRANSIENT_RETRY_DELAY_SECONDS = 30;

export type QueueName =
  | "collect.crawl"
  | "collect.gsc"
  | "collect.ga4"
  | "collect.csv"
  | "collect.dataforseo"
  | "diagnose"
  | "profile.synthesize"
  | "topic-model.generate"
  | "keyword-governance-suggestion.generate"
  | "artifact.generate"
  | "export.bundle"
  | "content-shadow"
  | "publication"
  | "measurement"
  | "refresh.analysis";

interface QueueConfig {
  /** Job execution timeout (spec §13.1). */
  readonly expireInSeconds: number;
  /** Max retries; only transient errors should retry (spec §13.1). */
  readonly retryLimit: number;
  /** Exponential backoff with jitter (spec §13.1). */
  readonly retryBackoff: boolean;
  /** Seconds before the first retry; pg-boss grows it exponentially from here. */
  readonly retryDelay: number;
  /** Worker-managed heartbeat; a dead process stops touching the active job. */
  readonly heartbeatSeconds: number;
}

/** The fixed queues and their timeout/retry contract (spec §13.1). */
export const QUEUE_CONFIG: Record<QueueName, QueueConfig> = {
  "collect.crawl": {
    expireInSeconds: COLLECT_CRAWL_JOB_EXPIRY_SECONDS,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "collect.gsc": {
    expireInSeconds: 600,
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "collect.ga4": {
    expireInSeconds: 600,
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "collect.csv": {
    expireInSeconds: 600,
    retryLimit: 1,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "collect.dataforseo": {
    expireInSeconds: 600,
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  diagnose: {
    expireInSeconds: 600,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "profile.synthesize": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "topic-model.generate": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "keyword-governance-suggestion.generate": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "artifact.generate": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "export.bundle": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  // Content Shadow is a multi-stage long-running capability (research → draft →
  // QA) whose draft step calls a model, so it takes the diagnose-sized window
  // rather than the short single-shot artifact window.
  "content-shadow": {
    expireInSeconds: 600,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  // Publication can cross the external-write boundary. An unknown provider
  // result must reconcile by permanent attempt/idempotency lineage; pg-boss
  // must never blindly replay the write.
  publication: {
    expireInSeconds: 600,
    retryLimit: 0,
    retryBackoff: false,
    retryDelay: 0,
    heartbeatSeconds: 60,
  },
  measurement: {
    expireInSeconds: 600,
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
  "refresh.analysis": {
    expireInSeconds: 15 * 60,
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: TRANSIENT_RETRY_DELAY_SECONDS,
    heartbeatSeconds: 60,
  },
};

export const QUEUE_NAMES = Object.keys(QUEUE_CONFIG) as QueueName[];

/**
 * Job payload contract (spec §13.3): only ids + contract version. Never
 * credentials, raw content, or client data.
 */
export interface RunJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contractVersion: string;
  [key: string]: unknown;
}

export interface EnqueueRunOptions {
  /** Absolute provider-settlement time; relative strings/numbers are forbidden. */
  readonly startAfter?: Date;
}

export interface BossOptions {
  /** Disable background maintenance/scheduling on enqueue-only (web) instances. */
  readonly enqueueOnly?: boolean;
  /**
   * Max size of pg-boss's own connection pool. Keep this small when the database
   * is reached through a connection-limited pooler (e.g. Supabase's session
   * pooler caps clients per project) so web + worker Drizzle + pg-boss pools all
   * fit under the ceiling. Defaults to pg-boss's own default when unset.
   *
   * Switching to a transaction-mode pooler to escape that ceiling is not an
   * option today: the worker readiness lease depends on session-pinned advisory
   * locks. See the connection mode constraint in `worker-readiness.ts`.
   */
  readonly max?: number;
}

/** Construct a PgBoss instance bound to the `pgboss` schema. */
export function createBoss(
  connectionString: string,
  options?: BossOptions,
): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    ...(options?.max ? { max: options.max } : {}),
    ...(options?.enqueueOnly
      ? { supervise: false, schedule: false, monitorStateIntervalSeconds: 0 }
      : {}),
  });
}

/**
 * Start the boss (creates the `pgboss` schema on first run) and register the
 * queues with their timeout/retry policy. Idempotent across restarts.
 */
export async function startBoss(boss: PgBoss): Promise<void> {
  await boss.start();
  for (const name of QUEUE_NAMES) {
    const cfg = QUEUE_CONFIG[name];
    const policy = {
      expireInSeconds: cfg.expireInSeconds,
      retryLimit: cfg.retryLimit,
      retryBackoff: cfg.retryBackoff,
      retryDelay: cfg.retryDelay,
      heartbeatSeconds: cfg.heartbeatSeconds,
    };
    await boss.createQueue(name, policy);
    // createQueue is intentionally create-only in pg-boss. Re-apply mutable
    // policy so an existing production queue receives heartbeat/retry updates.
    await boss.updateQueue(name, policy);
  }
}

/**
 * Enqueue a run job inside the caller's drizzle transaction. The insert into
 * `pgboss.job` uses the same connection as the canonical writes, so the job and
 * the async_runs row are atomic (spec §13.2). Active-run uniqueness is enforced
 * by the `async_runs_one_active_key_idx` partial unique index, not by pg-boss
 * singletonKey — a duplicate active_key aborts the whole transaction, taking the
 * enqueue with it.
 */
export async function enqueueRunInTx(
  boss: PgBoss,
  tx: DbTx,
  queue: QueueName,
  payload: RunJobPayload,
  options: EnqueueRunOptions = {},
): Promise<string> {
  if (
    options.startAfter !== undefined &&
    (!(options.startAfter instanceof Date) ||
      !Number.isFinite(options.startAfter.getTime()))
  ) {
    throw new TypeError("startAfter must be a valid absolute Date");
  }
  const jobId = await boss.send(queue, payload, {
    id: payload.runId,
    ...(options.startAfter ? { startAfter: options.startAfter } : {}),
    db: fromDrizzle(tx, sql),
  });
  // pg-boss reports an id/singleton conflict as null. Treat that as an enqueue
  // failure so the surrounding canonical transaction cannot commit a run with
  // no corresponding queue job.
  if (jobId === null) {
    throw new Error("pg-boss rejected the explicit run job id");
  }
  return jobId;
}

/**
 * Re-schedule one continuation delivery for an existing Analysis Refresh parent
 * after a child run settles. The payload keeps the canonical parent runId, but
 * pg-boss must mint a fresh job id: the initial enqueue already consumed
 * `job.id = runId`, so reusing that id would be rejected as a duplicate.
 */
export async function enqueueAnalysisRefreshContinuationInTx(
  boss: PgBoss,
  tx: DbTx,
  payload: RunJobPayload,
  options: EnqueueRunOptions = {},
): Promise<string> {
  if (
    options.startAfter !== undefined &&
    (!(options.startAfter instanceof Date) ||
      !Number.isFinite(options.startAfter.getTime()))
  ) {
    throw new TypeError("startAfter must be a valid absolute Date");
  }
  const jobId = await boss.send("refresh.analysis", payload, {
    ...(options.startAfter ? { startAfter: options.startAfter } : {}),
    db: fromDrizzle(tx, sql),
  });
  if (jobId === null) {
    throw new Error("pg-boss rejected the Analysis Refresh continuation");
  }
  if (jobId === payload.runId) {
    throw new Error(
      "pg-boss reused the canonical run id for an Analysis Refresh continuation",
    );
  }
  return jobId;
}

export { PgBoss };
export type { Job, JobWithMetadata, WorkHandler } from "pg-boss";
