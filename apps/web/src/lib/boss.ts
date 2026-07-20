import { createBoss, startBoss, type PgBoss } from "@sf/db";
import { createLogger } from "@sf/observability";
import { getEnv } from "@/env";

/**
 * Process-wide enqueue-only pg-boss handle for the web service (spec §13.2). The
 * web process only enqueues jobs (inside the canonical transaction via the
 * Drizzle adapter); background supervision/scheduling is disabled here — the
 * worker owns that. `start()` creates the `pgboss` schema + queues idempotently.
 */
let bossPromise: Promise<PgBoss> | undefined;

const logger = createLogger({
  service: "web",
  environment: process.env["NODE_ENV"] ?? "development",
});

function reportBossError(_error: unknown): void {
  try {
    logger.error("pgboss_error", {
      code: "PGBOSS_RUNTIME_ERROR",
      type: "dependency",
    });
  } catch {
    // EventEmitter `error` handlers must never throw. The original pg-boss error
    // is deliberately not inspected or forwarded to another logging boundary.
  }
}

function stopFailedBoss(boss: PgBoss): void {
  try {
    void Promise.resolve(boss.stop({ graceful: false })).catch(() => undefined);
  } catch {
    // Startup failure remains the canonical outcome; cleanup is best-effort and
    // cannot poison future attempts or expose a second exception.
  }
}

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    const env = getEnv();
    const boss = createBoss(env.DATABASE_URL, {
      enqueueOnly: true,
      max: env.DB_POOL_MAX,
    });
    boss.on("error", reportBossError);

    const current: Promise<PgBoss> = Promise.resolve()
      .then(() => startBoss(boss))
      .then(() => boss)
      .catch((error: unknown) => {
        stopFailedBoss(boss);
        if (bossPromise === current) bossPromise = undefined;
        throw error;
      });
    bossPromise = current;
  }
  return bossPromise;
}
