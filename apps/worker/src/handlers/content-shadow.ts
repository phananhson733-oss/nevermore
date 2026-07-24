import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  runContentShadow,
  type ContentShadowJobPayload,
} from "../content-shadow/run-content-shadow.ts";
import { prepareRunDelivery } from "./recovery.ts";

/** Register the `content-shadow` queue worker (spec §13.1, Slice 2 Task 4). */
export async function registerContentShadowHandler(
  ctx: WorkerContext,
): Promise<void> {
  await ctx.boss.work(
    "content-shadow",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<ContentShadowJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload, runCtx) =>
          runContentShadow(runCtx, payload),
        );
      }
    },
  );
  ctx.logger.info("content_shadow_handler_registered", {});
}
