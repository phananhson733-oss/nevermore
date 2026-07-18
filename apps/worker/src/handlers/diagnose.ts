import type { Job } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { runDiagnostic, type DiagnoseJobPayload } from "../diagnostic/run-diagnostic.ts";

/** Register the `diagnose` queue worker (spec §13.1). */
export async function registerDiagnoseHandler(ctx: WorkerContext): Promise<void> {
  await ctx.boss.work("diagnose", async (jobs: Job<DiagnoseJobPayload>[]) => {
    for (const job of jobs) {
      await runDiagnostic(ctx, job.data);
    }
  });
  ctx.logger.info("diagnose_handler_registered", {});
}
