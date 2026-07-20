import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createDbHandle: vi.fn(),
  createBoss: vi.fn(),
  acquireWorkerReadinessLease: vi.fn(),
  startBoss: vi.fn(),
  resolveBuildMetadata: vi.fn(),
  createLogger: vi.fn(),
  getWorkerEnv: vi.fn(),
  buildWorkerContext: vi.fn(),
  registerCollectHandlers: vi.fn(),
  registerDiagnoseHandler: vi.fn(),
  registerArtifactHandlers: vi.fn(),
  startWorkerMaintenance: vi.fn(),
  getWorkerMaintenanceFromStartError: vi.fn(),
  startWorkerHealthSnapshotLoop: vi.fn(),
}));

vi.mock("@sf/db", () => ({
  createDbHandle: mocked.createDbHandle,
  createBoss: mocked.createBoss,
  acquireWorkerReadinessLease: mocked.acquireWorkerReadinessLease,
  startBoss: mocked.startBoss,
}));
vi.mock("@sf/contracts", () => ({
  resolveBuildMetadata: mocked.resolveBuildMetadata,
}));
vi.mock("@sf/observability", () => ({
  createLogger: mocked.createLogger,
}));
vi.mock("./env.ts", () => ({ getWorkerEnv: mocked.getWorkerEnv }));
vi.mock("./context.ts", () => ({
  buildWorkerContext: mocked.buildWorkerContext,
}));
vi.mock("./handlers/collect.ts", () => ({
  registerCollectHandlers: mocked.registerCollectHandlers,
}));
vi.mock("./handlers/diagnose.ts", () => ({
  registerDiagnoseHandler: mocked.registerDiagnoseHandler,
}));
vi.mock("./handlers/artifact.ts", () => ({
  registerArtifactHandlers: mocked.registerArtifactHandlers,
}));
vi.mock("./maintenance.ts", () => ({
  startWorkerMaintenance: mocked.startWorkerMaintenance,
  getWorkerMaintenanceFromStartError:
    mocked.getWorkerMaintenanceFromStartError,
}));
vi.mock("./health-snapshot.ts", () => ({
  startWorkerHealthSnapshotLoop: mocked.startWorkerHealthSnapshotLoop,
}));

import { start } from "./index.ts";

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

