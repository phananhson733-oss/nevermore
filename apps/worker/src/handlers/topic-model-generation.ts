import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { notifyAnalysisRefreshParent } from "../analysis-refresh/notify-parent.ts";
import {
  runTopicModelGeneration,
  type TopicModelGenerationJobPayload,
} from "../topic-model/run-topic-model-generation.ts";
import { prepareRunDelivery } from "./recovery.ts";

/** Register the server-only Topic Model generation child queue. */
export async function registerTopicModelGenerationHandler(
  ctx: WorkerContext,
): Promise<void> {
  await ctx.boss.work(
    "topic-model.generate",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<TopicModelGenerationJobPayload>[]) => {
      for (const job of jobs) {
        try {
          await prepareRunDelivery(ctx, job, (payload, runCtx) =>
            runTopicModelGeneration(runCtx, {
              runId: payload.runId,
              workspaceId: payload.workspaceId,
              projectId: payload.projectId,
            }),
          );
        } finally {
          await notifyAnalysisRefreshParent(ctx, job.data);
        }
      }
    },
  );
  ctx.logger.info("topic_model_generation_handler_registered", {});
}
