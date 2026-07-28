import {
  BeginTopicModelDraftRequest,
  PatchTopicModelDraftRequest,
} from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceAttemptRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import {
  beginProjectAuditTopicModelDraft,
  patchProjectAuditTopicModelDraft,
} from "@/lib/services/growth-map-topic-model";

const TOPIC_MODEL_MUTATION_MAX_ATTEMPTS = 30;
const TOPIC_MODEL_MUTATION_WINDOW_MS = 60 * 1_000;

function topicModelMutationPolicy(projectId: string) {
  return {
    scope: `topic-model-mutation:${projectId}`,
    maxAttempts: TOPIC_MODEL_MUTATION_MAX_ATTEMPTS,
    windowMs: TOPIC_MODEL_MUTATION_WINDOW_MS,
  } as const;
}

/** Start the sole editable draft from the exact confirmed revision. */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const body = await parseJsonBody(
      request,
      BeginTopicModelDraftRequest,
    );
    await assertWorkspaceAttemptRateLimit(
      ctx.operator.workspaceId,
      topicModelMutationPolicy(id),
    );
    const result = await beginProjectAuditTopicModelDraft(
      {
        workspaceId: ctx.operator.workspaceId,
        actorId: ctx.operator.userId,
      },
      id,
      body,
    );

    return ok(result, ctx.requestId);
  },
);

/** Apply a revision-checked set of customer Topic Model edit intents. */
export const PATCH = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const body = await parseJsonBody(
      request,
      PatchTopicModelDraftRequest,
    );
    await assertWorkspaceAttemptRateLimit(
      ctx.operator.workspaceId,
      topicModelMutationPolicy(id),
    );
    const result = await patchProjectAuditTopicModelDraft(
      {
        workspaceId: ctx.operator.workspaceId,
        actorId: ctx.operator.userId,
      },
      id,
      body,
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
