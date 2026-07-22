import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DbHandle,
  QueueTechnicalMetric,
  WorkerReadinessLease,
} from "@sf/db";
import { AsyncRunsRepository } from "@sf/db";
import type { Logger } from "@sf/observability";
import {
  startWorkerHealthSnapshotLoop,
  type WorkerHealthSnapshotLoopOptions,
} from "./health-snapshot.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startWorkerHealthSnapshotLoop", () => {
  it("emits fixed pool/readiness/queue metadata without identifiers or payloads", async () => {
    vi.useFakeTimers();
    const lines: Array<readonly [string, Record<string, unknown>]> = [];
    const logger = {
      info: vi.fn((event: string, fields: Record<string, unknown>) => {
        lines.push([event, fields]);
      }),
      error: vi.fn(),
    } as unknown as Logger;
    const metrics: QueueTechnicalMetric[] = [
      {
        kind: "collection",
        queuedDepth: 3,
        runningDepth: 2,
        oldestQueuedAgeMs: 4_000,
        averageRunDurationMs24h: 5_000,
        maxRunDurationMs24h: 6_000,
        retryCount24h: 7,
        failureCount24h: 8,
      },
      {
        kind: "export",
        queuedDepth: 1,
        runningDepth: 0,
        oldestQueuedAgeMs: 100,
        averageRunDurationMs24h: 200,
        maxRunDurationMs24h: 300,
        retryCount24h: 0,
        failureCount24h: 1,
        payload: "customer-payload-secret",
        runId: "customer-run-secret",
      } as QueueTechnicalMetric,
    ];
    const loadQueueMetrics = vi.fn(async () => metrics);
    const input = healthInput(logger);

    const loop = startWorkerHealthSnapshotLoop(input, {
      intervalMs: 100,
      queryTimeoutMs: 50,
      stopTimeoutMs: 25,
      loadQueueMetrics,
    });
    await loop.runNow();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      "worker_health_snapshot",
      {
        code: "WORKER_HEALTH_SNAPSHOT",
        readinessHealthy: true,
        dbPool: {
          max: 4,
          total: 4,
          idle: 1,
          active: 3,
          waiting: 2,
          saturationRatio: 0.75,
        },
        queues: [
          {
            kind: "collection",
            queuedDepth: 3,
            runningDepth: 2,
            oldestQueuedAgeMs: 4_000,
            averageRunDurationMs24h: 5_000,
            maxRunDurationMs24h: 6_000,
            retryCount24h: 7,
            failureCount24h: 8,
          },
          zeroMetric("product_profile_synthesis"),
          zeroMetric("diagnostic"),
          zeroMetric("artifact_generation"),
          {
            kind: "export",
            queuedDepth: 1,
            runningDepth: 0,
            oldestQueuedAgeMs: 100,
            averageRunDurationMs24h: 200,
            maxRunDurationMs24h: 300,
            retryCount24h: 0,
            failureCount24h: 1,
          },
        ],
      },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(
      /customer-payload-secret|customer-run-secret|connection-secret|sql/i,
    );

    await vi.advanceTimersByTimeAsync(100);
    expect(loadQueueMetrics).toHaveBeenCalledTimes(2);

    const firstStop = loop.stop();
    const secondStop = loop.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;
    await vi.advanceTimersByTimeAsync(1_000);
    await loop.runNow();
    expect(loadQueueMetrics).toHaveBeenCalledTimes(2);
  });

  it("uses the repository aggregate by default", async () => {
    const technicalMetrics = vi
      .spyOn(AsyncRunsRepository.prototype, "technicalMetrics")
      .mockResolvedValue([]);
    const loop = startWorkerHealthSnapshotLoop(healthInput(healthLogger()), {
      intervalMs: 60_000,
    });

    await loop.runNow();
    expect(technicalMetrics).toHaveBeenCalledTimes(1);
    await loop.stop();
  });

  it("turns a rejected queue query into fixed metadata and permits retry", async () => {
    vi.useFakeTimers();
    const logger = healthLogger();
    const loadQueueMetrics = vi
      .fn<NonNullable<WorkerHealthSnapshotLoopOptions["loadQueueMetrics"]>>()
      .mockRejectedValueOnce(new Error("query-customer-secret"))
      .mockResolvedValue([]);
    const loop = startWorkerHealthSnapshotLoop(healthInput(logger), {
      intervalMs: 100,
      queryTimeoutMs: 50,
      stopTimeoutMs: 25,
      loadQueueMetrics,
    });

    await loop.runNow();
    expect(logger.error).toHaveBeenCalledWith(
      "worker_health_snapshot_failed",
      { code: "WORKER_HEALTH_QUERY_FAILED", type: "dependency" },
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "query-customer-secret",
    );

    await vi.advanceTimersByTimeAsync(100);
    expect(loadQueueMetrics).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "worker_health_snapshot",
      expect.objectContaining({ code: "WORKER_HEALTH_SNAPSHOT" }),
    );
    await loop.stop();
  });

  it("does not layer another DB query over one that exceeded its deadline", async () => {
    vi.useFakeTimers();
    let settleFirst!: (metrics: QueueTechnicalMetric[]) => void;
    const firstQuery = new Promise<QueueTechnicalMetric[]>((resolve) => {
      settleFirst = resolve;
    });
    const logger = healthLogger();
    const loadQueueMetrics = vi
      .fn<NonNullable<WorkerHealthSnapshotLoopOptions["loadQueueMetrics"]>>()
      .mockReturnValueOnce(firstQuery)
      .mockResolvedValue([]);
    const loop = startWorkerHealthSnapshotLoop(healthInput(logger), {
      intervalMs: 100,
      queryTimeoutMs: 50,
      stopTimeoutMs: 25,
      loadQueueMetrics,
    });

    const firstRun = loop.runNow();
    await vi.advanceTimersByTimeAsync(50);
    await firstRun;
    expect(logger.error).toHaveBeenCalledWith(
      "worker_health_snapshot_failed",
      { code: "WORKER_HEALTH_QUERY_FAILED", type: "dependency" },
    );

    await vi.advanceTimersByTimeAsync(50);
    expect(loadQueueMetrics).toHaveBeenCalledTimes(1);

    settleFirst([]);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(loadQueueMetrics).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledTimes(1);
    await loop.stop();
  });

  it("bounds stop of an in-flight query and never accesses DB after stop", async () => {
    vi.useFakeTimers();
    const loadQueueMetrics = vi.fn(
      () => new Promise<QueueTechnicalMetric[]>(() => undefined),
    );
    const logger = healthLogger();
    const loop = startWorkerHealthSnapshotLoop(healthInput(logger), {
      intervalMs: 60_000,
      queryTimeoutMs: 60_000,
      stopTimeoutMs: 50,
      loadQueueMetrics,
    });
    await vi.waitFor(() => expect(loadQueueMetrics).toHaveBeenCalledTimes(1));

    const firstStop = loop.stop();
    const secondStop = loop.stop();
    expect(secondStop).toBe(firstStop);
    await vi.advanceTimersByTimeAsync(50);
    await expect(firstStop).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(loadQueueMetrics).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("keeps readiness, pool, and logger failures observational", async () => {
    const logger = {
      info: vi.fn(() => {
        throw new Error("broken-logger-customer-secret");
      }),
      error: vi.fn(() => {
        throw new Error("broken-logger-customer-secret");
      }),
    } as unknown as Logger;
    const input = healthInput(logger);
    Object.defineProperty(input.db.pool, "totalCount", {
      get() {
        throw new Error("pool-customer-secret");
      },
    });
    input.readiness.isHealthy = vi.fn(() => {
      throw new Error("readiness-customer-secret");
    });

    const loop = startWorkerHealthSnapshotLoop(input, {
      intervalMs: 60_000,
      loadQueueMetrics: vi.fn(async () => []),
    });

    await expect(loop.runNow()).resolves.toBeUndefined();
    await expect(loop.stop()).resolves.toBeUndefined();
  });

  it.each([
    {
      label: "synchronous query throw",
      load: () => {
        throw new Error("sync-query-customer-secret");
      },
    },
    {
      label: "malformed aggregate",
      load: async () => null as unknown as QueueTechnicalMetric[],
    },
  ])("keeps a $label and broken error logger total", async ({ load }) => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(() => {
        throw new Error("broken-logger-customer-secret");
      }),
    } as unknown as Logger;
    const loop = startWorkerHealthSnapshotLoop(healthInput(logger), {
      intervalMs: 60_000,
      loadQueueMetrics: load,
    });

    await expect(loop.runNow()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "worker_health_snapshot_failed",
      { code: "WORKER_HEALTH_QUERY_FAILED", type: "dependency" },
    );
    await loop.stop();
  });

  it("drops malformed rows and normalizes unsafe numeric metrics", async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("metric-customer-secret");
        },
      },
    );
    const logger = healthLogger();
    const loop = startWorkerHealthSnapshotLoop(healthInput(logger), {
      intervalMs: 60_000,
      loadQueueMetrics: async () =>
        [
          null,
          42,
          { kind: "not-a-run-kind", payload: "payload-customer-secret" },
          hostile,
          {
            kind: "collection",
            queuedDepth: -1,
            runningDepth: Number.NaN,
            oldestQueuedAgeMs: Number.POSITIVE_INFINITY,
            averageRunDurationMs24h: "100",
            maxRunDurationMs24h: 1.234,
            retryCount24h: 2,
            failureCount24h: 3,
          },
        ] as unknown as QueueTechnicalMetric[],
    });

    await loop.runNow();
    expect(logger.info).toHaveBeenCalledWith(
      "worker_health_snapshot",
      expect.objectContaining({
        queues: expect.arrayContaining([
          {
            kind: "collection",
            queuedDepth: 0,
            runningDepth: 0,
            oldestQueuedAgeMs: 0,
            averageRunDurationMs24h: 0,
            maxRunDurationMs24h: 1.23,
            retryCount24h: 2,
            failureCount24h: 3,
          },
        ]),
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(
      /payload-customer-secret|metric-customer-secret/,
    );
    await loop.stop();
  });

  it.each([
    { option: "intervalMs" as const, message: /interval must be/ },
    { option: "queryTimeoutMs" as const, message: /query timeout must be/ },
    { option: "stopTimeoutMs" as const, message: /stop timeout must be/ },
  ])(
    "rejects an invalid $option before starting a query",
    ({ option, message }) => {
      const loadQueueMetrics = vi.fn(async () => []);
      expect(() =>
        startWorkerHealthSnapshotLoop(healthInput(healthLogger()), {
          intervalMs: 60_000,
          [option]: 0,
          loadQueueMetrics,
        }),
      ).toThrow(message);
      expect(loadQueueMetrics).not.toHaveBeenCalled();
    },
  );
});

function healthInput(logger: Logger): {
  db: DbHandle;
  readiness: WorkerReadinessLease;
  logger: Logger;
} {
  return {
    db: {
      db: {} as DbHandle["db"],
      pool: {
        options: { max: 4, connectionString: "connection-secret" },
        totalCount: 4,
        idleCount: 1,
        waitingCount: 2,
      } as unknown as DbHandle["pool"],
      end: vi.fn(async () => undefined),
    },
    readiness: {
      isHealthy: vi.fn(() => true),
      release: vi.fn(async () => undefined),
    },
    logger,
  };
}

function healthLogger(): Logger & {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  return logger as unknown as Logger & typeof logger;
}

function zeroMetric(kind: QueueTechnicalMetric["kind"]): QueueTechnicalMetric {
  return {
    kind,
    queuedDepth: 0,
    runningDepth: 0,
    oldestQueuedAgeMs: 0,
    averageRunDurationMs24h: 0,
    maxRunDurationMs24h: 0,
    retryCount24h: 0,
    failureCount24h: 0,
  };
}
