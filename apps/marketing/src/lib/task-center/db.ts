// @input  -- TASKS_DATABASE_URL (the gengrowth_tasks database on TencentDB)
// @output -- getTaskDb(): one lazily created pg Pool, or null when this deployment has no task database
// @pos    -- the only place the task center opens database connections
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { Pool, type QueryResult, type QueryResultRow } from "pg";

/** What every store function needs: a Pool in production, a Client in tests. */
export interface TaskDb {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

/**
 * The role's connection limit is 10, and deploy-time migrations and a manual
 * psql session need some of those. One instance runs, so four is plenty.
 */
const POOL_MAX = 4;

const globalForPool = globalThis as typeof globalThis & {
  __taskCenterPool?: Pool;
};

/**
 * Null means this deployment has no task database at all, which is true of
 * the Vercel build kept as the rollback target. Pages show the task center
 * as unavailable instead of failing.
 *
 * Created on first use, never at import, so `next build` and every page that
 * never touches the task center work without the variable.
 */
export function getTaskDb(): TaskDb | null {
  const url = process.env.TASKS_DATABASE_URL;
  if (url === undefined || url.trim() === "") return null;
  if (globalForPool.__taskCenterPool === undefined) {
    const pool = new Pool({
      connectionString: url,
      max: POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });
    // An idle client dropped by the server must not crash the process.
    pool.on("error", () => {});
    globalForPool.__taskCenterPool = pool;
  }
  return globalForPool.__taskCenterPool;
}

/**
 * Run `work` in one transaction. A Pool lends a dedicated client for it; a
 * single Client (the tests) is already one connection.
 */
export async function withTransaction<T>(
  db: TaskDb,
  work: (tx: TaskDb) => Promise<T>,
): Promise<T> {
  const client = db instanceof Pool ? await db.connect() : null;
  const tx: TaskDb = client ?? db;
  try {
    await tx.query("begin");
    const result = await work(tx);
    await tx.query("commit");
    return result;
  } catch (error) {
    await tx.query("rollback").catch(() => {});
    throw error;
  } finally {
    client?.release();
  }
}

/** pg returns bigint as a string; amounts here are far below 2^53. */
export function toSafeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`task center: expected an integer, got ${String(value)}`);
  }
  return n;
}
