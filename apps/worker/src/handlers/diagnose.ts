import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { runDiagnostic, type DiagnoseJobPayload } from "../diagnostic/run-diagnostic.ts";
import { notifyAnalysisRefreshParent } from "../analysis-refresh/notify-parent.ts";
import { prepareRunDelivery } from "./recovery.ts";

/** Register the `diagnose` queue worker (spec §13.1). */
export async function registerDiagnoseHandler(ctx: WorkerContext): Promise<void> {
  await ctx.boss.work(
    "diagnose",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<DiagnoseJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload, runCtx) =>
          runDiagnostic(runCtx, payload),
        );
        // After the delivery settles, hand an owning Analysis Refresh parent
        // its continuation immediately (poll tick is the fallback).
        await notifyAnalysisRefreshParent(ctx, job.data);
      }
    },
  );
  ctx.logger.info("diagnose_handler_registered", {});
}
