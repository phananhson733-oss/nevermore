/**
 * A worker owns a PostgreSQL session-level shared advisory lock for its entire
 * ready lifetime. Readiness probes try to take the corresponding exclusive
 * lock: failure means at least one live worker session owns the shared lease.
 *
 * The dedicated session also has `idle_session_timeout` plus an event-loop
 * heartbeat. PostgreSQL therefore closes the session and releases its lock if
 * the process is frozen, even though the TCP connection itself can remain open.
 * This preserves the frozen 28-table application schema: no heartbeat table is
 * needed.
 */

const WORKER_READINESS_LOCK_NAMESPACE = 1_397_116_237;
const WORKER_READINESS_LOCK_KEY = 20_260_718;

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_SESSION_TIMEOUT_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

interface ReadinessQueryResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

type ReadinessErrorListener = (error: Error) => void;

interface ReadinessClient {
  query(sql: string, values?: unknown[]): Promise<ReadinessQueryResult>;
  release(error?: Error | boolean): void;
  on(event: "error", listener: ReadinessErrorListener): unknown;
  removeListener(event: "error", listener: ReadinessErrorListener): unknown;
}

export interface WorkerReadinessPool {
  connect(): Promise<ReadinessClient>;
}

export type WorkerReadinessErrorCode =
  | "WORKER_READINESS_INVALID_OPTIONS"
  | "WORKER_READINESS_CONNECT_TIMEOUT"
  | "WORKER_READINESS_CONNECT_FAILED"
  | "WORKER_READINESS_QUERY_TIMEOUT"
  | "WORKER_READINESS_QUERY_FAILED"
  | "WORKER_READINESS_CLIENT_LISTENER_FAILED"
  | "WORKER_READINESS_LOCK_UNAVAILABLE"
  | "WORKER_READINESS_LEASE_NOT_HELD"
  | "WORKER_READINESS_CLIENT_RELEASE_FAILED"
  | "WORKER_READINESS_SESSION_ERROR";

const READINESS_ERROR_MESSAGES: Record<WorkerReadinessErrorCode, string> = {
  WORKER_READINESS_INVALID_OPTIONS:
    "Worker readiness timing options are invalid.",
  WORKER_READINESS_CONNECT_TIMEOUT:
    "Worker readiness database connection timed out.",
  WORKER_READINESS_CONNECT_FAILED:
    "Worker readiness database connection failed.",
  WORKER_READINESS_QUERY_TIMEOUT:
    "Worker readiness database query timed out.",
  WORKER_READINESS_QUERY_FAILED: "Worker readiness database query failed.",
  WORKER_READINESS_CLIENT_LISTENER_FAILED:
    "Worker readiness database listener setup failed.",
  WORKER_READINESS_LOCK_UNAVAILABLE:
    "Unable to acquire worker readiness lease.",
  WORKER_READINESS_LEASE_NOT_HELD:
    "Worker readiness lease was not held by this session.",
  WORKER_READINESS_CLIENT_RELEASE_FAILED:
    "Worker readiness database session release failed.",
  WORKER_READINESS_SESSION_ERROR:
    "Worker readiness database session failed.",
};

/** Stable, non-content-bearing failure surfaced to process boundaries. */
export class WorkerReadinessError extends Error {
  readonly code: WorkerReadinessErrorCode;

  constructor(code: WorkerReadinessErrorCode) {
    super(READINESS_ERROR_MESSAGES[code]);
    this.name = "WorkerReadinessError";
    this.code = code;
  }
}

export type WorkerReadinessFailure = Readonly<{
  code:
    | "WORKER_READINESS_SESSION_ERROR"
    | "WORKER_READINESS_HEARTBEAT_TIMEOUT"
    | "WORKER_READINESS_HEARTBEAT_FAILED";
  type: "dependency";
}>;

export interface WorkerReadinessOptions {
  readonly connectTimeoutMs?: number;
  readonly queryTimeoutMs?: number;
  readonly idleSessionTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  /** Receives fixed metadata only; the underlying pg error is never exposed. */
  readonly onLeaseFailure?: (failure: WorkerReadinessFailure) => void;
}

