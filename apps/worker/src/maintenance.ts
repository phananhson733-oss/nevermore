import type { WorkerContext } from "./context.ts";
import {
  startRunRecoveryLoop,
  type RunRecoveryLoop,
} from "./handlers/recovery.ts";
import {
  startOrphanCleanupLoop,
  type OrphanCleanupLoop,
} from "./handlers/orphan-cleanup.ts";

export interface WorkerMaintenance {
  readonly recovery: RunRecoveryLoop;
  readonly orphanCleanup: OrphanCleanupLoop;
  stop(): Promise<void>;
}

/**
 * Recovery is a readiness condition; storage orphan cleanup is capacity
 * maintenance. Its loop starts one immediate sweep itself, but worker startup
 * deliberately does not await that potentially long paginated sweep.
 */
export async function startWorkerMaintenance(
  ctx: WorkerContext,
): Promise<WorkerMaintenance> {
  const recovery = startRunRecoveryLoop(ctx);
  await recovery.runNow();
  const orphanCleanup = startOrphanCleanupLoop(ctx);
  let stopped = false;
  return {
    recovery,
    orphanCleanup,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await orphanCleanup.stop();
      await recovery.stop();
    },
  };
}
