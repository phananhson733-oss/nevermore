import { CreateContentShadowRunRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { createContentShadowRun } from "@/lib/services/content-shadow";

/**
 * `POST /api/mvp/projects/{projectId}/content-shadow-runs` — queue one pinned
 * SEO/GEO Content Shadow run (Slice 2). 202 with run + statusUrl +
 * resourceRef{type:flow_shadow_run}. The command confirms nothing: an
 * unconfirmed Finding or a missing content brief returns 422, a Finding that
 * moved past its frozen diagnosis returns 409, and an already-active shadow run
 * for the same Action returns 409.
 */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "content_shadow_run",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
    });
    const body = await parseJsonBody(request, CreateContentShadowRunRequest);

    const result = await createContentShadowRun(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return asyncAccepted(
      {
        run: result.run,
        statusUrl: result.statusUrl,
        resourceRef: result.resourceRef,
      },
      ctx.requestId,
      result.location,
    );
  },
);

export const dynamic = "force-dynamic";
