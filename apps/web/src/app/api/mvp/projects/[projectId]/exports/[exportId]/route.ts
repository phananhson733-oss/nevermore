import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectExport } from "@/lib/services/export-service";

/**
 * `GET /api/mvp/projects/{projectId}/exports/{exportId}` — export metadata + a
 * 15-minute signed download URL once completed (spec §10.5).
 */
export const GET = operatorRoute<{ projectId: string; exportId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId, exportId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const eid = parseUuidParam(exportId);
    const bundle = await getProjectExport({ workspaceId: ctx.operator.workspaceId }, pid, eid);
    return ok(bundle, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
