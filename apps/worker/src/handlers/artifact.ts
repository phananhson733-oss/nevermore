import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { runArtifact, type ArtifactJobPayload } from "../artifact/run-artifact.ts";
import { runExport, type ExportJobPayload } from "../export/run-export.ts";
import { prepareRunDelivery } from "./recovery.ts";

/** Register the artifact.generate + export.bundle queue workers (spec §13.1). */
export async function registerArtifactHandlers(ctx: WorkerContext): Promise<void> {
  await ctx.boss.work(
    "artifact.generate",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<ArtifactJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload) =>
          runArtifact(ctx, payload),
        );
      }
    },
  );
  await ctx.boss.work(
    "export.bundle",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<ExportJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload) => runExport(ctx, payload));
      }
    },
  );
  ctx.logger.info("artifact_export_handlers_registered", {});
}
