import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";

const TERMINAL_CHILD_STATUSES = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

/**
 * Hand an Analysis Refresh parent its continuation the moment one of its child
 * runs settles, instead of leaving the handoff to the parent's poll tick.
 *
 * Called by the collection and diagnose queue handlers after each delivery
 * settles, outside any transaction. Best-effort by design: the parent's poll
 * tick (ANALYSIS_REFRESH_CONTINUATION_DELAY_MS) and run recovery both cover a
 * lost notification, so a failure here must never affect the child's own
 * settled outcome. A duplicate continuation is harmless — the parent claim is
 * single-winner and a losing delivery acks as not-queued.
 */
export async function notifyAnalysisRefreshParent(
  ctx: WorkerContext,
  child: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  },
): Promise<void> {
  try {
    const scope = {
      workspaceId: child.workspaceId,
      projectId: child.projectId,
    };
    const runs = new AsyncRunsRepository(ctx.db);
    const childRun = await runs.findById(scope, child.runId);
    // Only a settled child hands off; a retrying child keeps its active claim.
    if (!childRun || !TERMINAL_CHILD_STATUSES.has(childRun.status)) return;
    if (
      childRun.workspace_id !== child.workspaceId ||
      childRun.project_id !== child.projectId ||
      (childRun.kind === "topic_model_generation" &&
        (childRun.result_type !== "topic_model_generation_run" ||
          childRun.result_id !== childRun.id))
    ) {
      return;
    }
    const parentRunId = await new AnalysisRefreshRunsRepository(
      ctx.db,
    ).findParentRunIdByChildRunId(scope, child.runId);
    if (!parentRunId) return;
    const parent = await runs.findById(scope, parentRunId);
    if (
      !parent ||
      parent.kind !== "analysis_refresh" ||
      parent.result_type !== "analysis_refresh_run" ||
      parent.result_id !== parent.id ||
      parent.workspace_id !== child.workspaceId ||
      parent.project_id !== child.projectId ||
      (parent.status !== "queued" && parent.status !== "running")
    ) {
      return;
    }
    await ctx.boss.send("refresh.analysis", {
      runId: parent.id,
      workspaceId: parent.workspace_id,
      projectId: parent.project_id,
      contractVersion: parent.contract_version,
    });
  } catch {
    try {
      ctx.logger.warn("analysis_refresh_parent_notify_failed", {
        code: "ANALYSIS_REFRESH_PARENT_NOTIFY_FAILED",
        childRunId: child.runId,
      });
    } catch {
      // Best-effort all the way down: the notification must never affect the
      // child delivery that already settled.
    }
  }
}
