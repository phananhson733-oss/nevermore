import {
  AsyncRunsRepository,
  getDbPoolStats,
  type DbHandle,
  type DbPoolStats,
  type QueueTechnicalMetric,
  type WorkerReadinessLease,
} from "@sf/db";
import type { Logger } from "@sf/observability";

export const WORKER_HEALTH_SNAPSHOT_INTERVAL_MS = 60_000;
export const WORKER_HEALTH_QUERY_TIMEOUT_MS = 5_000;
export const WORKER_HEALTH_STOP_TIMEOUT_MS = 5_000;

const RUN_KINDS = [
  "analysis_refresh",
  "collection",
  "product_profile_synthesis",
  "topic_model_generation",
  "diagnostic",
  "artifact_generation",
  "export",
  "content_shadow",
  "publication",
  "measurement",
] as const satisfies readonly QueueTechnicalMetric["kind"][];

type HealthLogger = Pick<Logger, "info" | "error">;

export interface WorkerHealthSnapshotInput {
  readonly db: DbHandle;
  readonly readiness: WorkerReadinessLease;
  readonly logger: HealthLogger;
}

export interface WorkerHealthSnapshotLoopOptions {
  readonly intervalMs?: number;
  readonly queryTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly loadQueueMetrics?: () => Promise<QueueTechnicalMetric[]>;
}

export interface WorkerHealthSnapshotLoop {
  runNow(): Promise<void>;
  /** Idempotent: every caller receives the exact same Promise. */
  stop(): Promise<void>;
}

type QueryObservation<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "failed" }
  | { readonly status: "aborted" };

interface ObservedQuery<T> {
  readonly result: Promise<QueryObservation<T>>;
  /** Settles only when the underlying driver Promise settles. */
  readonly settlement: Promise<void>;
}

/**
 * Periodically emit a metadata-only operational snapshot. The DB aggregate has
 * its own deadline and never blocks bootstrap readiness. A stop cancels the
 * current observation, clears future scheduling, and waits only for a fixed
 * bound; the underlying query remains rejection-observed if the driver settles
 * after shutdown has already continued.
 */
export function startWorkerHealthSnapshotLoop(
  input: WorkerHealthSnapshotInput,
  options: WorkerHealthSnapshotLoopOptions = {},
): WorkerHealthSnapshotLoop {
  const intervalMs = positiveSafeInteger(
    "worker health snapshot interval",
    options.intervalMs ?? WORKER_HEALTH_SNAPSHOT_INTERVAL_MS,
  );
  const queryTimeoutMs = positiveSafeInteger(
    "worker health query timeout",
    options.queryTimeoutMs ?? WORKER_HEALTH_QUERY_TIMEOUT_MS,
  );
  const stopTimeoutMs = positiveSafeInteger(
    "worker health stop timeout",
    options.stopTimeoutMs ?? WORKER_HEALTH_STOP_TIMEOUT_MS,
  );
  const repository = new AsyncRunsRepository(input.db.db);
  const loadQueueMetrics =
    options.loadQueueMetrics ?? (() => repository.technicalMetrics());
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let outstandingQuery: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let stopPromise: Promise<void> | null = null;

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight !== null) return inFlight;
    // A deadline only ends our observation; it cannot cancel an arbitrary
    // node-postgres Promise. Never stack another pool query over that survivor.
    if (outstandingQuery !== null) return Promise.resolve();

    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), queryTimeoutMs);
    timeout.unref();
    const observed = observeQuery(loadQueueMetrics, controller.signal);
    const settlement = observed.settlement.finally(() => {
      if (outstandingQuery === settlement) outstandingQuery = null;
    });
    outstandingQuery = settlement;
    const current = observed.result
      .then((result) => {
        if (result.status !== "completed") {
          if (!stopped) reportQueryFailure(input.logger);
          return;
        }

        let queues: readonly QueueTechnicalMetric[];
        try {
          queues = normalizeQueueMetrics(result.value);
        } catch {
          if (!stopped) reportQueryFailure(input.logger);
          return;
        }
        if (stopped) return;
        safeInfo(input.logger, "worker_health_snapshot", {
          code: "WORKER_HEALTH_SNAPSHOT",
          readinessHealthy: safeReadiness(input.readiness),
          dbPool: safePoolStats(input.db),
          queues,
        });
      })
      .finally(() => {
        clearTimeout(timeout);
        if (inFlight === current) inFlight = null;
        if (activeController === controller) activeController = null;
      });
    inFlight = current;
    return current;
  };

  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  timer.unref();
  void runNow();

  const stop = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise;
    stopped = true;
    clearInterval(timer);
    activeController?.abort();
    const pending = inFlight;
    stopPromise =
      pending === null
        ? Promise.resolve()
        : waitForPromise(pending, stopTimeoutMs);
    return stopPromise;
  };

  return { runNow, stop };
}

