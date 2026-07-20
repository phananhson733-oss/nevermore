import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkerShutdownCoordinator,
  createWorkerSignalHandler,
  type WorkerShutdownResult,
} from "./shutdown-coordinator.ts";

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

function fakeLogger() {
  return {
    info: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
    error: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("worker shutdown coordinator", () => {
  it("caches one stop Promise and releases readiness before every other stage", async () => {
    const calls: string[] = [];
    const logger = fakeLogger();
    const shutdown = createWorkerShutdownCoordinator(
      {
        readiness: {
          release: vi.fn(async () => {
            calls.push("readiness");
          }),
        },
        health: {
          stop: vi.fn(async () => {
            calls.push("health");
          }),
        },
        maintenance: {
          stop: vi.fn(async () => {
            calls.push("maintenance");
          }),
        },
        boss: {
          stop: vi.fn(async () => {
            calls.push("boss");
          }),
        },
        database: {
          end: vi.fn(async () => {
            calls.push("database");
          }),
        },
      },
      logger,
      { stageTimeoutMs: 25 },
    );

    const first = shutdown.stop();
    const second = shutdown.stop();

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ ok: true, failures: [] });
    expect(calls).toEqual([
      "readiness",
      "health",
      "maintenance",
      "boss",
      "database",
    ]);
    expect(logger.info).toHaveBeenNthCalledWith(1, "worker_stopping", {});
    expect(logger.info).toHaveBeenNthCalledWith(2, "worker_stopped", {
      ok: true,
      failedStages: [],
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("bounds a stuck health loop before continuing every later stage", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const healthStop = vi.fn(() => new Promise<void>(() => undefined));
    const shutdown = createWorkerShutdownCoordinator(
      {
        health: { stop: healthStop },
        maintenance: {
          stop: vi.fn(async () => {
            calls.push("maintenance");
          }),
        },
        boss: {
          stop: vi.fn(async () => {
            calls.push("boss");
          }),
        },
        database: {
          end: vi.fn(async () => {
            calls.push("database");
          }),
        },
      },
      fakeLogger(),
      { stageTimeoutMs: 20 },
    );

    const result = shutdown.stop();
    await vi.advanceTimersByTimeAsync(20);

    expect(healthStop).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["maintenance", "boss", "database"]);
    await expect(result).resolves.toEqual({
      ok: false,
      failures: [
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "health",
          reason: "timeout",
        },
      ],
    });
  });

  it("bounds every stage, continues cleanup, and logs fixed failure metadata only", async () => {
    vi.useFakeTimers();
    const readiness = deferred<void>();
    const database = deferred<void>();
    const logger = fakeLogger();
    const hostileFailure = new Proxy(new Error("customer-secret"), {
      getPrototypeOf() {
        throw new Error("must not inspect");
      },
      get() {
        throw new Error("must not read");
      },
    });
    const maintenanceStop = vi.fn(() => Promise.reject(hostileFailure));
    const bossStop = vi.fn(async () => undefined);
    const shutdown = createWorkerShutdownCoordinator(
      {
        readiness: { release: vi.fn(() => readiness.promise) },
        maintenance: { stop: maintenanceStop },
        boss: { stop: bossStop },
        database: { end: vi.fn(() => database.promise) },
      },
      logger,
      { stageTimeoutMs: 20 },
    );

    const result = shutdown.stop();
    await vi.advanceTimersByTimeAsync(20);
    expect(maintenanceStop).toHaveBeenCalledTimes(1);
    expect(bossStop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);

    await expect(result).resolves.toEqual({
      ok: false,
      failures: [
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "readiness",
          reason: "timeout",
        },
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "maintenance",
          reason: "failure",
        },
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "database",
          reason: "timeout",
        },
      ],
    });
    expect(logger.error.mock.calls).toEqual([
      [
        "worker_shutdown_stage_failed",
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "readiness",
          reason: "timeout",
        },
      ],
      [
        "worker_shutdown_stage_failed",
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "maintenance",
          reason: "failure",
        },
      ],
      [
        "worker_shutdown_stage_failed",
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "database",
          reason: "timeout",
        },
      ],
    ]);

    readiness.resolve();
    database.reject(new Error("late secret"));
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledTimes(3);
  });

  it("supports bounded best-effort cleanup when boot created only some resources", async () => {
    const logger = fakeLogger();
    const bossStop = vi.fn(async () => undefined);
    const databaseEnd = vi.fn(async () => undefined);
    const shutdown = createWorkerShutdownCoordinator(
      { boss: { stop: bossStop }, database: { end: databaseEnd } },
      logger,
      { stageTimeoutMs: 25 },
    );

    await expect(shutdown.stop()).resolves.toEqual({ ok: true, failures: [] });
    expect(bossStop).toHaveBeenCalledTimes(1);
    expect(databaseEnd).toHaveBeenCalledTimes(1);
  });

  it("remains total when a stage throws synchronously and both logger sinks fail", async () => {
    const logger = {
      info: vi.fn(() => {
        throw new Error("broken sink");
      }),
      error: vi.fn(() => {
        throw new Error("broken sink");
      }),
    };
    const databaseEnd = vi.fn(async () => undefined);
    const shutdown = createWorkerShutdownCoordinator(
      {
        readiness: {
          release() {
            throw new Error("customer-secret");
          },
        },
        database: { end: databaseEnd },
      },
      logger,
      { stageTimeoutMs: 25 },
    );

    await expect(shutdown.stop()).resolves.toEqual({
      ok: false,
      failures: [
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "readiness",
          reason: "failure",
        },
      ],
    });
    expect(databaseEnd).toHaveBeenCalledTimes(1);
  });

  it("falls back to the finite default when a stage timeout is invalid", async () => {
    vi.useFakeTimers();
    const shutdown = createWorkerShutdownCoordinator(
      { readiness: { release: vi.fn(() => new Promise<void>(() => {})) } },
      fakeLogger(),
      { stageTimeoutMs: 0 },
    );

    const stopped = shutdown.stop();
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void stopped.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(stopped).resolves.toMatchObject({ ok: false });
  });
});

