import {
  createDbHandle,
  createBoss,
  acquireWorkerReadinessLease,
  startBoss,
  type DbHandle,
  type PgBoss,
} from "@sf/db";
import { resolveBuildMetadata } from "@sf/contracts";
import { createLogger } from "@sf/observability";
import { getWorkerEnv } from "./env.ts";
import { buildWorkerContext } from "./context.ts";
import { registerCollectHandlers } from "./handlers/collect.ts";
import { registerDiagnoseHandler } from "./handlers/diagnose.ts";
import { registerArtifactHandlers } from "./handlers/artifact.ts";
import { startWorkerMaintenance } from "./maintenance.ts";
import {
  runtimeFailureMetadata,
  serializeWorkerBootFailure,
} from "./runtime-failure.ts";

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
  const build = resolveBuildMetadata("worker");
  logger.info("worker_starting", build);

  const db = createDbHandle(env.DATABASE_URL, env.DB_POOL_MAX);
  const boss = createBoss(env.DATABASE_URL, { max: env.DB_POOL_MAX });

  boss.on("error", (error: unknown) => {
    logger.error(
      "pgboss_error",
      runtimeFailureMetadata("PGBOSS_RUNTIME_ERROR", error),
    );
  });

  await startBoss(boss);

  // Hold a dedicated shared advisory-lock session for this process lifetime.
  // `/health/ready` uses the corresponding exclusive probe, so a dead worker is
  // detected immediately when PostgreSQL closes its session.
  const readinessLease = await acquireWorkerReadinessLease(db.pool);

  // Register job handlers (spec §13). WP2: the four collection queues. WP3/WP4
  // add diagnose / artifact.generate / export.bundle handlers on this context.
  const workerCtx = buildWorkerContext({ db, boss, env, logger });
  await registerCollectHandlers(workerCtx);
  await registerDiagnoseHandler(workerCtx);
  await registerArtifactHandlers(workerCtx);
  const maintenance = await startWorkerMaintenance(workerCtx);

  logger.info("worker_ready", build);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("worker_stopping", {});
    await maintenance.stop();
    await boss.stop({ graceful: true }).catch((error: unknown) => {
      logger.error(
        "pgboss_stop_error",
        runtimeFailureMetadata("PGBOSS_STOP_FAILED", error),
      );
    });
    await readinessLease.release().catch((error: unknown) => {
      logger.error(
        "worker_readiness_lease_release_error",
        runtimeFailureMetadata("READINESS_LEASE_RELEASE_FAILED", error),
      );
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
  console.error(serializeWorkerBootFailure(error));
  process.exit(1);
});

export { start };
export type { WorkerRuntime };