export interface WorkerReadinessLease {
  /** False as soon as release starts or the dedicated session is invalidated. */
  isHealthy(): boolean;
  /** Idempotent: every call returns the same settlement promise. */
  release(): Promise<void>;
}

interface ResolvedOptions {
  readonly connectTimeoutMs: number;
  readonly queryTimeoutMs: number;
  readonly idleSessionTimeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly onLeaseFailure:
    | ((failure: WorkerReadinessFailure) => void)
    | undefined;
}

type DeadlineOutcome<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: "timeout" | "failure" }>;

interface ManagedClient {
  readonly released: () => boolean;
  release(destroy: boolean): boolean;
}

function lockValues(): [number, number] {
  return [WORKER_READINESS_LOCK_NAMESPACE, WORKER_READINESS_LOCK_KEY];
}

function asBoolean(
  result: ReadinessQueryResult,
  field: "acquired" | "released",
): boolean {
  try {
    return result.rows[0]?.[field] === true;
  } catch {
    return false;
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function resolveOptions(options: WorkerReadinessOptions): ResolvedOptions {
  const resolved: ResolvedOptions = {
    connectTimeoutMs:
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    queryTimeoutMs: options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    idleSessionTimeoutMs:
      options.idleSessionTimeoutMs ?? DEFAULT_IDLE_SESSION_TIMEOUT_MS,
    heartbeatIntervalMs:
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    onLeaseFailure: options.onLeaseFailure,
  };
  if (
    !positiveInteger(resolved.connectTimeoutMs) ||
    !positiveInteger(resolved.queryTimeoutMs) ||
    !positiveInteger(resolved.idleSessionTimeoutMs) ||
    !positiveInteger(resolved.heartbeatIntervalMs) ||
    resolved.heartbeatIntervalMs >= resolved.idleSessionTimeoutMs
  ) {
    throw new WorkerReadinessError("WORKER_READINESS_INVALID_OPTIONS");
  }
  return resolved;
}

function unrefTimer(timer: NodeJS.Timeout): void {
  timer.unref();
}

/**
 * Resolve every operation into a closed outcome so raw dependency rejections
 * never cross this module boundary. The operation remains observed after a
 * timeout; a late connection can therefore be destroyed without an unhandled
 * rejection or a pooled-client leak.
 */
function settleWithin<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  onLateResolve?: (value: T) => void,
): Promise<DeadlineOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);
    unrefTimer(timer);

    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (settled) {
            try {
              onLateResolve?.(value);
            } catch {
              // Late cleanup is best effort and must not create an unhandled
              // rejection after the caller has already observed the timeout.
            }
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, value });
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, reason: "failure" });
        },
      );
  });
}

function releaseLateClient(client: ReadinessClient): void {
  try {
    client.release(true);
  } catch {
    // It is already outside the caller's lifecycle. Nothing else can be done
    // safely, and the raw driver failure must not escape as an unhandled error.
  }
}

async function connectWithin(
  pool: WorkerReadinessPool,
  timeoutMs: number,
): Promise<ReadinessClient> {
  const outcome = await settleWithin(
    () => pool.connect(),
    timeoutMs,
    releaseLateClient,
  );
  if (outcome.ok) return outcome.value;
  throw new WorkerReadinessError(
    outcome.reason === "timeout"
      ? "WORKER_READINESS_CONNECT_TIMEOUT"
      : "WORKER_READINESS_CONNECT_FAILED",
  );
}

function queryOutcome(
  client: ReadinessClient,
  sql: string,
  values: unknown[] | undefined,
  timeoutMs: number,
): Promise<DeadlineOutcome<ReadinessQueryResult>> {
  return settleWithin(() => client.query(sql, values), timeoutMs);
}

