import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  runPublicationJob,
  type PublicationWorkerRunner,
} from "../publication/worker.ts";
import type { PublicationJobPayload } from "../publication/run-publication.ts";
import { prepareRunDelivery } from "./recovery.ts";

/** Register the side-effect-fenced publication queue worker. */
export async function registerPublicationHandler(
  ctx: WorkerContext,
  runner: PublicationWorkerRunner = runPublicationJob,
): Promise<void> {
  await ctx.boss.work(
    "publication",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<PublicationJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload, runCtx) =>
          runner(runCtx, payload),
        );
      }
    },
  );
  ctx.logger.info("publication_handler_registered", {});
}
