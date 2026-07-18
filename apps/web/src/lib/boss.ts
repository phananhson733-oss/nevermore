import { createBoss, startBoss, type PgBoss } from "@sf/db";
import { getEnv } from "@/env";

/**
 * Process-wide enqueue-only pg-boss handle for the web service (spec §13.2). The
 * web process only enqueues jobs (inside the canonical transaction via the
 * Drizzle adapter); background supervision/scheduling is disabled here — the
 * worker owns that. `start()` creates the `pgboss` schema + queues idempotently.
 */
let bossPromise: Promise<PgBoss> | undefined;

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    const boss = createBoss(getEnv().DATABASE_URL, {
      enqueueOnly: true,
      max: getEnv().DB_POOL_MAX,
    });
    bossPromise = startBoss(boss).then(() => boss);
  }
  return bossPromise;
}
