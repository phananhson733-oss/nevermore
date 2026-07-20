import type { JobWithMetadata, QueueName } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { runCollection, type CollectJobPayload } from "../collection/run-collection.ts";
import { prepareRunDelivery } from "./recovery.ts";

/**
 * Register the four collection queue workers (spec §13.1). Each job payload is
 * `{runId, workspaceId, projectId}` only (no credentials/raw content, §13.3); the
 * runner claims the run and drives the provider adapter → snapshot/observations.
 */

const COLLECT_QUEUES: readonly QueueName[] = [
  "collect.crawl",
  "collect.gsc",
  "collect.ga4",
  "collect.csv",
];

export async function registerCollectHandlers(ctx: WorkerContext): Promise<void> {
  for (const queue of COLLECT_QUEUES) {
    await ctx.boss.work(
      queue,
      { includeMetadata: true },
      async (jobs: JobWithMetadata<CollectJobPayload>[]) => {
        for (const job of jobs) {
          await prepareRunDelivery(ctx, job, (payload, runCtx) =>
            runCollection(runCtx, payload, {
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
            }),
          );
        }
      },
    );
  }
  ctx.logger.info("collect_handlers_registered", { queues: COLLECT_QUEUES.length });
}
