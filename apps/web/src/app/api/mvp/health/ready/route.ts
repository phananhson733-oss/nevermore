import { PGBOSS_SCHEMA } from "@sf/db";
import { route } from "@/lib/http/handler";
import { getDb } from "@/lib/db";
import { ok, problem } from "@/lib/http/respond";

/**
 * Readiness: database reachable and the pg-boss schema installed (spec §13.3).
 * Worker heartbeat is added once the worker registers heartbeats (WP2+).
 */
export const GET = route(async (_request, ctx) => {
  const checks: Record<string, boolean> = { database: false, pgbossSchema: false };
  try {
    const { pool } = getDb();
    await pool.query("SELECT 1");
    checks.database = true;
    const schemaRes = await pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [PGBOSS_SCHEMA],
    );
    checks.pgbossSchema = (schemaRes.rowCount ?? 0) > 0;
  } catch (error) {
    ctx.logger.warn("readiness_check_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const ready = checks.database && checks.pgbossSchema;
  if (!ready) {
    return problem("DEPENDENCY_UNAVAILABLE", "Service dependencies are not ready.", ctx.requestId);
  }
  return ok({ status: "ready", checks }, ctx.requestId);
});

export const dynamic = "force-dynamic";
