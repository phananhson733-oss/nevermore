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

export type QueueName =
  | "collect.crawl"
  | "collect.gsc"
  | "collect.ga4"
  | "collect.csv"
  | "diagnose"
  | "artifact.generate"
  | "export.bundle";

interface QueueConfig {
  /** Job execution timeout (spec §13.1). */
  readonly expireInSeconds: number;
  /** Max retries; only transient errors should retry (spec §13.1). */
  readonly retryLimit: number;
  /** Exponential backoff with jitter (spec §13.1). */
  readonly retryBackoff: boolean;
}

/** The seven fixed queues and their timeout/retry contract (spec §13.1). */
export const QUEUE_CONFIG: Record<QueueName, QueueConfig> = {
  "collect.crawl": { expireInSeconds: 900, retryLimit: 2, retryBackoff: true },
  "collect.gsc": { expireInSeconds: 600, retryLimit: 3, retryBackoff: true },
  "collect.ga4": { expireInSeconds: 600, retryLimit: 3, retryBackoff: true },
  "collect.csv": { expireInSeconds: 600, retryLimit: 1, retryBackoff: true },
  diagnose: { expireInSeconds: 600, retryLimit: 2, retryBackoff: true },
  "artifact.generate": {
    expireInSeconds: 300,
    retryLimit: 2,
    retryBackoff: true,
  },
  "export.bundle": { expireInSeconds: 300, retryLimit: 2, retryBackoff: true },
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
}

/** Construct a PgBoss instance bound to the `pgboss` schema. */
export function createBoss(
  connectionString: string,
  options?: BossOptions,
): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    ...(options?.enqueueOnly
      ? { supervise: false, schedule: false, monitorStateIntervalSeconds: 0 }
      : {}),
  });
}

/**
 * Start the boss (creates the `pgboss` schema on first run) and register the
 * seven queues with their timeout/retry policy. Idempotent across restarts.
 */
export async function startBoss(boss: PgBoss): Promise<void> {
  await boss.start();
  for (const name of QUEUE_NAMES) {
    const cfg = QUEUE_CONFIG[name];
    await boss.createQueue(name, {
      expireInSeconds: cfg.expireInSeconds,
      retryLimit: cfg.retryLimit,
      retryBackoff: cfg.retryBackoff,
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
): Promise<string | null> {
  return boss.send(queue, payload, { db: fromDrizzle(tx, sql) });
}

export { PgBoss };
export type { Job, WorkHandler } from "pg-boss";
