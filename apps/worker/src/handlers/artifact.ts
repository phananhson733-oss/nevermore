import type { Job } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { runArtifact, type ArtifactJobPayload } from "../artifact/run-artifact.ts";
import { runExport, type ExportJobPayload } from "../export/run-export.ts";

/** Register the artifact.generate + export.bundle queue workers (spec §13.1). */
export async function registerArtifactHandlers(ctx: WorkerContext): Promise<void> {
  await ctx.boss.work("artifact.generate", async (jobs: Job<ArtifactJobPayload>[]) => {
    for (const job of jobs) await runArtifact(ctx, job.data);
  });
  await ctx.boss.work("export.bundle", async (jobs: Job<ExportJobPayload>[]) => {
    for (const job of jobs) await runExport(ctx, job.data);
  });
  ctx.logger.info("artifact_export_handlers_registered", {});
}
