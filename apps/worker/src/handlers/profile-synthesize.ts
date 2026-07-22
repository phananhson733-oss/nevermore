import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  runProductProfileSynthesis,
  type ProductProfileSynthesisJobPayload,
} from "../product-profile/run-product-profile-synthesis.ts";
import { prepareRunDelivery } from "./recovery.ts";

/** Register the dedicated Product Profile synthesis queue. */
export async function registerProfileSynthesizeHandler(
  ctx: WorkerContext,
): Promise<void> {
  await ctx.boss.work(
    "profile.synthesize",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<ProductProfileSynthesisJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload, runCtx) =>
          runProductProfileSynthesis(runCtx, payload),
        );
      }
    },
  );
  ctx.logger.info("product_profile_synthesis_handler_registered", {});
}
