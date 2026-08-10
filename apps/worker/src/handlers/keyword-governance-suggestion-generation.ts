import { AsyncRunsRepository, type JobWithMetadata } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { dispatchKeywordGovernanceScheduleRequestBySource } from "../keyword-governance-suggestions/trigger-dispatcher.ts";
import {
  runKeywordGovernanceSuggestionGeneration,
  type KeywordGovernanceSuggestionGenerationJobPayload,
} from "../keyword-governance-suggestions/run-keyword-governance-suggestion-generation.ts";
import { prepareRunDelivery } from "./recovery.ts";

async function dispatchContinuation(
  ctx: WorkerContext,
  payload: KeywordGovernanceSuggestionGenerationJobPayload,
): Promise<void> {
  try {
    await dispatchKeywordGovernanceScheduleRequestBySource(ctx, {
      scope: {
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
      },
      sourceKind: "generation_continuation",
      sourceRef: payload.runId,
    });
  } catch {
    try {
      ctx.logger.warn("keyword_governance_schedule_dispatch_failed", {
        code: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
        source: "generation_continuation",
      });
    } catch {
      // The DB-triggered request remains durable for maintenance recovery.
    }
  }
}

/** Register the independent Keyword-governance suggestion queue. */
export async function registerKeywordGovernanceSuggestionGenerationHandler(
  ctx: WorkerContext,
): Promise<void> {
  await ctx.boss.work(
    "keyword-governance-suggestion.generate",
    { includeMetadata: true },
    async (
      jobs: JobWithMetadata<KeywordGovernanceSuggestionGenerationJobPayload>[],
    ) => {
      for (const job of jobs) {
        const payload = {
          runId: job.data.runId,
          workspaceId: job.data.workspaceId,
          projectId: job.data.projectId,
        };
        let runnerInvoked = false;
        let shouldDispatchContinuation = false;
        await prepareRunDelivery(ctx, job, async (payload, runCtx) => {
          runnerInvoked = true;
          const canonicalPayload = {
            runId: payload.runId,
            workspaceId: payload.workspaceId,
            projectId: payload.projectId,
          };
          const outcome = await runKeywordGovernanceSuggestionGeneration(
            runCtx,
            canonicalPayload,
          );
          shouldDispatchContinuation = outcome.requestNextBatch;
        });
        if (!runnerInvoked) {
          const observed = await new AsyncRunsRepository(ctx.db).findById(
            {
              workspaceId: payload.workspaceId,
              projectId: payload.projectId,
            },
            payload.runId,
          );
          if (
            observed === null ||
            (observed.status !== "completed" && observed.status !== "cancelled") ||
            observed.id !== payload.runId ||
            observed.workspace_id !== payload.workspaceId ||
            observed.project_id !== payload.projectId ||
            observed.kind !== "keyword_governance_suggestion_generation" ||
            observed.result_type !==
              "keyword_governance_suggestion_generation_run" ||
            observed.result_id !== payload.runId
          ) {
            continue;
          }
          shouldDispatchContinuation = true;
        }
        if (shouldDispatchContinuation) {
          await dispatchContinuation(ctx, payload);
        }
      }
    },
  );
  ctx.logger.info(
    "keyword_governance_suggestion_generation_handler_registered",
    {},
  );
}
