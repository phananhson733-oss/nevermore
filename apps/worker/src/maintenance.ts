import type { WorkerContext } from "./context.ts";
import {
  isRunRecoveryAbortError,
  startRunRecoveryLoop,
  type RunRecoveryLoop,
} from "./handlers/recovery.ts";
import {
  startOrphanCleanupLoop,
  type OrphanCleanupLoop,
} from "./handlers/orphan-cleanup.ts";
import {
  startRetentionCleanupLoop,
  type RetentionCleanupLoop,
} from "./handlers/retention-cleanup.ts";
import {
  startCompetitorMonitorSchedulerLoop,
  type CompetitorMonitorSchedulerLoop,
} from "./competitor-monitor/scheduler.ts";

export const WORKER_MAINTENANCE_STOP_TIMEOUT_MS = 5_000;

export interface WorkerMaintenanceOptions {
  readonly stopTimeoutMs?: number;
  /** Aborted by worker bootstrap as soon as shutdown is requested. */
  readonly signal?: AbortSignal;
}

type MaintenanceLoopName =
  | "competitor-monitor"
  | "retention"
  | "orphan"
  | "recovery";

interface MaintenanceLoopStop {
  readonly name: MaintenanceLoopName;
  readonly stop: () => Promise<void>;
}

interface MaintenanceLoopStopResult {
  readonly name: MaintenanceLoopName;
  readonly failed: boolean;
}

export class WorkerMaintenanceStopError extends Error {
  readonly code = "WORKER_MAINTENANCE_STOP_FAILED";
  readonly failedLoops: readonly MaintenanceLoopName[];

  constructor(failedLoops: readonly MaintenanceLoopName[]) {
    super("worker maintenance stop failed");
    this.name = "WorkerMaintenanceStopError";
    this.failedLoops = [...failedLoops];
  }
}

export class WorkerMaintenanceStartCleanupError extends Error {
  readonly code = "WORKER_MAINTENANCE_START_CLEANUP_FAILED";
  readonly failedLoops: readonly MaintenanceLoopName[];
  readonly maintenance: WorkerMaintenance;

  constructor(
    failedLoops: readonly MaintenanceLoopName[],
    maintenance: WorkerMaintenance,
    cause: unknown,
  ) {
    super("worker maintenance startup cleanup failed", { cause });
    this.name = "WorkerMaintenanceStartCleanupError";
    this.failedLoops = [...failedLoops];
    this.maintenance = maintenance;
  }
}

export interface WorkerMaintenance {
  readonly recovery: RunRecoveryLoop;
  readonly competitorMonitor: CompetitorMonitorSchedulerLoop;
  readonly orphanCleanup: OrphanCleanupLoop;
  readonly retentionCleanup: RetentionCleanupLoop;
  stop(): Promise<void>;
}

const SETTLED = Promise.resolve();
const STOPPED_STORAGE_LOOP = {
  runNow: (): Promise<void> => SETTLED,
  stop: (): Promise<void> => SETTLED,
};

/**
 * Recovery is a readiness condition. Storage orphan cleanup and fixed 90/30-day
 * byte retention are capacity/lifecycle maintenance; both loops start one
 * immediate sweep themselves, but startup does not await either paginated scan.
 */
