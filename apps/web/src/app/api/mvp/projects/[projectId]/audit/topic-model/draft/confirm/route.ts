import { ConfirmTopicModelRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceAttemptRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { confirmProjectAuditTopicModelDraft } from "@/lib/services/growth-map-topic-model";

const TOPIC_MODEL_MUTATION_MAX_ATTEMPTS = 30;
const TOPIC_MODEL_MUTATION_WINDOW_MS = 60 * 1_000;

/** Confirm the exact draft edit revision as the next immutable Topic Model. */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const body = await parseJsonBody(
      request,
      ConfirmTopicModelRequest,
    );
    await assertWorkspaceAttemptRateLimit(ctx.operator.workspaceId, {
      scope: `topic-model-mutation:${id}`,
      maxAttempts: TOPIC_MODEL_MUTATION_MAX_ATTEMPTS,
      windowMs: TOPIC_MODEL_MUTATION_WINDOW_MS,
    });
    const result = await confirmProjectAuditTopicModelDraft(
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
