import { AsyncRunsRepository, type JobWithMetadata } from "@sf/db";
import { scheduleKeywordGovernanceSuggestions } from "@sf/db/keyword-governance-suggestion-scheduler";
import type { WorkerContext } from "../context.ts";
import {
  runKeywordGovernanceSuggestionGeneration,
  type KeywordGovernanceSuggestionGenerationJobPayload,
  type KeywordGovernanceSuggestionGenerationOutcome,
} from "../keyword-governance-suggestions/run-keyword-governance-suggestion-generation.ts";
import { prepareRunDelivery } from "./recovery.ts";

async function scheduleNextBatch(
  ctx: WorkerContext,
  payload: KeywordGovernanceSuggestionGenerationJobPayload,
  outcome: KeywordGovernanceSuggestionGenerationOutcome,
): Promise<void> {
  if (!outcome.requestNextBatch) return;
  await scheduleKeywordGovernanceSuggestions(
    { db: ctx.db, boss: ctx.boss },
    {
      scope: {
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
      },
      initiatedBy: outcome.initiatedBy,
    },
  );
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
          await scheduleNextBatch(runCtx, canonicalPayload, outcome);
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
            (observed.status !== "completed" && observed.status !== "cancelled")
          ) {
            continue;
          }
          const outcome = await runKeywordGovernanceSuggestionGeneration(
            ctx,
            payload,
          );
          await scheduleNextBatch(ctx, payload, outcome);
        }
      }
    },
  );
  ctx.logger.info(
    "keyword_governance_suggestion_generation_handler_registered",
    {},
  );
}
