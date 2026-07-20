import type { Logger } from "@sf/observability";

export const WORKER_SHUTDOWN_STAGE_TIMEOUT_MS = 10_000;
export const WORKER_FORCE_SHUTDOWN_TIMEOUT_MS = 45_000;

export type WorkerShutdownStage =
  | "readiness"
  | "health"
  | "maintenance"
  | "boss"
  | "database";

export type WorkerShutdownFailure = Readonly<{
  code: "WORKER_SHUTDOWN_STAGE_FAILED";
  type: "dependency";
  stage: WorkerShutdownStage;
  reason: "timeout" | "failure";
}>;

export type WorkerShutdownResult = Readonly<{
  ok: boolean;
  failures: readonly WorkerShutdownFailure[];
}>;

interface ReadinessResource {
  release(): Promise<void>;
}

interface MaintenanceResource {
  stop(): Promise<void>;
}

interface HealthResource {
  stop(): Promise<void>;
}

interface BossResource {
  stop(options?: { readonly graceful?: boolean }): Promise<void>;
}

interface DatabaseResource {
  end(): Promise<void>;
}

export interface WorkerShutdownResources {
  readonly readiness?: ReadinessResource;
  readonly health?: HealthResource;
  readonly maintenance?: MaintenanceResource;
  readonly boss?: BossResource;
  readonly database?: DatabaseResource;
}

export interface WorkerShutdownOptions {
  readonly stageTimeoutMs?: number;
}

export interface WorkerShutdownCoordinator {
  /** Idempotent: all callers receive the exact same Promise object. */
  stop(): Promise<WorkerShutdownResult>;
}

export interface WorkerProcessControl {
  /** Natural-exit path: assigns `process.exitCode`. */
  setExitCode(code: number): void;
  /** Force-deadline path only: calls explicit `process.exit(code)`. */
  forceExit(code: number): void;
}

export interface WorkerSignalOptions {
  readonly forceTimeoutMs?: number;
}

type ShutdownLogger = Pick<Logger, "info" | "error">;

type StageOutcome = "success" | "timeout" | "failure";

function validTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeInfo(
  logger: ShutdownLogger,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    logger.info(event, fields);
  } catch {
    // Logging must never prevent cleanup or alter the process exit decision.
  }
}

function safeError(
  logger: ShutdownLogger,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    logger.error(event, fields);
  } catch {
    // The dependency error itself is deliberately never inspected or forwarded.
  }
}

/**
 * Observe both timely and late settlements. A timeout resolves the stage while
 * the original Promise remains handled, so continuing cleanup cannot create a
 * later unhandled rejection.
 */
function runStageWithin(
  operation: () => Promise<void>,
  timeoutMs: number,
): Promise<StageOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("timeout");
    }, timeoutMs);

    Promise.resolve()
      .then(operation)
      .then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve("success");
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve("failure");
        },
      );
  });
}

function shutdownStages(
  resources: WorkerShutdownResources,
): ReadonlyArray<
  readonly [stage: WorkerShutdownStage, operation: () => Promise<void>]
> {
  const stages: Array<
    readonly [stage: WorkerShutdownStage, operation: () => Promise<void>]
  > = [];
  if (resources.readiness) {
    stages.push(["readiness", () => resources.readiness!.release()]);
  }
  if (resources.health) {
    stages.push(["health", () => resources.health!.stop()]);
  }
  if (resources.maintenance) {
    stages.push(["maintenance", () => resources.maintenance!.stop()]);
  }
  if (resources.boss) {
    stages.push(["boss", () => resources.boss!.stop({ graceful: true })]);
  }
  if (resources.database) {
    stages.push(["database", () => resources.database!.end()]);
  }
  return stages;
}

/**
 * Stop all resources in a deterministic order. Readiness is released first so
 * no new traffic is admitted while handlers and database pools drain. Every
 * stage has its own finite deadline, and one failure never skips later cleanup.
 */