function observeQuery<T>(
  operation: () => Promise<T> | T,
  signal: AbortSignal,
): ObservedQuery<T> {
  if (signal.aborted) {
    return {
      result: Promise.resolve({ status: "aborted" }),
      settlement: Promise.resolve(),
    };
  }

  let pending: Promise<T>;
  try {
    pending = Promise.resolve(operation());
  } catch {
    return {
      result: Promise.resolve({ status: "failed" }),
      settlement: Promise.resolve(),
    };
  }
  const settlement = pending.then(
    () => undefined,
    () => undefined,
  );
  const result = new Promise<QueryObservation<T>>((resolve) => {
    let settled = false;
    const finish = (result: QueryObservation<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ status: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void pending.then(
      (value) => finish({ status: "completed", value }),
      () => finish({ status: "failed" }),
    );
  });
  return { result, settlement };
}

function normalizeQueueMetrics(value: unknown): QueueTechnicalMetric[] {
  if (!Array.isArray(value)) {
    throw new TypeError("invalid worker health queue metrics");
  }
  const metrics = new Map(
    RUN_KINDS.map((kind) => [kind, zeroMetric(kind)] as const),
  );
  for (const candidate of value) {
    try {
      if (typeof candidate !== "object" || candidate === null) continue;
      const kind = candidate.kind;
      if (!isRunKind(kind)) continue;
      metrics.set(kind, {
        kind,
        queuedDepth: safeMetric(candidate.queuedDepth),
        runningDepth: safeMetric(candidate.runningDepth),
        oldestQueuedAgeMs: safeMetric(candidate.oldestQueuedAgeMs),
        averageRunDurationMs24h: safeMetric(
          candidate.averageRunDurationMs24h,
        ),
        maxRunDurationMs24h: safeMetric(candidate.maxRunDurationMs24h),
        retryCount24h: safeMetric(candidate.retryCount24h),
        failureCount24h: safeMetric(candidate.failureCount24h),
      });
    } catch {
      // A malformed row contributes no fields and can never leak raw content.
    }
  }
  return RUN_KINDS.map((kind) => metrics.get(kind)!);
}

function zeroMetric(
  kind: QueueTechnicalMetric["kind"],
): QueueTechnicalMetric {
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

function isRunKind(value: unknown): value is QueueTechnicalMetric["kind"] {
  return RUN_KINDS.some((kind) => value === kind);
}

function safeMetric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : 0;
}

function safeReadiness(readiness: WorkerReadinessLease): boolean {
  try {
    return readiness.isHealthy() === true;
  } catch {
    return false;
  }
}

function safePoolStats(db: DbHandle): DbPoolStats {
  try {
    return getDbPoolStats(db.pool);
  } catch {
    return {
      max: 0,
      total: 0,
      idle: 0,
      active: 0,
      waiting: 0,
      saturationRatio: 0,
    };
  }
}

function reportQueryFailure(logger: HealthLogger): void {
  safeError(logger, "worker_health_snapshot_failed", {
    code: "WORKER_HEALTH_QUERY_FAILED",
    type: "dependency",
  });
}

function safeInfo(
  logger: HealthLogger,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    logger.info(event, fields);
  } catch {
    // Health logging is observational and never changes worker behavior.
  }
}

function safeError(
  logger: HealthLogger,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    logger.error(event, fields);
  } catch {
    // The query error itself is deliberately never inspected or forwarded.
  }
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

async function waitForPromise(
  pending: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
