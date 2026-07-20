import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schema } from "./schema.ts";

const { Pool, types } = pg;

/**
 * node-postgres uses this value for both opening a new connection and waiting
 * for a checked-out client when the pool is full. Its default is unbounded.
 */
const DB_CONNECTION_TIMEOUT_MS = 10_000;
export const DB_LOCK_TIMEOUT_MS = 30_000;
export const DB_STATEMENT_TIMEOUT_MS = 4 * 60 * 1_000;
export const DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = 4 * 60 * 1_000;

const DB_POOL_ERROR_LINE =
  '{"event":"db_pool_error","code":"DB_POOL_ERROR","type":"dependency"}\n';

/**
 * Idle PostgreSQL clients surface failures through the Pool `error` event. An
 * EventEmitter error without a listener crashes the process, so install this
 * fixed reporter before the pool is exposed. Never inspect the error: pg error
 * fields can contain SQL, connection details, or customer data, and even
 * classification operations can trigger hostile Proxy traps.
 */
function reportDbPoolError(_error: unknown): void {
  try {
    process.stderr.write(DB_POOL_ERROR_LINE);
  } catch {
    // A broken logging sink must not turn a recoverable idle-client failure into
    // an uncaught exception.
  }
}

// Return numeric/int8 as strings by default is confusing; keep pg defaults but
// ensure we never silently lose precision on bigint. numeric(12,6) is read as
// string and parsed at the repository boundary.

export type Db = NodePgDatabase<typeof schema>;
export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface DbPoolStats {
  readonly max: number;
  readonly total: number;
  readonly idle: number;
  readonly active: number;
  readonly waiting: number;
  readonly saturationRatio: number;
}

export interface SlowQueryEvent {
  readonly durationMs: number;
}

export interface DbInstrumentation {
  /** Emit one metadata-only event after a query crosses this boundary. */
  readonly slowQueryThresholdMs?: number;
  /** Never receives SQL text, bind values, errors, or connection details. */
  readonly onSlowQuery?: (event: SlowQueryEvent) => void;
}

/** A drizzle transaction handle (same shape as Db for query methods). */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  readonly db: Db;
  readonly pool: pg.Pool;
  end(): Promise<void>;
}

/** Return only numeric pool capacity counters; no connection metadata leaks. */
export function getDbPoolStats(pool: pg.Pool): DbPoolStats {
  const configuredMax = Number(pool.options.max);
  const max = Number.isFinite(configuredMax) && configuredMax > 0
    ? Math.floor(configuredMax)
    : 1;
  const total = Math.max(0, Math.floor(pool.totalCount));
  const idle = Math.min(total, Math.max(0, Math.floor(pool.idleCount)));
  const active = Math.max(0, total - idle);
  const waiting = Math.max(0, Math.floor(pool.waitingCount));
  return {
    max,
    total,
    idle,
    active,
    waiting,
    saturationRatio: Math.round((active / max) * 10_000) / 10_000,
  };
}

type UntypedPoolQuery = (...args: readonly unknown[]) => unknown;

function finiteThreshold(value: number | undefined): number {
  if (value === undefined) return 1_000;
  if (!Number.isFinite(value) || value < 0) return 1_000;
  return value;
}

export function installSlowQueryInstrumentation(
  pool: pg.Pool,
  instrumentation: DbInstrumentation,
): void {
  const onSlowQuery = instrumentation.onSlowQuery;
  if (!onSlowQuery) return;
  const thresholdMs = finiteThreshold(instrumentation.slowQueryThresholdMs);
  const original = pool.query.bind(pool) as UntypedPoolQuery;

  const record = (startedAt: number): void => {
    const raw = performance.now() - startedAt;
    if (!Number.isFinite(raw) || raw < thresholdMs) return;
    const durationMs = Math.max(0, Math.round(raw * 100) / 100);
    try {
      onSlowQuery({ durationMs });
    } catch {
      // Instrumentation is observational and must never alter DB semantics.
    }
  };

  const instrumented: UntypedPoolQuery = (...input) => {
    const startedAt = performance.now();
    const args = [...input];
    const last = args.at(-1);
    if (typeof last === "function") {
      const callback = last as (...callbackArgs: readonly unknown[]) => unknown;
      args[args.length - 1] = (...callbackArgs: readonly unknown[]) => {
        record(startedAt);
        return Reflect.apply(callback, undefined, callbackArgs);
      };
      return Reflect.apply(original, pool, args);
    }

    let result: unknown;
    try {
      result = Reflect.apply(original, pool, args);
    } catch (error) {
      record(startedAt);
      throw error;
    }
    if (result instanceof Promise) {
      return result.finally(() => record(startedAt));
    }
    record(startedAt);
    return result;
  };

  pool.query = instrumented as typeof pool.query;
}

/**
 * Create a pooled drizzle client. The web and worker each own one handle; domain
 * packages receive `Db`/`DbTx` and never construct their own pool.
 */
export function createDbHandle(
  connectionString: string,
  max = 10,
  instrumentation: DbInstrumentation = {},
): DbHandle {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    // Canonical writers must never remain eligible to reference a private
    // object after the 24-hour orphan floor. Server-side limits also ensure a
    // timed-out maintenance observation cannot linger indefinitely on a pooled
    // connection after its caller has failed closed.
    lock_timeout: DB_LOCK_TIMEOUT_MS,
    statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout:
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  pool.on("error", reportDbPoolError);
  installSlowQueryInstrumentation(pool, instrumentation);
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