async function queryWithin(
  client: ReadinessClient,
  sql: string,
  values: unknown[] | undefined,
  timeoutMs: number,
): Promise<ReadinessQueryResult> {
  const outcome = await queryOutcome(client, sql, values, timeoutMs);
  if (outcome.ok) return outcome.value;
  throw new WorkerReadinessError(
    outcome.reason === "timeout"
      ? "WORKER_READINESS_QUERY_TIMEOUT"
      : "WORKER_READINESS_QUERY_FAILED",
  );
}

function manageClient(
  client: ReadinessClient,
  onError: () => void,
): ManagedClient {
  let released = false;
  const errorListener: ReadinessErrorListener = (_error) => {
    try {
      onError();
    } catch {
      // EventEmitter `error` handlers must be total. In particular, never
      // inspect, classify, stringify, or rethrow the driver-provided value.
    }
  };

  const managed: ManagedClient = {
    released: () => released,
    release(destroy: boolean): boolean {
      if (released) return true;
      released = true;
      try {
        client.removeListener("error", errorListener);
      } catch {
        // Releasing/destroying the session is still the priority.
      }
      try {
        if (destroy) client.release(true);
        else client.release();
        return true;
      } catch {
        return false;
      }
    },
  };

  try {
    client.on("error", errorListener);
  } catch {
    managed.release(true);
    throw new WorkerReadinessError(
      "WORKER_READINESS_CLIENT_LISTENER_FAILED",
    );
  }
  return managed;
}

function reportLeaseFailure(
  reporter: ResolvedOptions["onLeaseFailure"],
  failure: WorkerReadinessFailure,
): void {
  try {
    reporter?.(failure);
  } catch {
    // A caller-provided logging sink must not turn session invalidation into an
    // uncaught event-handler exception.
  }
}

/** Acquire and retain the worker's dedicated shared-lock session. */
export async function acquireWorkerReadinessLease(
  pool: WorkerReadinessPool,
  options: WorkerReadinessOptions = {},
): Promise<WorkerReadinessLease> {
  const resolved = resolveOptions(options);
  const client = await connectWithin(pool, resolved.connectTimeoutMs);

  let healthy = true;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let heartbeatInFlight = false;
  let releasePromise: Promise<void> | undefined;

  const stopHeartbeat = (): void => {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const invalidate = (failure: WorkerReadinessFailure): void => {
    if (!healthy) return;
    healthy = false;
    stopHeartbeat();
    managed.release(true);
    releasePromise = Promise.resolve();
    reportLeaseFailure(resolved.onLeaseFailure, failure);
  };

  const managed = manageClient(client, () => {
    invalidate({
      code: "WORKER_READINESS_SESSION_ERROR",
      type: "dependency",
    });
  });

  const idleTimeout = await queryOutcome(
    client,
    "SELECT set_config('idle_session_timeout', $1, false)",
    [`${resolved.idleSessionTimeoutMs}ms`],
    resolved.queryTimeoutMs,
  );
  if (!idleTimeout.ok) {
    managed.release(true);
    throw new WorkerReadinessError(
      idleTimeout.reason === "timeout"
        ? "WORKER_READINESS_QUERY_TIMEOUT"
        : "WORKER_READINESS_QUERY_FAILED",
    );
  }

  const lock = await queryOutcome(
    client,
    "SELECT pg_try_advisory_lock_shared($1, $2) AS acquired",
    lockValues(),
    resolved.queryTimeoutMs,
  );
  if (!lock.ok) {
    managed.release(true);
    throw new WorkerReadinessError(
      lock.reason === "timeout"
        ? "WORKER_READINESS_QUERY_TIMEOUT"
        : "WORKER_READINESS_QUERY_FAILED",
    );
  }
  if (!asBoolean(lock.value, "acquired")) {
    // This session has a dedicated idle_session_timeout. Never return it to the
    // general pool where that session-level setting could affect another user.
    managed.release(true);
    throw new WorkerReadinessError("WORKER_READINESS_LOCK_UNAVAILABLE");
  }

  const heartbeat = async (): Promise<void> => {
    if (!healthy || heartbeatInFlight) return;
    heartbeatInFlight = true;
    const outcome = await queryOutcome(
      client,
      "SELECT 1",
      undefined,
      resolved.queryTimeoutMs,
    );
    heartbeatInFlight = false;
    if (!outcome.ok) {
      invalidate({
        code:
          outcome.reason === "timeout"
            ? "WORKER_READINESS_HEARTBEAT_TIMEOUT"
            : "WORKER_READINESS_HEARTBEAT_FAILED",
        type: "dependency",
      });
    }
  };

  heartbeatTimer = setInterval(() => {
    void heartbeat();
  }, resolved.heartbeatIntervalMs);
  unrefTimer(heartbeatTimer);

  const release = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    healthy = false;
    stopHeartbeat();
    releasePromise = (async () => {
      const unlocked = await queryWithin(
        client,
        "SELECT pg_advisory_unlock_shared($1, $2) AS released",
        lockValues(),
        resolved.queryTimeoutMs,
      ).catch((error: unknown) => {
        managed.release(true);
        throw error;
      });
      if (!asBoolean(unlocked, "released")) {
        managed.release(true);
        throw new WorkerReadinessError(
          "WORKER_READINESS_LEASE_NOT_HELD",
        );
      }
      // The unlock query makes readiness false before this method resolves;
      // destroying the dedicated session then prevents its session-scoped TTL
      // from leaking into the pool.
      if (!managed.release(true)) {
        throw new WorkerReadinessError(
          "WORKER_READINESS_CLIENT_RELEASE_FAILED",
        );
      }
    })();
    return releasePromise;
  };

  return {
    isHealthy: () => healthy && !managed.released(),
    release,
  };
}

