import { pathToFileURL } from "node:url";
import {
  createDbHandle,
  createBoss,
  acquireWorkerReadinessLease,
  startBoss,
  type DbHandle,
  type PgBoss,
  type SlowQueryEvent,
  type WorkerReadinessFailure,
  type WorkerReadinessLease,
} from "@sf/db";
import { resolveBuildMetadata } from "@sf/contracts";
import { createLogger, type Logger } from "@sf/observability";
import { getWorkerEnv } from "./env.ts";
import { buildWorkerContext } from "./context.ts";
import { registerCollectHandlers } from "./handlers/collect.ts";
import { registerDiagnoseHandler } from "./handlers/diagnose.ts";
import { registerProfileSynthesizeHandler } from "./handlers/profile-synthesize.ts";
import { registerTopicModelGenerationHandler } from "./handlers/topic-model-generation.ts";
import {
  registerKeywordGovernanceSuggestionGenerationHandler,
} from "./handlers/keyword-governance-suggestion-generation.ts";
import { registerArtifactHandlers } from "./handlers/artifact.ts";
import { registerContentShadowHandler } from "./handlers/content-shadow.ts";
import { registerPublicationHandler } from "./handlers/publication.ts";
import { registerMeasurementHandler } from "./handlers/measurement.ts";
import { registerAnalysisRefreshHandler } from "./handlers/analysis-refresh.ts";
import {
  getWorkerMaintenanceFromStartError,
  startWorkerMaintenance,
  type WorkerMaintenance,
} from "./maintenance.ts";
import {
  startWorkerHealthSnapshotLoop,
  type WorkerHealthSnapshotLoop,
} from "./health-snapshot.ts";
import {
  createWorkerShutdownCoordinator,
  createWorkerSignalHandler,
  type WorkerShutdownCoordinator,
  type WorkerShutdownResources,
  type WorkerShutdownResult,
} from "./shutdown-coordinator.ts";
import {
  runtimeFailureMetadata,
  serializeWorkerBootFailure,
} from "./runtime-failure.ts";

/**
 * Worker bootstrap (spec §3.1, §13). Readiness is acquired last: pg-boss must be
 * started, all fifteen queue handlers registered, and blocking startup recovery
 * completed before the process owns the advisory readiness lease.
 */

interface WorkerRuntime {
  readonly db: DbHandle;
  readonly boss: PgBoss;
  /** Idempotent: every caller receives the same shutdown Promise. */
  stop(): Promise<WorkerShutdownResult>;
}

export const WORKER_DB_SLOW_QUERY_THRESHOLD_MS = 1_000;

interface WorkerStartOptions {
  readonly installSignalHandlers?: boolean;
  readonly shutdownStageTimeoutMs?: number;
  readonly forceShutdownTimeoutMs?: number;
}

type WorkerLogger = Pick<Logger, "info" | "error">;

function safeInfo(
  logger: WorkerLogger,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    logger.info(event, fields);
  } catch {
    // A broken log sink is not a reason to skip lifecycle work.
  }
}

function safeError(
  logger: WorkerLogger,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    logger.error(event, fields);
  } catch {
    // Error callbacks must remain total; their raw input is never inspected.
  }
}

function shutdownOptions(options: WorkerStartOptions): {
  readonly stageTimeoutMs?: number;
} {
  return options.shutdownStageTimeoutMs === undefined
    ? {}
    : { stageTimeoutMs: options.shutdownStageTimeoutMs };
}

function shutdownResources(input: {
  readonly db?: DbHandle;
  readonly boss?: PgBoss;
  readonly maintenance?: WorkerMaintenance;
  readonly health?: WorkerHealthSnapshotLoop;
  readonly readiness?: WorkerReadinessLease;
}): WorkerShutdownResources {
  return {
    ...(input.readiness ? { readiness: input.readiness } : {}),
    ...(input.health ? { health: input.health } : {}),
    ...(input.maintenance ? { maintenance: input.maintenance } : {}),
    ...(input.boss ? { boss: input.boss } : {}),
    ...(input.db ? { database: input.db } : {}),
  };
}

function installProcessSignalHandlers(
  stop: WorkerRuntime["stop"],
  logger: WorkerLogger,
  forceShutdownTimeoutMs: number | undefined,
): void {
  const handleSignal = createWorkerSignalHandler(
    stop,
    {
      setExitCode(code) {
        process.exitCode = code;
      },
      forceExit(code) {
        process.exit(code);
      },
    },
    logger,
    forceShutdownTimeoutMs === undefined
      ? {}
      : { forceTimeoutMs: forceShutdownTimeoutMs },
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    // Keep both listeners installed after graceful completion. If a stray
    // handle prevents natural exit, a later signal can arm a new force deadline.
    process.on(signal, () => {
      void handleSignal();
    });
  }
}

