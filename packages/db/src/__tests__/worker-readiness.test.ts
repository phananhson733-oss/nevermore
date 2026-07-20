import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireWorkerReadinessLease,
  checkWorkerReadiness,
  type WorkerReadinessFailure,
  type WorkerReadinessPool,
} from "../worker-readiness.ts";

type FakeResult = {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
};

type ErrorListener = (error: Error) => void;

interface FakeClient {
  readonly query: ReturnType<
    typeof vi.fn<(sql: string, values?: unknown[]) => Promise<FakeResult>>
  >;
  readonly release: ReturnType<
    typeof vi.fn<(error?: Error | boolean) => void>
  >;
  readonly on: ReturnType<
    typeof vi.fn<(event: "error", listener: ErrorListener) => FakeClient>
  >;
  readonly removeListener: ReturnType<
    typeof vi.fn<(event: "error", listener: ErrorListener) => FakeClient>
  >;
  errorListener(): ErrorListener | undefined;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function fakeClient(
  implementation?: (sql: string, values?: unknown[]) => Promise<FakeResult>,
): FakeClient {
  let listener: ErrorListener | undefined;
  const client = {} as FakeClient;
  Object.assign(client, {
    query: vi.fn(
      implementation ??
        (async () => {
          throw new Error("unexpected query");
        }),
    ),
    release: vi.fn<(error?: Error | boolean) => void>(),
    on: vi.fn((event: "error", next: ErrorListener) => {
      if (event === "error") listener = next;
      return client;
    }),
    removeListener: vi.fn((event: "error", current: ErrorListener) => {
      if (event === "error" && listener === current) listener = undefined;
      return client;
    }),
    errorListener: () => listener,
  });
  return client;
}

function fakePool(
  results: ReadonlyArray<FakeResult>,
): { readonly pool: WorkerReadinessPool; readonly client: FakeClient } {
  const remaining = [...results];
  const client = fakeClient(async () => {
    const result = remaining.shift();
    if (!result) throw new Error("unexpected query");
    return result;
  });
  return {
    pool: { connect: vi.fn(async () => client) },
    client,
  };
}

const fastOptions = {
  connectTimeoutMs: 25,
  queryTimeoutMs: 25,
  idleSessionTimeoutMs: 100,
  heartbeatIntervalMs: 20,
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("worker readiness advisory lease", () => {
  it("configures a finite idle-session TTL before acquiring and retaining the shared lease", async () => {
    const { pool, client } = fakePool([
      { rows: [] },
      { rows: [{ acquired: true }] },
      { rows: [{ released: true }] },
    ]);

    const lease = await acquireWorkerReadinessLease(pool, fastOptions);

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(String(client.query.mock.calls[0]?.[0])).toContain(
      "idle_session_timeout",
    );
    expect(client.query.mock.calls[0]?.[1]).toEqual(["100ms"]);
    expect(String(client.query.mock.calls[1]?.[0])).toContain(
      "pg_try_advisory_lock_shared",
    );
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(client.release).not.toHaveBeenCalled();
    expect(lease.isHealthy()).toBe(true);

    const firstRelease = lease.release();
    const secondRelease = lease.release();
    expect(secondRelease).toBe(firstRelease);
    await firstRelease;

    expect(client.query).toHaveBeenCalledTimes(3);
    expect(String(client.query.mock.calls[2]?.[0])).toContain(
      "pg_advisory_unlock_shared",
    );
    expect(client.removeListener).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(lease.isHealthy()).toBe(false);
  });

  it("heartbeats the dedicated session on the event loop before its idle TTL", async () => {
    vi.useFakeTimers();
    const client = fakeClient(async (sql) => {
      if (sql.includes("pg_try_advisory_lock_shared")) {
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes("pg_advisory_unlock_shared")) {
        return { rows: [{ released: true }] };
      }
      return { rows: [] };
    });
    const pool: WorkerReadinessPool = {
      connect: vi.fn(async () => client),
    };

    const lease = await acquireWorkerReadinessLease(pool, fastOptions);
    await vi.advanceTimersByTimeAsync(65);

    expect(
      client.query.mock.calls.filter(([sql]) => sql === "SELECT 1"),
    ).toHaveLength(3);
    expect(lease.isHealthy()).toBe(true);

    await lease.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(
      client.query.mock.calls.filter(([sql]) => sql === "SELECT 1"),
    ).toHaveLength(3);
  });

  it("invalidates and destroys the lease exactly once on a dedicated-client error without inspecting it", async () => {
    const failureEvents: WorkerReadinessFailure[] = [];
    const { pool, client } = fakePool([
      { rows: [] },
      { rows: [{ acquired: true }] },
    ]);
    const lease = await acquireWorkerReadinessLease(pool, {
      ...fastOptions,
      onLeaseFailure: (event) => failureEvents.push(event),
    });
    const listener = client.errorListener();
    expect(listener).toBeTypeOf("function");

    const hostileError = new Proxy(new Error("customer-secret"), {
      getPrototypeOf() {
        throw new Error("must not inspect");
      },
      get() {
        throw new Error("must not read");
      },
    });

    expect(() => listener?.(hostileError)).not.toThrow();
    expect(() => listener?.(hostileError)).not.toThrow();

    expect(lease.isHealthy()).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(failureEvents).toEqual([
      {
        code: "WORKER_READINESS_SESSION_ERROR",
        type: "dependency",
      },
    ]);
    await expect(lease.release()).resolves.toBeUndefined();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("invalidates and destroys the lease once when a heartbeat exceeds its query deadline", async () => {
    vi.useFakeTimers();
    const heartbeat = deferred<FakeResult>();
    const failures: WorkerReadinessFailure[] = [];
    const client = fakeClient(async (sql) => {
      if (sql.includes("pg_try_advisory_lock_shared")) {
        return { rows: [{ acquired: true }] };
      }
      if (sql === "SELECT 1") return heartbeat.promise;
      return { rows: [] };
    });
    const lease = await acquireWorkerReadinessLease(
      { connect: vi.fn(async () => client) },
      { ...fastOptions, onLeaseFailure: (event) => failures.push(event) },
    );

    await vi.advanceTimersByTimeAsync(45);

    expect(lease.isHealthy()).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(failures).toEqual([
      {
        code: "WORKER_READINESS_HEARTBEAT_TIMEOUT",
        type: "dependency",
      },
    ]);

    heartbeat.resolve({ rows: [] });
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("bounds pool acquisition and destroys a client that settles after the deadline", async () => {
    vi.useFakeTimers();
    const pendingClient = deferred<FakeClient>();
    const client = fakeClient();
    const pool: WorkerReadinessPool = {
      connect: vi.fn(() => pendingClient.promise),
    };

    const acquisition = acquireWorkerReadinessLease(pool, fastOptions);
    const rejected = expect(acquisition).rejects.toMatchObject({
      code: "WORKER_READINESS_CONNECT_TIMEOUT",
      message: "Worker readiness database connection timed out.",
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    pendingClient.resolve(client);
    await Promise.resolve();
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("bounds acquisition queries, destroys the session, and consumes a late settlement", async () => {
    vi.useFakeTimers();
    const pendingQuery = deferred<FakeResult>();
    const client = fakeClient(() => pendingQuery.promise);
    const pool: WorkerReadinessPool = {
      connect: vi.fn(async () => client),
    };

    const acquisition = acquireWorkerReadinessLease(pool, fastOptions);
    const rejected = expect(acquisition).rejects.toMatchObject({
      code: "WORKER_READINESS_QUERY_TIMEOUT",
      message: "Worker readiness database query timed out.",
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    pendingQuery.reject(new Error("late secret"));
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("bounds lease release and destroys the session exactly once on timeout", async () => {
    vi.useFakeTimers();
    const unlock = deferred<FakeResult>();
    const client = fakeClient(async (sql) => {
      if (sql.includes("pg_try_advisory_lock_shared")) {
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes("pg_advisory_unlock_shared")) return unlock.promise;
      return { rows: [] };
    });
    const lease = await acquireWorkerReadinessLease(
      { connect: vi.fn(async () => client) },
      fastOptions,
    );

    const release = lease.release();
    const sameRelease = lease.release();
    expect(sameRelease).toBe(release);
    const rejected = expect(release).rejects.toMatchObject({
      code: "WORKER_READINESS_QUERY_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    unlock.resolve({ rows: [{ released: true }] });
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("fails worker boot safely when the shared readiness lease cannot be acquired", async () => {
    const { pool, client } = fakePool([
      { rows: [] },
      { rows: [{ acquired: false }] },
    ]);

    await expect(
      acquireWorkerReadinessLease(pool, fastOptions),
    ).rejects.toMatchObject({
      code: "WORKER_READINESS_LOCK_UNAVAILABLE",
    });
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("reports ready when an exclusive probe is blocked by a worker shared lease", async () => {
    const { pool, client } = fakePool([{ rows: [{ acquired: false }] }]);

    await expect(checkWorkerReadiness(pool, fastOptions)).resolves.toBe(true);

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0]?.[0])).toContain(
      "pg_try_advisory_lock",
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("reports not ready and immediately unlocks when no worker owns a lease", async () => {
    const { pool, client } = fakePool([
      { rows: [{ acquired: true }] },
      { rows: [{ released: true }] },
    ]);

    await expect(checkWorkerReadiness(pool, fastOptions)).resolves.toBe(false);

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(String(client.query.mock.calls[1]?.[0])).toContain(
      "pg_advisory_unlock",
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("bounds readiness probes and destroys their client exactly once", async () => {
    vi.useFakeTimers();
    const query = deferred<FakeResult>();
    const client = fakeClient(() => query.promise);

    const probe = checkWorkerReadiness(
      { connect: vi.fn(async () => client) },
      fastOptions,
    );
    const rejected = expect(probe).rejects.toMatchObject({
      code: "WORKER_READINESS_QUERY_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    query.reject(new Error("late secret"));
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid timing configuration before opening a database session", async () => {
    const connect = vi.fn(async () => fakeClient());

    await expect(
      acquireWorkerReadinessLease(
        { connect },
        {
          ...fastOptions,
          idleSessionTimeoutMs: 20,
          heartbeatIntervalMs: 20,
        },
      ),
    ).rejects.toMatchObject({
      code: "WORKER_READINESS_INVALID_OPTIONS",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("converts connect and query rejections to stable errors without inspecting them", async () => {
    const hostile = new Proxy(new Error("customer-secret"), {
      getPrototypeOf() {
        throw new Error("must not inspect");
      },
      get() {
        throw new Error("must not read");
      },
    });

    await expect(
      acquireWorkerReadinessLease(
        { connect: vi.fn(() => Promise.reject(hostile)) },
        fastOptions,
      ),
    ).rejects.toMatchObject({ code: "WORKER_READINESS_CONNECT_FAILED" });

    const client = fakeClient(() => Promise.reject(hostile));
    await expect(
      acquireWorkerReadinessLease(
        { connect: vi.fn(async () => client) },
        fastOptions,
      ),
    ).rejects.toMatchObject({ code: "WORKER_READINESS_QUERY_FAILED" });
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("turns a rejected heartbeat into one fixed failure even when its reporter throws", async () => {
    vi.useFakeTimers();
    const client = fakeClient(async (sql) => {
      if (sql.includes("pg_try_advisory_lock_shared")) {
        return { rows: [{ acquired: true }] };
      }
      if (sql === "SELECT 1") throw new Error("customer-secret");
      return { rows: [] };
    });
    const lease = await acquireWorkerReadinessLease(
      { connect: vi.fn(async () => client) },
      {
        ...fastOptions,
        onLeaseFailure() {
          throw new Error("broken sink");
        },
      },
    );

    await vi.advanceTimersByTimeAsync(20);

    expect(lease.isHealthy()).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("fails closed when lease or probe unlock results claim no lock was held", async () => {
    const leaseClient = fakePool([
      { rows: [] },
      { rows: [{ acquired: true }] },
      { rows: [{ released: false }] },
    ]);
    const lease = await acquireWorkerReadinessLease(
      leaseClient.pool,
      fastOptions,
    );
    await expect(lease.release()).rejects.toMatchObject({
      code: "WORKER_READINESS_LEASE_NOT_HELD",
    });
    expect(leaseClient.client.release).toHaveBeenCalledWith(true);

    const probeClient = fakePool([
      { rows: [{ acquired: true }] },
      { rows: [{ released: false }] },
    ]);
    await expect(
      checkWorkerReadiness(probeClient.pool, fastOptions),
    ).rejects.toMatchObject({ code: "WORKER_READINESS_LEASE_NOT_HELD" });
    expect(probeClient.client.release).toHaveBeenCalledWith(true);
  });

  it("fails a probe safely when its dedicated client emits an error mid-query", async () => {
    const pending = deferred<FakeResult>();
    const client = fakeClient(() => pending.promise);
    const probe = checkWorkerReadiness(
      { connect: vi.fn(async () => client) },
      fastOptions,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const listener = client.errorListener();
    expect(listener).toBeTypeOf("function");

    listener?.(new Error("customer-secret"));
    pending.resolve({ rows: [{ acquired: false }] });

    await expect(probe).rejects.toMatchObject({
      code: "WORKER_READINESS_SESSION_ERROR",
    });
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("surfaces a stable failure if returning a healthy probe client to its pool throws", async () => {
    const client = fakeClient(async () => ({ rows: [{ acquired: false }] }));
    client.release.mockImplementation(() => {
      throw new Error("customer-secret");
    });

    await expect(
      checkWorkerReadiness(
        { connect: vi.fn(async () => client) },
        fastOptions,
      ),
    ).rejects.toMatchObject({
      code: "WORKER_READINESS_CLIENT_RELEASE_FAILED",
    });
  });
});