/** Return true only while at least one worker holds the shared session lease. */
export async function checkWorkerReadiness(
  pool: WorkerReadinessPool,
  options: WorkerReadinessOptions = {},
): Promise<boolean> {
  const resolved = resolveOptions(options);
  const client = await connectWithin(pool, resolved.connectTimeoutMs);
  let sessionFailed = false;
  const managed = manageClient(client, () => {
    sessionFailed = true;
    managed.release(true);
  });

  const lock = await queryOutcome(
    client,
    "SELECT pg_try_advisory_lock($1, $2) AS acquired",
    lockValues(),
    resolved.queryTimeoutMs,
  );
  if (sessionFailed) {
    managed.release(true);
    throw new WorkerReadinessError("WORKER_READINESS_SESSION_ERROR");
  }
  if (!lock.ok) {
    managed.release(true);
    throw new WorkerReadinessError(
      lock.reason === "timeout"
        ? "WORKER_READINESS_QUERY_TIMEOUT"
        : "WORKER_READINESS_QUERY_FAILED",
    );
  }

  const acquired = asBoolean(lock.value, "acquired");
  if (!acquired) {
    if (!managed.release(false)) {
      throw new WorkerReadinessError(
        "WORKER_READINESS_CLIENT_RELEASE_FAILED",
      );
    }
    return true;
  }

  const unlocked = await queryOutcome(
    client,
    "SELECT pg_advisory_unlock($1, $2) AS released",
    lockValues(),
    resolved.queryTimeoutMs,
  );
  if (sessionFailed) {
    managed.release(true);
    throw new WorkerReadinessError("WORKER_READINESS_SESSION_ERROR");
  }
  if (!unlocked.ok) {
    managed.release(true);
    throw new WorkerReadinessError(
      unlocked.reason === "timeout"
        ? "WORKER_READINESS_QUERY_TIMEOUT"
        : "WORKER_READINESS_QUERY_FAILED",
    );
  }
  if (!asBoolean(unlocked.value, "released")) {
    managed.release(true);
    throw new WorkerReadinessError("WORKER_READINESS_LEASE_NOT_HELD");
  }
  if (!managed.release(false)) {
    throw new WorkerReadinessError(
      "WORKER_READINESS_CLIENT_RELEASE_FAILED",
    );
  }
  return false;
}
