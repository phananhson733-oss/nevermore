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
  try {
    const { pool } = getDb();
    ctx.logger.info("db_pool_snapshot", { ...getDbPoolStats(pool) });
    await pool.query("SELECT 1");
    checks.database = true;
    const migrationVersion = await readMigrationVersion(pool);
    checks.migration = migrationVersion === LATEST_APP_MIGRATION;
    ctx.logger.info("db_migration_version", {
      migrationVersion: migrationVersion ?? "unavailable",
      expectedMigrationVersion: LATEST_APP_MIGRATION,
    });
    const schemaRes = await pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [PGBOSS_SCHEMA],
    );
    checks.pgbossSchema = (schemaRes.rowCount ?? 0) > 0;
    if (checks.pgbossSchema) {
      checks.worker = await checkWorkerReadiness(pool);
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
    return problem("DEPENDENCY_UNAVAILABLE", "Service dependencies are not ready.", ctx.requestId);
  }
  return ok({ status: "ready", checks }, ctx.requestId);
});

export const dynamic = "force-dynamic";