describe("worker process signal coordination", () => {
  it("shares one in-flight shutdown across signals and uses natural exit on success", async () => {
    vi.useFakeTimers();
    const stopped = deferred<WorkerShutdownResult>();
    const stop = vi.fn(() => stopped.promise);
    const setExitCode = vi.fn<(code: number) => void>();
    const forceExit = vi.fn<(code: number) => void>();
    const logger = fakeLogger();
    const handleSignal = createWorkerSignalHandler(
      stop,
      { setExitCode, forceExit },
      logger,
      { forceTimeoutMs: 100 },
    );

    const first = handleSignal();
    const second = handleSignal();
    expect(second).toBe(first);
    expect(stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(forceExit).not.toHaveBeenCalled();

    stopped.resolve({ ok: true, failures: [] });
    await first;

    expect(setExitCode).toHaveBeenCalledWith(0);
    expect(forceExit).not.toHaveBeenCalled();
  });

  it("sets a nonzero natural exit code when any shutdown stage failed", async () => {
    const stop = vi.fn(async (): Promise<WorkerShutdownResult> => ({
      ok: false,
      failures: [
        {
          code: "WORKER_SHUTDOWN_STAGE_FAILED",
          type: "dependency",
          stage: "boss",
          reason: "failure",
        },
      ],
    }));
    const setExitCode = vi.fn<(code: number) => void>();
    const forceExit = vi.fn<(code: number) => void>();
    const handleSignal = createWorkerSignalHandler(
      stop,
      { setExitCode, forceExit },
      fakeLogger(),
      { forceTimeoutMs: 100 },
    );

    await handleSignal();

    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(forceExit).not.toHaveBeenCalled();
  });

  it("uses explicit nonzero exit only after the force deadline, never for a second signal", async () => {
    vi.useFakeTimers();
    const stopped = deferred<WorkerShutdownResult>();
    const stop = vi.fn(() => stopped.promise);
    const setExitCode = vi.fn<(code: number) => void>();
    const forceExit = vi.fn<(code: number) => void>();
    const logger = fakeLogger();
    const handleSignal = createWorkerSignalHandler(
      stop,
      { setExitCode, forceExit },
      logger,
      { forceTimeoutMs: 100 },
    );

    const first = handleSignal();
    const second = handleSignal();
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(99);
    expect(forceExit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(1);
    expect(setExitCode).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("worker_shutdown_force_exit", {
      code: "WORKER_SHUTDOWN_FORCE_TIMEOUT",
      type: "internal",
    });

    stopped.resolve({ ok: true, failures: [] });
    await first;
  });

  it("re-arms the full force deadline when another signal arrives after graceful stop completed", async () => {
    vi.useFakeTimers();
    const stop = vi.fn(async (): Promise<WorkerShutdownResult> => ({
      ok: true,
      failures: [],
    }));
    const setExitCode = vi.fn<(code: number) => void>();
    const forceExit = vi.fn<(code: number) => void>();
    const handleSignal = createWorkerSignalHandler(
      stop,
      { setExitCode, forceExit },
      fakeLogger(),
      { forceTimeoutMs: 100 },
    );

    await handleSignal();
    expect(setExitCode).toHaveBeenCalledWith(0);
    expect(forceExit).not.toHaveBeenCalled();

    const afterCompletion = handleSignal();
    await vi.advanceTimersByTimeAsync(99);
    expect(forceExit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await afterCompletion;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it("converts an unexpected stop rejection to fixed metadata and natural exit code 1", async () => {
    const hostile = new Proxy(new Error("customer-secret"), {
      getPrototypeOf() {
        throw new Error("must not inspect");
      },
      get() {
        throw new Error("must not read");
      },
    });
    const setExitCode = vi.fn<(code: number) => void>();
    const forceExit = vi.fn<(code: number) => void>();
    const logger = fakeLogger();
    const handleSignal = createWorkerSignalHandler(
      vi.fn(() => Promise.reject(hostile)),
      { setExitCode, forceExit },
      logger,
      { forceTimeoutMs: 100 },
    );

    await expect(handleSignal()).resolves.toBeUndefined();

    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(forceExit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("worker_shutdown_failed", {
      code: "WORKER_SHUTDOWN_FAILED",
      type: "internal",
    });
  });

  it("keeps timer and completion callbacks total when process-control methods throw", async () => {
    vi.useFakeTimers();
    const stopped = deferred<WorkerShutdownResult>();
    const handleSignal = createWorkerSignalHandler(
      () => stopped.promise,
      {
        setExitCode() {
          throw new Error("broken process boundary");
        },
        forceExit() {
          throw new Error("broken process boundary");
        },
      },
      fakeLogger(),
      { forceTimeoutMs: 10 },
    );

    const handling = handleSignal();
    await vi.advanceTimersByTimeAsync(10);
    stopped.resolve({ ok: false, failures: [] });
    await expect(handling).resolves.toBeUndefined();
  });
});
