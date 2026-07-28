import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  CompetitorMonitorRepository,
  contentHash,
  enqueueRunInTx,
  type DbTx,
  type PgBoss,
} from "@sf/db";
import { CONTRACT_VERSION } from "@sf/contracts";
import {
  createDataForSeoCollectionScope,
  type DataForSeoCollectionScope,
} from "@sf/sources";

import type { WorkerContext } from "../context.ts";

export const COMPETITOR_MONITOR_SCHEDULER_INTERVAL_MS =
  6 * 60 * 60 * 1_000;
export const COMPETITOR_MONITOR_SCHEDULER_BATCH_SIZE = 50;

type Enqueue = (
  boss: PgBoss,
  tx: DbTx,
  queue: "collect.dataforseo",
  payload: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly contractVersion: string;
  },
) => Promise<string>;

export interface CompetitorMonitorSchedulingSummary {
  readonly providerAvailable: boolean;
  readonly dueCount: number;
  readonly scheduledCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
}

interface SchedulingSweepOptions {
  readonly now?: Date;
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly enqueue?: Enqueue;
}

interface SchedulerLoopOptions {
  readonly intervalMs?: number;
  readonly sweep?: () => Promise<unknown>;
}

export interface CompetitorMonitorSchedulerLoop {
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

function validDate(value: Date): string {
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    throw new RangeError("competitor monitor scheduler time is invalid");
  }
  return value.toISOString();
}

function positiveInteger(
  value: number,
  label: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be between 1 and ${max}`);
  }
  return value;
}

function providerAvailable(ctx: WorkerContext): boolean {
  return (
    ctx.dataForSeo?.enabled === true &&
    typeof ctx.dataForSeo.login === "string" &&
    ctx.dataForSeo.login.length > 0 &&
    typeof ctx.dataForSeo.password === "string" &&
    ctx.dataForSeo.password.length > 0
  );
}

function collectionScope(
  plan: Awaited<
    ReturnType<CompetitorMonitorRepository["listDuePlans"]>
  >[number],
  limit: number,
): DataForSeoCollectionScope {
  const locationName = new Intl.DisplayNames(["en"], {
    type: "region",
  }).of(plan.market);
  if (!locationName) {
    throw new TypeError("competitor monitor provider location is unavailable");
  }
  return createDataForSeoCollectionScope({
    target: plan.domain,
    marketCode: plan.market,
    languageTag: plan.languageTag,
    locationName,
    limit,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Find monthly-due approved competitors and atomically reuse the existing
 * DataForSEO CollectionRun queue. No customer Keyword Library or new product
 * module is introduced by this scheduler.
 */
export async function runCompetitorMonitorSchedulingSweep(
  ctx: WorkerContext,
  options: SchedulingSweepOptions = {},
): Promise<CompetitorMonitorSchedulingSummary> {
  if (!providerAvailable(ctx)) {
    return {
      providerAvailable: false,
      dueCount: 0,
      scheduledCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }
  const now = validDate(options.now ?? new Date());
  const plans = await new CompetitorMonitorRepository(ctx.db).listDuePlans({
    now,
    limit: positiveInteger(
      options.limit ?? COMPETITOR_MONITOR_SCHEDULER_BATCH_SIZE,
      "competitor monitor scheduler batch size",
      100,
    ),
  });
  const enqueue = options.enqueue ?? enqueueRunInTx;
  let scheduledCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const plan of plans) {
    if (options.signal?.aborted || ctx.signal?.aborted) break;
    try {
      const frozenScope = collectionScope(
        plan,
        ctx.dataForSeo!.maxKeywords,
      );
      await ctx.db.transaction(async (tx) => {
        const run = await new AsyncRunsRepository(tx).insertQueued({
          workspaceId: plan.workspaceId,
          projectId: plan.projectId,
          kind: "collection",
          activeKey: `monitor:competitor:${plan.competitorId}`,
          initiatedBy: plan.actorId,
          contractVersion: CONTRACT_VERSION,
          requestPayload: {
            provider: "dataforseo",
            operation: "keyword_gap_import",
            sourceConnectionId: plan.sourceConnectionId,
            collectionScope: frozenScope,
          },
        });
        await new CollectionRunsRepository(tx).insertPlaceholder({
          runId: run.id,
          workspaceId: plan.workspaceId,
          projectId: plan.projectId,
          siteId: plan.siteId,
          sourceConnectionId: plan.sourceConnectionId,
          provider: "dataforseo",
          operation: "keyword_gap_import",
          methodVersion: "dataforseo.ranked_keywords.v1",
          parametersHash: contentHash({
            provider: "dataforseo",
            operation: "keyword_gap_import",
            siteId: plan.siteId,
            collectionScope: frozenScope,
          }),
        });
        await new CompetitorMonitorRepository(tx).insertMonitorRun({
          runId: run.id,
          plan,
        });
        await enqueue(ctx.boss, tx, "collect.dataforseo", {
          runId: run.id,
          workspaceId: plan.workspaceId,
          projectId: plan.projectId,
          contractVersion: CONTRACT_VERSION,
        });
      });
      scheduledCount += 1;
    } catch (error) {
      if (isUniqueViolation(error)) {
        skippedCount += 1;
        continue;
      }
      failedCount += 1;
      ctx.logger.error("competitor_monitor_schedule_failed", {
        code: "COMPETITOR_MONITOR_SCHEDULE_FAILED",
        projectId: plan.projectId,
        competitorId: plan.competitorId,
      });
    }
  }

  const summary = {
    providerAvailable: true,
    dueCount: plans.length,
    scheduledCount,
    skippedCount,
    failedCount,
  } as const;
  ctx.logger.info("competitor_monitor_schedule_completed", summary);
  return summary;
}

/** Immediate due sweep plus a small operational polling interval. */
export function startCompetitorMonitorSchedulerLoop(
  ctx: WorkerContext,
  options: SchedulerLoopOptions = {},
): CompetitorMonitorSchedulerLoop {
  const intervalMs = positiveInteger(
    options.intervalMs ?? COMPETITOR_MONITOR_SCHEDULER_INTERVAL_MS,
    "competitor monitor scheduler interval",
  );
  const sweep =
    options.sweep ??
    (() => runCompetitorMonitorSchedulingSweep(ctx));
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight !== null) return inFlight;
    const current = (async () => {
      try {
        await sweep();
      } catch {
        ctx.logger.error("competitor_monitor_scheduler_failed", {
          code: "COMPETITOR_MONITOR_SCHEDULER_FAILED",
        });
      }
    })().finally(() => {
      if (inFlight === current) inFlight = null;
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
    stopPromise = inFlight ?? Promise.resolve();
    return stopPromise;
  };
  return { runNow, stop };
}
