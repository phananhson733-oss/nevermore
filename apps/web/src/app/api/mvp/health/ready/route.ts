import {
  checkWorkerReadiness,
  getDbPoolStats,
  LATEST_APP_MIGRATION,
  PGBOSS_SCHEMA,
  readMigrationVersion,
} from "@sf/db";
import { route } from "@/lib/http/handler";
import { getDb } from "@/lib/db";
import { ok, problem } from "@/lib/http/respond";

/**
 * Readiness requires the database, pg-boss schema, and a live worker database
 * session. Merely seeing queue tables is insufficient: a crashed worker leaves
 * those tables behind (spec §13.3, DoD §18.8).
 */
export const GET = route(async (_request, ctx) => {
  const checks: Record<string, boolean> = {
    database: false,
    migration: false,
    pgbossSchema: false,
    worker: false,
  };
  /*
   * A check is only recorded once it has actually run. The probe short-circuits
   * — a thrown query skips everything after it, and `worker` runs only when the
   * queue schema is present — so a check left at its `false` default must not
   * be reported as failed. Blaming a dependency that was never contacted sends
   * the next responder to the wrong place.
   */
  const evaluated: string[] = [];
  try {
    const { pool } = getDb();
    ctx.logger.info("db_pool_snapshot", { ...getDbPoolStats(pool) });
    await pool.query("SELECT 1");
    evaluated.push("database");
    checks.database = true;
    const migrationVersion = await readMigrationVersion(pool);
    evaluated.push("migration");
    checks.migration = migrationVersion === LATEST_APP_MIGRATION;
    ctx.logger.info("db_migration_version", {
      migrationVersion: migrationVersion ?? "unavailable",
      expectedMigrationVersion: LATEST_APP_MIGRATION,
    });
    const schemaRes = await pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [PGBOSS_SCHEMA],
    );
    evaluated.push("pgbossSchema");
    checks.pgbossSchema = (schemaRes.rowCount ?? 0) > 0;
    if (checks.pgbossSchema) {
      checks.worker = await checkWorkerReadiness(pool);
      evaluated.push("worker");
    }
  } catch {
    ctx.logger.warn("readiness_check_failed", {
      code: "DEPENDENCY_UNAVAILABLE",
      type: "dependency",
    });
  }

  const ready =
    checks.database && checks.migration && checks.pgbossSchema && checks.worker;
  if (!ready) {
    /*
     * Name the checks that actually failed. A fully redacted 503 turns a
     * one-second diagnosis into an incident: the caller cannot tell a stale
     * migration from a dead worker without querying the database directly.
     * These names are already published by the 200 response, so this discloses
     * nothing new — the values behind them (migration ids, pool stats) stay in
     * the logs and never enter the response.
     */
    const failed = evaluated.filter((name) => !checks[name]);
    const detail =
      failed.length > 0
        ? `Service dependencies are not ready: ${failed.join(", ")}.`
        : // Every check that ran passed, so the probe stopped before finishing.
          "Service dependencies are not ready: the readiness probe did not complete.";
    return problem("DEPENDENCY_UNAVAILABLE", detail, ctx.requestId);
  }
  return ok({ status: "ready", checks }, ctx.requestId);
});

export const dynamic = "force-dynamic";
