import { UpdateActionRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { updateProjectAction } from "@/lib/services/actions-service";

/**
 * `PATCH /api/mvp/projects/{projectId}/actions/{actionId}` — status/priority/lane
 * override (spec §9.3). A reason is required; `baseRevision` guards concurrency;
 * old/new values are audited.
 */
export const PATCH = operatorRoute<{ projectId: string; actionId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, actionId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const aid = parseUuidParam(actionId);
    const body = await parseJsonBody(request, UpdateActionRequest);

    const action = await updateProjectAction(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      aid,
      ctx.operator.userId,
      body,
    );
    return ok(action, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
