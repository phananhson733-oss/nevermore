import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  runAnalysisRefresh,
  type AnalysisRefreshJobPayload,
} from "../analysis-refresh/run-analysis-refresh.ts";
import { prepareRunDelivery } from "./recovery.ts";

export interface AnalysisRefreshWorkerRunner {
  (ctx: WorkerContext, payload: AnalysisRefreshJobPayload): Promise<void>;
}

/** Register the durable Analysis Refresh parent orchestrator. */
export async function registerAnalysisRefreshHandler(
  ctx: WorkerContext,
  runner: AnalysisRefreshWorkerRunner = runAnalysisRefresh,
): Promise<void> {
  await ctx.boss.work(
    "refresh.analysis",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<AnalysisRefreshJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload, runCtx) =>
          runner(runCtx, payload),
        );
      }
    },
  );
  ctx.logger.info("analysis_refresh_handler_registered", {});
}
