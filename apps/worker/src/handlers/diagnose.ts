import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { runDiagnostic, type DiagnoseJobPayload } from "../diagnostic/run-diagnostic.ts";
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
      }
    },
  );
  ctx.logger.info("diagnose_handler_registered", {});
}
