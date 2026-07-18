import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { listProjectSources } from "@/lib/services/sources";

/**
 * `GET /api/mvp/projects/{projectId}/sources` — the five provider slots with
 * connection state, latest snapshot, and any active run (spec §7, §11.2).
 */
export const GET = operatorRoute<{ projectId: string }>(async (_request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const data = await listProjectSources({ workspaceId: ctx.operator.workspaceId }, id);
  return ok(data, ctx.requestId);
});

export const dynamic = "force-dynamic";
