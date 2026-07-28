import type { JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  runMeasurement,
  type MeasurementJobPayload,
} from "../measurement/run-measurement.ts";
import { prepareRunDelivery } from "./recovery.ts";

export interface MeasurementWorkerRunner {
  (ctx: WorkerContext, payload: MeasurementJobPayload): Promise<void>;
}

/** Register the immutable, side-effect-free measurement materialization worker. */
export async function registerMeasurementHandler(
  ctx: WorkerContext,
  runner: MeasurementWorkerRunner = runMeasurement,
): Promise<void> {
  await ctx.boss.work(
    "measurement",
    { includeMetadata: true },
    async (jobs: JobWithMetadata<MeasurementJobPayload>[]) => {
      for (const job of jobs) {
        await prepareRunDelivery(ctx, job, (payload, runCtx) =>
          runner(runCtx, payload),
        );
      }
    },
  );
  ctx.logger.info("measurement_handler_registered", {});
}
