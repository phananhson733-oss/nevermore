import { NextResponse } from "next/server";
import { REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { archiveProject, getProject } from "@/lib/services/projects";

/** `GET /api/mvp/projects/{projectId}` — project aggregate; 404 when foreign/absent. */
export const GET = operatorRoute<{ projectId: string }>(async (_request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const project = await getProject({ workspaceId: ctx.operator.workspaceId }, id);
  return ok(project, ctx.requestId);
});

/**
 * `DELETE /api/mvp/projects/{projectId}` — remove the product from active
 * workspace navigation while preserving immutable history as an archive.
 */
export const DELETE = operatorRoute<{ projectId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    await archiveProject({ workspaceId: ctx.operator.workspaceId }, id);
    const response = new NextResponse(null, { status: 204 });
    response.headers.set(REQUEST_ID_HEADER, ctx.requestId);
    return response;
  },
);

export const dynamic = "force-dynamic";