export async function startWorkerMaintenance(
  ctx: WorkerContext,
  options: WorkerMaintenanceOptions = {},
): Promise<WorkerMaintenance> {
  const stopTimeoutMs = positiveSafeInteger(
    "worker maintenance stop timeout",
    options.stopTimeoutMs ?? WORKER_MAINTENANCE_STOP_TIMEOUT_MS,
  );
  const startedLoops: MaintenanceLoopStop[] = [];
  let recovery: RunRecoveryLoop | undefined;
  let competitorMonitor: CompetitorMonitorSchedulerLoop | undefined;
  let retentionCleanup: RetentionCleanupLoop | undefined;
  let orphanCleanup: OrphanCleanupLoop | undefined;

  try {
    const startedRecovery = startRunRecoveryLoop(
      ctx,
      options.signal === undefined ? {} : { signal: options.signal },
    );
    recovery = startedRecovery;
    startedLoops.push({
      name: "recovery",
      stop: () => startedRecovery.stop(),
    });
    await startedRecovery.runNow();
    if (options.signal?.aborted) {
      return createWorkerMaintenance(
        startedRecovery,
        undefined,
        undefined,
        undefined,
        stopTimeoutMs,
      );
    }

    const startedCompetitorMonitor =
      startCompetitorMonitorSchedulerLoop(ctx);
    competitorMonitor = startedCompetitorMonitor;
    startedLoops.push({
      name: "competitor-monitor",
      stop: () => startedCompetitorMonitor.stop(),
    });
    if (options.signal?.aborted) {
      return createWorkerMaintenance(
        startedRecovery,
        startedCompetitorMonitor,
        undefined,
        undefined,
        stopTimeoutMs,
      );
    }

    const startedRetentionCleanup = startRetentionCleanupLoop(ctx);
    retentionCleanup = startedRetentionCleanup;
    startedLoops.push({
      name: "retention",
      stop: () => startedRetentionCleanup.stop(),
    });
    if (options.signal?.aborted) {
      return createWorkerMaintenance(
        startedRecovery,
        startedCompetitorMonitor,
        startedRetentionCleanup,
        undefined,
        stopTimeoutMs,
      );
    }

    const startedOrphanCleanup = startOrphanCleanupLoop(ctx);
    orphanCleanup = startedOrphanCleanup;
    startedLoops.push({
      name: "orphan",
      stop: () => startedOrphanCleanup.stop(),
    });

    return createWorkerMaintenance(
      startedRecovery,
      startedCompetitorMonitor,
      startedRetentionCleanup,
      startedOrphanCleanup,
      stopTimeoutMs,
    );
  } catch (error) {
    if (
      recovery !== undefined &&
      options.signal?.aborted &&
      isRunRecoveryAbortError(error)
    ) {
      return createWorkerMaintenance(
        recovery,
        competitorMonitor,
        retentionCleanup,
        orphanCleanup,
        stopTimeoutMs,
      );
    }
    const failedLoops = await stopMaintenanceLoops(startedLoops, stopTimeoutMs);
    if (failedLoops.length > 0 && recovery !== undefined) {
      const partial = createWorkerMaintenance(
        recovery,
        competitorMonitor,
        retentionCleanup,
        orphanCleanup,
        stopTimeoutMs,
      );
      safeMaintenanceError(ctx, "worker_maintenance_start_cleanup_failed", {
        code: "WORKER_MAINTENANCE_START_CLEANUP_FAILED",
        failedLoops,
      });
      throw new WorkerMaintenanceStartCleanupError(
        failedLoops,
        partial,
        error,
      );
    }
    throw error;
  }
}

export function getWorkerMaintenanceFromStartError(
  error: unknown,
): WorkerMaintenance | undefined {
  try {
    return error instanceof WorkerMaintenanceStartCleanupError
      ? error.maintenance
      : undefined;
  } catch {
    return undefined;
  }
}

function createWorkerMaintenance(
  recovery: RunRecoveryLoop,
  competitorMonitor: CompetitorMonitorSchedulerLoop | undefined,
  retentionCleanup: RetentionCleanupLoop | undefined,
  orphanCleanup: OrphanCleanupLoop | undefined,
  stopTimeoutMs: number,
): WorkerMaintenance {
  const resolvedRetention = retentionCleanup ?? STOPPED_STORAGE_LOOP;
  const resolvedOrphan = orphanCleanup ?? STOPPED_STORAGE_LOOP;
  const resolvedCompetitorMonitor =
    competitorMonitor ?? STOPPED_STORAGE_LOOP;
  const allLoops: readonly MaintenanceLoopStop[] = [
    { name: "retention", stop: () => resolvedRetention.stop() },
    { name: "orphan", stop: () => resolvedOrphan.stop() },
    {
      name: "competitor-monitor",
      stop: () => resolvedCompetitorMonitor.stop(),
    },
    { name: "recovery", stop: () => recovery.stop() },
  ];
  let stopPromise: Promise<void> | null = null;

  const stop = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise;
    stopPromise = stopMaintenanceLoops(allLoops, stopTimeoutMs).then(
      (failedLoops) => {
        if (failedLoops.length > 0) {
          throw new WorkerMaintenanceStopError(failedLoops);
        }
      },
    );
    return stopPromise;
  };

  return {
    recovery,
    competitorMonitor: resolvedCompetitorMonitor,
    orphanCleanup: resolvedOrphan,
    retentionCleanup: resolvedRetention,
    stop,
  };
}

function safeMaintenanceError(
  ctx: WorkerContext,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    ctx.logger.error(event, fields);
  } catch {
    // Startup cleanup and its fixed error remain authoritative if logging fails.
  }
}

async function stopMaintenanceLoops(
  loops: readonly MaintenanceLoopStop[],
  timeoutMs: number,
): Promise<MaintenanceLoopName[]> {
  const outcomes = await Promise.all(
    loops.map((loop) => stopMaintenanceLoop(loop, timeoutMs)),
  );
  return outcomes
    .filter((outcome) => outcome.failed)
    .map((outcome) => outcome.name);
}

function stopMaintenanceLoop(
  loop: MaintenanceLoopStop,
  timeoutMs: number,
): Promise<MaintenanceLoopStopResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name: loop.name, failed });
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    timer.unref();

    let pending: Promise<void>;
    try {
      pending = Promise.resolve(loop.stop());
    } catch {
      finish(true);
      return;
    }
    void pending.then(
      () => finish(false),
      () => finish(true),
    );
  });
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
