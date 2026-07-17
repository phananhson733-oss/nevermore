import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProject } from "@/lib/services/projects";

/** `GET /api/mvp/projects/{projectId}` — project aggregate; 404 when foreign/absent. */
export const GET = operatorRoute<{ projectId: string }>(async (_request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const project = await getProject({ workspaceId: ctx.operator.workspaceId }, id);
  return ok(project, ctx.requestId);
});

export const dynamic = "force-dynamic";
