import { createDbHandle, type DbHandle } from "@sf/db";
import { createLogger } from "@sf/observability";
import { getEnv } from "@/env";

/**
 * Process-wide pooled database handle for the web service. Never imported by
 * client components. Domain repositories receive `handle.db` / a transaction.
 */
let handle: DbHandle | undefined;

const dbLogger = createLogger({
  service: "web",
  environment: process.env["NODE_ENV"] ?? "development",
});

export function getDb(): DbHandle {
  if (!handle) {
    const env = getEnv();
    handle = createDbHandle(env.DATABASE_URL, env.DB_POOL_MAX, {
      slowQueryThresholdMs: 1_000,
      onSlowQuery({ durationMs }) {
        dbLogger.warn("db_slow_query", {
          durationMs,
          thresholdMs: 1_000,
        });
      },
    });
  }
  return handle;
}
