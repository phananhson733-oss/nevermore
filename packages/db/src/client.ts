import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schema } from "./schema.ts";

const { Pool, types } = pg;

// Return numeric/int8 as strings by default is confusing; keep pg defaults but
// ensure we never silently lose precision on bigint. numeric(12,6) is read as
// string and parsed at the repository boundary.

export type Db = NodePgDatabase<typeof schema>;
export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/** A drizzle transaction handle (same shape as Db for query methods). */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  readonly db: Db;
  readonly pool: pg.Pool;
  end(): Promise<void>;
}

/**
 * Create a pooled drizzle client. The web and worker each own one handle; domain
 * packages receive `Db`/`DbTx` and never construct their own pool.
 */
export function createDbHandle(connectionString: string, max = 10): DbHandle {
  const pool = new Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    async end() {
      await pool.end();
    },
  };
}

export { types as pgTypes };
