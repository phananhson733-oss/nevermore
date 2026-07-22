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

export type QueueName =
  | "collect.crawl"
  | "collect.gsc"
  | "collect.ga4"
  | "collect.csv"
  | "collect.dataforseo"
  | "diagnose"
  | "profile.synthesize"
  | "artifact.generate"
  | "export.bundle";

interface QueueConfig {
  /** Job execution timeout (spec §13.1). */
  readonly expireInSeconds: number;
  /** Max retries; only transient errors should retry (spec §13.1). */
  readonly retryLimit: number;
  /** Exponential backoff with jitter (spec §13.1). */
  readonly retryBackoff: boolean;
  /** Worker-managed heartbeat; a dead process stops touching the active job. */
  readonly heartbeatSeconds: number;
}

/** The fixed queues and their timeout/retry contract (spec §13.1). */
export const QUEUE_CONFIG: Record<QueueName, QueueConfig> = {
  "collect.crawl": {
    expireInSeconds: COLLECT_CRAWL_JOB_EXPIRY_SECONDS,
    retryLimit: 2,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  "collect.gsc": {
    expireInSeconds: 600,
    retryLimit: 3,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  "collect.ga4": {
    expireInSeconds: 600,
    retryLimit: 3,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  "collect.csv": {
    expireInSeconds: 600,
    retryLimit: 1,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  "collect.dataforseo": {
    expireInSeconds: 600,
    retryLimit: 3,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  diagnose: {
    expireInSeconds: 600,
    retryLimit: 2,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  "profile.synthesize": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  "artifact.generate": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
    heartbeatSeconds: 60,
  },
  "export.bundle": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
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

export interface BossOptions {
  /** Disable background maintenance/scheduling on enqueue-only (web) instances. */
  readonly enqueueOnly?: boolean;
  /**
   * Max size of pg-boss's own connection pool. Keep this small when the database
   * is reached through a connection-limited pooler (e.g. Supabase's session
   * pooler caps clients per project) so web + worker Drizzle + pg-boss pools all
   * fit under the ceiling. Defaults to pg-boss's own default when unset.
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
    await boss.createQueue(name, {
      expireInSeconds: cfg.expireInSeconds,
      retryLimit: cfg.retryLimit,
      retryBackoff: cfg.retryBackoff,
      heartbeatSeconds: cfg.heartbeatSeconds,
    });
    // createQueue is intentionally create-only in pg-boss. Re-apply mutable
    // policy so an existing production queue receives heartbeat/retry updates.
    await boss.updateQueue(name, {
      expireInSeconds: cfg.expireInSeconds,
      retryLimit: cfg.retryLimit,
      retryBackoff: cfg.retryBackoff,
      heartbeatSeconds: cfg.heartbeatSeconds,
    });
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
): Promise<string> {
  const jobId = await boss.send(queue, payload, {
    id: payload.runId,
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

export { PgBoss };
export type { Job, JobWithMetadata, WorkHandler } from "pg-boss";