function configureSuccessfulBoot(order: string[]) {
  let bossErrorListener: ((error: unknown) => void) | undefined;
  const logger = {
    info: vi.fn((event: string) => {
      if (event === "worker_ready") order.push("ready");
    }),
    error: vi.fn(),
  };
  const db = {
    pool: {},
    db: {},
    end: vi.fn(async () => {
      order.push("database.stop");
    }),
  };
  const boss = {
    on: vi.fn((_event: string, listener: (error: unknown) => void) => {
      bossErrorListener = listener;
      return boss;
    }),
    stop: vi.fn(async () => {
      order.push("boss.stop");
    }),
  };
  const readiness = {
    isHealthy: vi.fn(() => true),
    release: vi.fn(async () => {
      order.push("readiness.stop");
    }),
  };
  const maintenance = {
    stop: vi.fn(async () => {
      order.push("maintenance.stop");
    }),
  };
  const health = {
    stop: vi.fn(async () => {
      order.push("health.stop");
    }),
  };

  mocked.getWorkerEnv.mockReturnValue({
    DATABASE_URL: "postgresql://unused.invalid/db",
    DB_POOL_MAX: 1,
    LOG_LEVEL: "info",
  });
  mocked.createLogger.mockReturnValue(logger);
  mocked.resolveBuildMetadata.mockReturnValue({ version: "test" });
  mocked.createDbHandle.mockReturnValue(db);
  mocked.createBoss.mockReturnValue(boss);
  mocked.startBoss.mockImplementation(async () => {
    order.push("boss.start");
  });
  mocked.buildWorkerContext.mockReturnValue({});
  mocked.registerCollectHandlers.mockImplementation(async () => {
    order.push("collect");
  });
  mocked.registerDiagnoseHandler.mockImplementation(async () => {
    order.push("diagnose");
  });
  mocked.registerArtifactHandlers.mockImplementation(async () => {
    order.push("artifact");
  });
  mocked.startWorkerMaintenance.mockImplementation(async () => {
    order.push("maintenance.start");
    return maintenance;
  });
  mocked.getWorkerMaintenanceFromStartError.mockReturnValue(undefined);
  mocked.acquireWorkerReadinessLease.mockImplementation(async () => {
    order.push("readiness.acquire");
    return readiness;
  });
  mocked.startWorkerHealthSnapshotLoop.mockImplementation(() => {
    order.push("health.start");
    return health;
  });

  return {
    logger,
    db,
    boss,
    readiness,
    maintenance,
    health,
    bossErrorListener: () => bossErrorListener,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("worker bootstrap lifecycle", () => {
  it("aborts the signal installed in the worker context before graceful drain", async () => {
    const resources = configureSuccessfulBoot([]);
    const runtime = await start({ installSignalHandlers: false });
    const contextInput = mocked.buildWorkerContext.mock.calls[0]?.[0] as
      | { signal?: AbortSignal }
      | undefined;

    expect(contextInput?.signal).toBeInstanceOf(AbortSignal);
    expect(contextInput?.signal?.aborted).toBe(false);

    const stopping = runtime.stop();
    expect(contextInput?.signal?.aborted).toBe(true);
    await expect(stopping).resolves.toEqual({ ok: true, failures: [] });
    expect(resources.boss.stop).toHaveBeenCalledWith({ graceful: true });
  });

  it("advertises readiness only after boss, all handlers, and blocking maintenance succeed", async () => {
    const order: string[] = [];
    const resources = configureSuccessfulBoot(order);

    const runtime = await start({ installSignalHandlers: false });

    expect(order).toEqual([
      "boss.start",
      "collect",
      "diagnose",
      "artifact",
      "maintenance.start",
      "readiness.acquire",
      "health.start",
      "ready",
    ]);
    expect(mocked.acquireWorkerReadinessLease).toHaveBeenCalledWith(
      resources.db.pool,
      expect.objectContaining({ onLeaseFailure: expect.any(Function) }),
    );
    expect(mocked.startWorkerMaintenance).toHaveBeenCalledWith(
      {},
      { signal: expect.any(AbortSignal) },
    );

    const firstStop = runtime.stop();
    const secondStop = runtime.stop();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).resolves.toEqual({ ok: true, failures: [] });
    expect(order.slice(-5)).toEqual([
      "readiness.stop",
      "health.stop",
      "maintenance.stop",
      "boss.stop",
      "database.stop",
    ]);
  });

  it("wires duration-only slow-query logs and starts health after readiness", async () => {
    const resources = configureSuccessfulBoot([]);

    const runtime = await start({ installSignalHandlers: false });

    expect(mocked.createDbHandle).toHaveBeenCalledWith(
      "postgresql://unused.invalid/db",
      1,
      expect.objectContaining({
        slowQueryThresholdMs: expect.any(Number),
        onSlowQuery: expect.any(Function),
      }),
    );
    const instrumentation = mocked.createDbHandle.mock.calls[0]?.[2] as {
      slowQueryThresholdMs: number;
      onSlowQuery(event: Record<string, unknown>): void;
    };
    instrumentation.onSlowQuery({
      durationMs: 1_234.5,
      sql: "select customer_secret",
      payload: "customer-payload-secret",
    });
    expect(resources.logger.info).toHaveBeenCalledWith("db_slow_query", {
      durationMs: 1_234.5,
      thresholdMs: instrumentation.slowQueryThresholdMs,
    });
    expect(JSON.stringify(resources.logger.info.mock.calls)).not.toMatch(
      /select customer_secret|customer-payload-secret/,
    );
    const slowLogCount = resources.logger.info.mock.calls.filter(
      ([event]) => event === "db_slow_query",
    ).length;
    expect(() =>
      instrumentation.onSlowQuery({ durationMs: Number.NaN }),
    ).not.toThrow();
    expect(() =>
      instrumentation.onSlowQuery(
        new Proxy(
          {},
          {
            get() {
              throw new Error("slow-query-customer-secret");
            },
          },
        ),
      ),
    ).not.toThrow();
    expect(
      resources.logger.info.mock.calls.filter(
        ([event]) => event === "db_slow_query",
      ),
    ).toHaveLength(slowLogCount);
    expect(mocked.startWorkerHealthSnapshotLoop).toHaveBeenCalledWith({
      db: resources.db,
      readiness: resources.readiness,
      logger: resources.logger,
    });

    await runtime.stop();
  });

  it("keeps boss and readiness error callbacks total and emits fixed metadata only", async () => {
    const resources = configureSuccessfulBoot([]);
    await start({ installSignalHandlers: false });
    const bossListener = resources.bossErrorListener();
    const readinessOptions = mocked.acquireWorkerReadinessLease.mock.calls[0]?.[1] as
      | { onLeaseFailure?: (failure: Record<string, unknown>) => void }
      | undefined;
    const hostile = new Proxy(new Error("customer-secret"), {
      getPrototypeOf() {
        throw new Error("must not inspect");
      },
      get() {
        throw new Error("must not read");
      },
    });

    resources.logger.error.mockImplementationOnce(() => {
      throw new Error("broken sink");
    });
    expect(() => bossListener?.(hostile)).not.toThrow();
    expect(() =>
      readinessOptions?.onLeaseFailure?.({
        code: "WORKER_READINESS_SESSION_ERROR",
        type: "dependency",
      }),
    ).not.toThrow();

    expect(resources.logger.error).toHaveBeenLastCalledWith(
      "worker_readiness_lease_failed",
      {
        code: "WORKER_READINESS_SESSION_ERROR",
        type: "dependency",
      },
    );
  });

  it("performs bounded best-effort cleanup of every started resource after boot fails", async () => {
    vi.useFakeTimers();
    const resources = configureSuccessfulBoot([]);
    const bossStop = deferred<void>();
    resources.boss.stop.mockReturnValue(bossStop.promise);
    const hostile = new Proxy(new Error("customer-secret"), {
      getPrototypeOf() {
        throw new Error("must not inspect");
      },
      get() {
        throw new Error("must not read");
      },
    });
    mocked.registerDiagnoseHandler.mockRejectedValue(hostile);

    const boot = start({
      installSignalHandlers: false,
      shutdownStageTimeoutMs: 20,
    });
    const rejected = expect(boot).rejects.toBe(hostile);
    await vi.advanceTimersByTimeAsync(20);
    await rejected;

    const failedContextInput = mocked.buildWorkerContext.mock.calls[0]?.[0] as
      | { signal?: AbortSignal }
      | undefined;
    expect(failedContextInput?.signal?.aborted).toBe(true);

    expect(resources.readiness.release).not.toHaveBeenCalled();
    expect(resources.maintenance.stop).not.toHaveBeenCalled();
    expect(resources.boss.stop).toHaveBeenCalledTimes(1);
    expect(resources.db.end).toHaveBeenCalledTimes(1);
    expect(resources.logger.info).not.toHaveBeenCalledWith(
      "worker_ready",
      expect.anything(),
    );

    bossStop.reject(new Error("late secret"));
    await Promise.resolve();
  });

  it("releases maintenance, boss, and database when final readiness acquisition fails", async () => {
    const resources = configureSuccessfulBoot([]);
    const bootFailure = new Error("readiness unavailable");
    mocked.acquireWorkerReadinessLease.mockRejectedValue(bootFailure);

    await expect(
      start({ installSignalHandlers: false, shutdownStageTimeoutMs: 20 }),
    ).rejects.toBe(bootFailure);

    expect(resources.maintenance.stop).toHaveBeenCalledTimes(1);
    expect(resources.boss.stop).toHaveBeenCalledTimes(1);
    expect(resources.db.end).toHaveBeenCalledTimes(1);
    expect(resources.logger.info).not.toHaveBeenCalledWith(
      "worker_ready",
      expect.anything(),
    );
  });

  it("cleans readiness and every earlier resource when health startup fails", async () => {
    const resources = configureSuccessfulBoot([]);
    const bootFailure = new Error("health-startup-customer-secret");
    mocked.startWorkerHealthSnapshotLoop.mockImplementation(() => {
      throw bootFailure;
    });

    await expect(
      start({ installSignalHandlers: false, shutdownStageTimeoutMs: 20 }),
    ).rejects.toBe(bootFailure);

    expect(resources.readiness.release).toHaveBeenCalledTimes(1);
    expect(resources.health.stop).not.toHaveBeenCalled();
    expect(resources.maintenance.stop).toHaveBeenCalledTimes(1);
    expect(resources.boss.stop).toHaveBeenCalledTimes(1);
    expect(resources.db.end).toHaveBeenCalledTimes(1);
    expect(resources.logger.info).not.toHaveBeenCalledWith(
      "worker_ready",
      expect.anything(),
    );
  });

  it("adopts and reports partial maintenance from a failed startup rollback", async () => {
    const resources = configureSuccessfulBoot([]);
    const startupFailure = new Error("maintenance-startup-customer-secret");
    const partialMaintenance = {
      stop: vi.fn(async () => {
        throw new Error("partial-stop-customer-secret");
      }),
    };
    mocked.startWorkerMaintenance.mockRejectedValue(startupFailure);
    mocked.getWorkerMaintenanceFromStartError.mockReturnValue(
      partialMaintenance,
    );

    await expect(
      start({ installSignalHandlers: false, shutdownStageTimeoutMs: 20 }),
    ).rejects.toBe(startupFailure);

    expect(partialMaintenance.stop).toHaveBeenCalledTimes(1);
    expect(resources.boss.stop).toHaveBeenCalledTimes(1);
    expect(resources.db.end).toHaveBeenCalledTimes(1);
    expect(resources.logger.error).toHaveBeenCalledWith(
      "worker_boot_cleanup_incomplete",
      {
        code: "WORKER_BOOT_CLEANUP_FAILED",
        type: "internal",
        failedStages: ["maintenance"],
      },
    );
    expect(JSON.stringify(resources.logger.error.mock.calls)).not.toMatch(
      /maintenance-startup-customer-secret|partial-stop-customer-secret/,
    );
  });

  it("routes SIGINT and SIGTERM through the same natural-exit shutdown", async () => {
    const resources = configureSuccessfulBoot([]);
    const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
    const originalExitCode = process.exitCode;
    const once = vi.spyOn(process, "once").mockImplementation(
      ((_event: string | symbol, _listener: (...args: unknown[]) => void) =>
        process) as typeof process.once,
    );
    vi.spyOn(process, "on").mockImplementation(
      ((event: string | symbol, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return process;
      }) as typeof process.on,
    );

    try {
      await start({
        installSignalHandlers: true,
        shutdownStageTimeoutMs: 20,
        forceShutdownTimeoutMs: 100,
      });
      const onInterrupt = listeners.get("SIGINT");
      const onTerminate = listeners.get("SIGTERM");
      expect(onInterrupt).toBeTypeOf("function");
      expect(onTerminate).toBeTypeOf("function");
      expect(once).not.toHaveBeenCalledWith(
        expect.stringMatching(/^SIG/),
        expect.any(Function),
      );

      onInterrupt?.();
      onTerminate?.();
      await vi.waitFor(() => expect(process.exitCode).toBe(0));

      expect(resources.readiness.release).toHaveBeenCalledTimes(1);
      expect(resources.health.stop).toHaveBeenCalledTimes(1);
      expect(resources.maintenance.stop).toHaveBeenCalledTimes(1);
      expect(resources.boss.stop).toHaveBeenCalledTimes(1);
      expect(resources.db.end).toHaveBeenCalledTimes(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("installs signal handling before startup resources and cleans partial boot without advertising ready", async () => {
    const order: string[] = [];
    const resources = configureSuccessfulBoot(order);
    const bossStarted = deferred<void>();
    mocked.startBoss.mockImplementation(() => bossStarted.promise);
    const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
    const originalExitCode = process.exitCode;
    vi.spyOn(process, "once").mockImplementation(
      ((_event: string | symbol, _listener: (...args: unknown[]) => void) =>
        process) as typeof process.once,
    );
    vi.spyOn(process, "on").mockImplementation(
      ((event: string | symbol, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return process;
      }) as typeof process.on,
    );

    try {
      const boot = start({
        installSignalHandlers: true,
        shutdownStageTimeoutMs: 20,
        forceShutdownTimeoutMs: 100,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const onTerminate = listeners.get("SIGTERM");
      expect(onTerminate).toBeTypeOf("function");

      onTerminate?.();
      expect(resources.boss.stop).not.toHaveBeenCalled();
      bossStarted.resolve();
      const runtime = await boot;
      await vi.waitFor(() => expect(process.exitCode).toBe(0));

      expect(mocked.registerCollectHandlers).not.toHaveBeenCalled();
      expect(mocked.registerDiagnoseHandler).not.toHaveBeenCalled();
      expect(mocked.registerArtifactHandlers).not.toHaveBeenCalled();
      expect(mocked.startWorkerMaintenance).not.toHaveBeenCalled();
      expect(mocked.acquireWorkerReadinessLease).not.toHaveBeenCalled();
      expect(resources.boss.stop).toHaveBeenCalledTimes(1);
      expect(resources.db.end).toHaveBeenCalledTimes(1);
      expect(resources.logger.info).not.toHaveBeenCalledWith(
        "worker_ready",
        expect.anything(),
      );
      await expect(runtime.stop()).resolves.toEqual({
        ok: true,
        failures: [],
      });
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("releases a readiness lease immediately when shutdown was requested during its acquisition", async () => {
    const resources = configureSuccessfulBoot([]);
    const readinessAcquired = deferred<typeof resources.readiness>();
    mocked.acquireWorkerReadinessLease.mockImplementation(
      () => readinessAcquired.promise,
    );
    const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
    const originalExitCode = process.exitCode;
    vi.spyOn(process, "once").mockImplementation(
      ((_event: string | symbol, _listener: (...args: unknown[]) => void) =>
        process) as typeof process.once,
    );
    vi.spyOn(process, "on").mockImplementation(
      ((event: string | symbol, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return process;
      }) as typeof process.on,
    );

    try {
      const boot = start({
        installSignalHandlers: true,
        shutdownStageTimeoutMs: 20,
        forceShutdownTimeoutMs: 100,
      });
      await vi.waitFor(() =>
        expect(mocked.acquireWorkerReadinessLease).toHaveBeenCalledTimes(1),
      );

      listeners.get("SIGINT")?.();
      readinessAcquired.resolve(resources.readiness);
      await boot;
      await vi.waitFor(() => expect(process.exitCode).toBe(0));

      expect(resources.readiness.release).toHaveBeenCalledTimes(1);
      expect(resources.maintenance.stop).toHaveBeenCalledTimes(1);
      expect(resources.boss.stop).toHaveBeenCalledTimes(1);
      expect(resources.db.end).toHaveBeenCalledTimes(1);
      expect(resources.logger.info).not.toHaveBeenCalledWith(
        "worker_ready",
        expect.anything(),
      );
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("cleans a signalled partial boot but keeps a later startup rejection nonzero", async () => {
    const resources = configureSuccessfulBoot([]);
    const bossStarted = deferred<void>();
    mocked.startBoss.mockImplementation(() => bossStarted.promise);
    const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
    const originalExitCode = process.exitCode;
    vi.spyOn(process, "once").mockImplementation(
      ((_event: string | symbol, _listener: (...args: unknown[]) => void) =>
        process) as typeof process.once,
    );
    vi.spyOn(process, "on").mockImplementation(
      ((event: string | symbol, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return process;
      }) as typeof process.on,
    );
    const bootFailure = new Proxy(new Error("customer-secret"), {
      getPrototypeOf() {
        throw new Error("must not inspect");
      },
      get() {
        throw new Error("must not read");
      },
    });

    try {
      const boot = start({
        installSignalHandlers: true,
        shutdownStageTimeoutMs: 20,
        forceShutdownTimeoutMs: 100,
      });
      const rejected = expect(boot).rejects.toBe(bootFailure);
      await new Promise<void>((resolve) => setImmediate(resolve));

      listeners.get("SIGTERM")?.();
      bossStarted.reject(bootFailure);
      await rejected;
      await vi.waitFor(() => expect(process.exitCode).toBe(1));

      expect(resources.boss.stop).toHaveBeenCalledTimes(1);
      expect(resources.db.end).toHaveBeenCalledTimes(1);
      expect(mocked.registerCollectHandlers).not.toHaveBeenCalled();
      expect(resources.logger.info).not.toHaveBeenCalledWith(
        "worker_ready",
        expect.anything(),
      );
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
