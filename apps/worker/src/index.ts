import {
  createDbHandle,
  createBoss,
  startBoss,
  type DbHandle,
  type PgBoss,
} from "@sf/db";
import { createLogger } from "@sf/observability";
import { getWorkerEnv } from "./env.ts";
import { buildWorkerContext } from "./context.ts";
import { registerCollectHandlers } from "./handlers/collect.ts";
import { registerDiagnoseHandler } from "./handlers/diagnose.ts";
import { registerArtifactHandlers } from "./handlers/artifact.ts";

/**
 * Worker bootstrap (spec §3.1, §13). A long-running Node process that:
 *   1. validates its environment (fail-fast),
 *   2. opens one pooled database handle,
 *   3. starts pg-boss (which creates the `pgboss` schema and the seven queues),
 *   4. registers job handlers, and
 *   5. shuts down gracefully on SIGINT/SIGTERM.
 *
 * The collection/diagnostic/artifact/export job handlers are registered by the
 * respective work packages (WP2+); WP0 stands up the process, the queue schema,
 * and the lifecycle so `/health/ready` can observe pg-boss (spec §13.3, AC-004).
 */

const CONTRACT_VERSION = "2026-07-18";

interface WorkerRuntime {
  readonly db: DbHandle;
  readonly boss: PgBoss;
  stop(): Promise<void>;
}

async function start(): Promise<WorkerRuntime> {
  const env = getWorkerEnv();
  const logger = createLogger(
    {
      service: "worker",
      environment: process.env["NODE_ENV"] ?? "development",
    },
    env.LOG_LEVEL,
  );
  logger.info("worker_starting", { contractVersion: CONTRACT_VERSION });

  const db = createDbHandle(env.DATABASE_URL, env.DB_POOL_MAX);
  const boss = createBoss(env.DATABASE_URL, { max: env.DB_POOL_MAX });

  boss.on("error", (error: unknown) => {
    logger.error("pgboss_error", {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  await startBoss(boss);

  // Register job handlers (spec §13). WP2: the four collection queues. WP3/WP4
  // add diagnose / artifact.generate / export.bundle handlers on this context.
  const workerCtx = buildWorkerContext({ db, boss, env, logger });
  await registerCollectHandlers(workerCtx);
  await registerDiagnoseHandler(workerCtx);
  await registerArtifactHandlers(workerCtx);

  logger.info("worker_ready", { contractVersion: CONTRACT_VERSION });

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("worker_stopping", {});
    await boss.stop({ graceful: true }).catch((error: unknown) => {
      logger.error("pgboss_stop_error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    await db.end().catch(() => {});
    logger.info("worker_stopped", {});
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stop().then(() => process.exit(0));
    });
  }

  return { db, boss, stop };
}

start().catch((error: unknown) => {
  // Boot failures (bad env, unreachable DB) must crash loudly, not idle.
  console.error(error);
  process.exit(1);
});

export { start };
export type { WorkerRuntime };