export function createWorkerShutdownCoordinator(
  resources: WorkerShutdownResources,
  logger: ShutdownLogger,
  options: WorkerShutdownOptions = {},
): WorkerShutdownCoordinator {
  const stageTimeoutMs = validTimeout(
    options.stageTimeoutMs ?? WORKER_SHUTDOWN_STAGE_TIMEOUT_MS,
  )
    ? (options.stageTimeoutMs ?? WORKER_SHUTDOWN_STAGE_TIMEOUT_MS)
    : WORKER_SHUTDOWN_STAGE_TIMEOUT_MS;
  let stopPromise: Promise<WorkerShutdownResult> | undefined;

  const run = async (): Promise<WorkerShutdownResult> => {
    safeInfo(logger, "worker_stopping", {});
    const failures: WorkerShutdownFailure[] = [];
    for (const [stage, operation] of shutdownStages(resources)) {
      const outcome = await runStageWithin(operation, stageTimeoutMs);
      if (outcome === "success") continue;
      const failure: WorkerShutdownFailure = {
        code: "WORKER_SHUTDOWN_STAGE_FAILED",
        type: "dependency",
        stage,
        reason: outcome,
      };
      failures.push(failure);
      safeError(logger, "worker_shutdown_stage_failed", failure);
    }
    const result: WorkerShutdownResult = {
      ok: failures.length === 0,
      failures,
    };
    safeInfo(logger, "worker_stopped", {
      ok: result.ok,
      failedStages: failures.map((failure) => failure.stage),
    });
    return result;
  };

  return {
    stop(): Promise<WorkerShutdownResult> {
      if (!stopPromise) stopPromise = run();
      return stopPromise;
    },
  };
}

type StopOutcome =
  | Readonly<{ ok: true; value: WorkerShutdownResult }>
  | Readonly<{ ok: false }>;

function observeStop(
  stop: () => Promise<WorkerShutdownResult>,
): Promise<StopOutcome> {
  let stopping: Promise<WorkerShutdownResult>;
  try {
    stopping = stop();
  } catch {
    return Promise.resolve({ ok: false });
  }
  return stopping.then(
    (value) => ({ ok: true, value }),
    () => ({ ok: false }),
  );
}

/**
 * Build the one signal path shared by SIGINT and SIGTERM. Repeated signals
 * return the same in-flight Promise and never bypass graceful cleanup. If the
 * first graceful stop completed but a stray handle kept the process alive, a
 * later signal re-arms a full force deadline. Normal completion only sets
 * `process.exitCode`; explicit exit is reserved for a force deadline.
 */
export function createWorkerSignalHandler(
  stop: () => Promise<WorkerShutdownResult>,
  processControl: WorkerProcessControl,
  logger: ShutdownLogger,
  options: WorkerSignalOptions = {},
): () => Promise<void> {
  const forceTimeoutMs = validTimeout(
    options.forceTimeoutMs ?? WORKER_FORCE_SHUTDOWN_TIMEOUT_MS,
  )
    ? (options.forceTimeoutMs ?? WORKER_FORCE_SHUTDOWN_TIMEOUT_MS)
    : WORKER_FORCE_SHUTDOWN_TIMEOUT_MS;
  let signalPromise: Promise<void> | undefined;
  let signalCompleted = false;
  let postCompletionPromise: Promise<void> | undefined;

  const forceExit = (): void => {
    safeError(logger, "worker_shutdown_force_exit", {
      code: "WORKER_SHUTDOWN_FORCE_TIMEOUT",
      type: "internal",
    });
    try {
      processControl.forceExit(1);
    } catch {
      // The real process exits synchronously. A throwing injected boundary must
      // still not create an uncaught timer callback.
    }
  };

  return (): Promise<void> => {
    if (signalPromise && !signalCompleted) return signalPromise;
    if (signalCompleted) {
      if (postCompletionPromise) return postCompletionPromise;
      postCompletionPromise = new Promise((resolve) => {
        const postCompletionTimer = setTimeout(() => {
          forceExit();
          resolve();
        }, forceTimeoutMs);
        // Do not keep an otherwise clean process alive after graceful shutdown.
        // If a stray handle really remains, the event loop stays alive and this
        // deadline still fires.
        postCompletionTimer.unref();
      });
      return postCompletionPromise;
    }
    let forced = false;
    const forceTimer = setTimeout(() => {
      forced = true;
      forceExit();
    }, forceTimeoutMs);

    signalPromise = (async () => {
      try {
        const outcome = await observeStop(stop);
        if (forced) return;
        clearTimeout(forceTimer);
        if (!outcome.ok) {
          safeError(logger, "worker_shutdown_failed", {
            code: "WORKER_SHUTDOWN_FAILED",
            type: "internal",
          });
          try {
            processControl.setExitCode(1);
          } catch {
            // No alternative natural-exit mechanism is safer here.
          }
          return;
        }
        try {
          processControl.setExitCode(outcome.value.ok ? 0 : 1);
        } catch {
          // No explicit exit before the force deadline.
        }
      } finally {
        signalCompleted = true;
      }
    })();
    return signalPromise;
  };
}
