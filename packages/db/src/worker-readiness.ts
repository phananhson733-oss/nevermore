/**
 * A worker owns a PostgreSQL session-level shared advisory lock for its entire
 * lifetime. Readiness probes try to take the corresponding exclusive lock:
 * failure means at least one live worker session owns the shared lease.
 *
 * Session locks are intentionally used here: PostgreSQL releases them when a
 * worker crashes or loses its dedicated connection, so no heartbeat row can go
 * stale and the frozen 28-table application schema remains unchanged.
 */

const WORKER_READINESS_LOCK_NAMESPACE = 1_397_116_237;
const WORKER_READINESS_LOCK_KEY = 20_260_718;

interface ReadinessQueryResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

interface ReadinessClient {
  query(sql: string, values?: unknown[]): Promise<ReadinessQueryResult>;
  release(error?: Error | boolean): void;
}

export interface WorkerReadinessPool {
  connect(): Promise<ReadinessClient>;
}

export interface WorkerReadinessLease {
  release(): Promise<void>;
}

function lockValues(): [number, number] {
  return [WORKER_READINESS_LOCK_NAMESPACE, WORKER_READINESS_LOCK_KEY];
}

function asBoolean(
  result: ReadinessQueryResult,
  field: "acquired" | "released",
): boolean {
  return result.rows[0]?.[field] === true;
}

/** Acquire and retain the worker's dedicated shared-lock session. */
export async function acquireWorkerReadinessLease(
  pool: WorkerReadinessPool,
): Promise<WorkerReadinessLease> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock_shared($1, $2) AS acquired",
      lockValues(),
    );
    if (!asBoolean(result, "acquired")) {
      client.release();
      throw new Error("Unable to acquire worker readiness lease.");
    }
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("readiness lease"))) {
      client.release(error instanceof Error ? error : true);
    }
    throw error;
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        const result = await client.query(
          "SELECT pg_advisory_unlock_shared($1, $2) AS released",
          lockValues(),
        );
        if (!asBoolean(result, "released")) {
          throw new Error("Worker readiness lease was not held by this session.");
        }
        client.release();
      } catch (error) {
        // Destroy a broken pooled connection. Closing its PostgreSQL session is
        // what guarantees that a possibly-held advisory lock cannot leak.
        client.release(error instanceof Error ? error : true);
        throw error;
      }
    },
  };
}

/** Return true only while at least one worker holds the shared session lease. */
export async function checkWorkerReadiness(
  pool: WorkerReadinessPool,
): Promise<boolean> {
  const client = await pool.connect();
  let clientReleased = false;
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      lockValues(),
    );
    const acquired = asBoolean(result, "acquired");
    if (!acquired) return true;

    const unlocked = await client.query(
      "SELECT pg_advisory_unlock($1, $2) AS released",
      lockValues(),
    );
    if (!asBoolean(unlocked, "released")) {
      throw new Error("Worker readiness probe could not release its advisory lock.");
    }
    return false;
  } catch (error) {
    // A destroyed PostgreSQL session automatically releases any probe lock.
    client.release(error instanceof Error ? error : true);
    clientReleased = true;
    throw error;
  } finally {
    if (!clientReleased) client.release();
  }
}
