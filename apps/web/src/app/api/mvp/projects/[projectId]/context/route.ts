import { UpdateContextRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { getContext, updateContext } from "@/lib/services/context";

/** `GET /api/mvp/projects/{projectId}/context` — current ICP version or null. */
export const GET = operatorRoute<{ projectId: string }>(async (_request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const profile = await getContext({ workspaceId: ctx.operator.workspaceId }, id);
  return ok(profile, ctx.requestId);
});

/** `PATCH /api/mvp/projects/{projectId}/context` — append a draft/complete version. */
export const PATCH = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const body = await parseJsonBody(request, UpdateContextRequest);
  const profile = await updateContext(
    { workspaceId: ctx.operator.workspaceId },
    id,
    ctx.operator.userId,
    body,
  );
  return ok(profile, ctx.requestId);
});

export const dynamic = "force-dynamic";