async function start(options: WorkerStartOptions = {}): Promise<WorkerRuntime> {
  const env = getWorkerEnv();
  const logger = createLogger(
    {
      service: "worker",
      environment: process.env["NODE_ENV"] ?? "development",
    },
    env.LOG_LEVEL,
  );
  const build = resolveBuildMetadata("worker");
  safeInfo(logger, "worker_starting", { ...build });

  let db: DbHandle | undefined;
  let boss: PgBoss | undefined;
  let bossNeedsStop = false;
  let maintenance: WorkerMaintenance | undefined;
  let health: WorkerHealthSnapshotLoop | undefined;
  let readiness: WorkerReadinessLease | undefined;
  let shutdownRequested = false;
  const lifecycleController = new AbortController();
  let bootFailed = false;
  let lifecycleStopPromise: Promise<WorkerShutdownResult> | undefined;
  let publishedShutdown: WorkerShutdownCoordinator | undefined;
  let resolveShutdown!: (shutdown: WorkerShutdownCoordinator) => void;
  const shutdownReady = new Promise<WorkerShutdownCoordinator>((resolve) => {
    resolveShutdown = resolve;
  });

  const publishShutdown = (
    resources: WorkerShutdownResources,
  ): WorkerShutdownCoordinator => {
    if (publishedShutdown) return publishedShutdown;
    publishedShutdown = createWorkerShutdownCoordinator(
      resources,
      logger,
      shutdownOptions(options),
    );
    resolveShutdown(publishedShutdown);
    return publishedShutdown;
  };

  const stop = (): Promise<WorkerShutdownResult> => {
    shutdownRequested = true;
    lifecycleController.abort();
    if (!lifecycleStopPromise) {
      lifecycleStopPromise = shutdownReady.then(async (shutdown) => {
        const result = await shutdown.stop();
        // Cleanup may itself succeed after an in-flight startup operation
        // rejected. Preserve that boot failure in the signal exit decision.
        return bootFailed && result.ok
          ? { ok: false, failures: result.failures }
          : result;
      });
    }
    return lifecycleStopPromise;
  };

  const finishInterruptedBoot = (
    activeDb: DbHandle,
    activeBoss: PgBoss,
  ): Promise<WorkerRuntime> | undefined => {
    if (!shutdownRequested) return undefined;
    publishShutdown(
      shutdownResources({
        db: activeDb,
        ...(bossNeedsStop ? { boss: activeBoss } : {}),
        ...(maintenance ? { maintenance } : {}),
        ...(health ? { health } : {}),
        ...(readiness ? { readiness } : {}),
      }),
    );
    const runtime: WorkerRuntime = {
      db: activeDb,
      boss: activeBoss,
      stop,
    };
    return stop().then(() => runtime);
  };

  // Install signal handling before creating any resource. A signal received
  // during an awaited startup stage waits for that stage to settle, then shares
  // the same bounded cleanup coordinator as boot errors and the final runtime.
  if (options.installSignalHandlers !== false) {
    installProcessSignalHandlers(
      stop,
      logger,
      options.forceShutdownTimeoutMs,
    );
  }

  try {
    db = createDbHandle(env.DATABASE_URL, env.DB_POOL_MAX, {
      slowQueryThresholdMs: WORKER_DB_SLOW_QUERY_THRESHOLD_MS,
      onSlowQuery(event: SlowQueryEvent) {
        let durationMs: number;
        try {
          if (!Number.isFinite(event.durationMs) || event.durationMs < 0) {
            return;
          }
          durationMs = event.durationMs;
        } catch {
          return;
        }
        safeInfo(logger, "db_slow_query", {
          durationMs,
          thresholdMs: WORKER_DB_SLOW_QUERY_THRESHOLD_MS,
        });
      },
    });
    boss = createBoss(env.DATABASE_URL, { max: env.DB_POOL_MAX });

    boss.on("error", (error: unknown) => {
      safeError(
        logger,
        "pgboss_error",
        runtimeFailureMetadata("PGBOSS_RUNTIME_ERROR", error),
      );
    });

    // Treat startBoss as potentially partially successful. If it rejects after
    // opening its pool or creating some queues, bounded boot cleanup still owns
    // the boss instance.
    bossNeedsStop = true;
    await startBoss(boss);
    const interruptedAfterBoss = finishInterruptedBoot(db, boss);
    if (interruptedAfterBoss) return await interruptedAfterBoss;

    const workerCtx = buildWorkerContext({
      db,
      boss,
      env,
      logger,
      signal: lifecycleController.signal,
    });
    await registerCollectHandlers(workerCtx);
    const interruptedAfterCollect = finishInterruptedBoot(db, boss);
    if (interruptedAfterCollect) return await interruptedAfterCollect;
    await registerDiagnoseHandler(workerCtx);
    const interruptedAfterDiagnose = finishInterruptedBoot(db, boss);
    if (interruptedAfterDiagnose) return await interruptedAfterDiagnose;
    await registerProfileSynthesizeHandler(workerCtx);
    const interruptedAfterProfile = finishInterruptedBoot(db, boss);
    if (interruptedAfterProfile) return await interruptedAfterProfile;
    await registerTopicModelGenerationHandler(workerCtx);
    const interruptedAfterTopicModel = finishInterruptedBoot(db, boss);
    if (interruptedAfterTopicModel) return await interruptedAfterTopicModel;
    await registerKeywordGovernanceSuggestionGenerationHandler(workerCtx);
    const interruptedAfterKeywordSuggestions = finishInterruptedBoot(db, boss);
    if (interruptedAfterKeywordSuggestions) {
      return await interruptedAfterKeywordSuggestions;
    }
    await registerArtifactHandlers(workerCtx);
    const interruptedAfterArtifacts = finishInterruptedBoot(db, boss);
    if (interruptedAfterArtifacts) return await interruptedAfterArtifacts;
    await registerContentShadowHandler(workerCtx);
    const interruptedAfterContentShadow = finishInterruptedBoot(db, boss);
    if (interruptedAfterContentShadow) {
      return await interruptedAfterContentShadow;
    }
    await registerPublicationHandler(workerCtx);
    const interruptedAfterPublication = finishInterruptedBoot(db, boss);
    if (interruptedAfterPublication) return await interruptedAfterPublication;
    await registerMeasurementHandler(workerCtx);
    const interruptedAfterMeasurement = finishInterruptedBoot(db, boss);
    if (interruptedAfterMeasurement) return await interruptedAfterMeasurement;
    await registerAnalysisRefreshHandler(workerCtx);
    const interruptedAfterHandlers = finishInterruptedBoot(db, boss);
    if (interruptedAfterHandlers) return await interruptedAfterHandlers;

    // Startup recovery is blocking inside startWorkerMaintenance. The two
    // background capacity loops are not a readiness condition.
    maintenance = await startWorkerMaintenance(workerCtx, {
      signal: lifecycleController.signal,
    });
    const interruptedAfterMaintenance = finishInterruptedBoot(db, boss);
    if (interruptedAfterMaintenance) {
      return await interruptedAfterMaintenance;
    }

    // Acquire readiness last. The event-loop heartbeat and PostgreSQL session
    // TTL make a frozen process become not-ready without adding a 29th table.
    readiness = await acquireWorkerReadinessLease(db.pool, {
      onLeaseFailure(failure: WorkerReadinessFailure) {
        safeError(logger, "worker_readiness_lease_failed", failure);
      },
    });
    const interruptedAfterReadiness = finishInterruptedBoot(db, boss);
    if (interruptedAfterReadiness) return await interruptedAfterReadiness;

    // The first aggregate query is fire-and-forget: operations telemetry must
    // never delay readiness publication. Its loop is an independently bounded
    // shutdown stage so a stuck query cannot skip maintenance, boss, or DB end.
    health = startWorkerHealthSnapshotLoop({ db, readiness, logger });

    publishShutdown(
      shutdownResources({ db, boss, maintenance, readiness, health }),
    );
    const runtime: WorkerRuntime = {
      db,
      boss,
      stop,
    };

    safeInfo(logger, "worker_ready", { ...build });
    return runtime;
  } catch (error) {
    bootFailed = true;
    // Handler registration enables delivery before readiness is published. If
    // a later boot stage fails, cancel any collection already using this same
    // lifecycle signal before bounded resource cleanup begins.
    lifecycleController.abort();
    maintenance ??= getWorkerMaintenanceFromStartError(error);
    const cleanup = publishShutdown(
      shutdownResources({
        ...(db ? { db } : {}),
        ...(boss && bossNeedsStop ? { boss } : {}),
        ...(maintenance ? { maintenance } : {}),
        ...(health ? { health } : {}),
        ...(readiness ? { readiness } : {}),
      }),
    );
    const cleanupResult = await cleanup.stop();
    if (!cleanupResult.ok) {
      safeError(logger, "worker_boot_cleanup_incomplete", {
        code: "WORKER_BOOT_CLEANUP_FAILED",
        type: "internal",
        failedStages: cleanupResult.failures.map((failure) => failure.stage),
      });
    }
    throw error;
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void start().catch((error: unknown) => {
    // Boot failures use natural nonzero exit. Explicit process.exit is reserved
    // for the signal force deadline in createWorkerSignalHandler.
    try {
      process.stderr.write(`${serializeWorkerBootFailure(error)}\n`);
    } catch {
      // A broken stderr must not change the already-decided failure status.
    }
    process.exitCode = 1;
  });
}

export { start };
export type { WorkerRuntime, WorkerStartOptions };
