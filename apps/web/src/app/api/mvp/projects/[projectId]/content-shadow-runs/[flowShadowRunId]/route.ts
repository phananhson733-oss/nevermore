import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getContentShadowRun } from "@/lib/services/content-shadow";

/**
 * `GET /api/mvp/projects/{projectId}/content-shadow-runs/{flowShadowRunId}` —
 * one Content Shadow run as a strictly read-only projection: frozen inputs,
 * research pack, draft revision and QA verdict. Status is projected from the
 * canonical async run and phase is derived from the append-only child rows. A
 * run in another workspace or project is reported absent (404, never 403).
 */
export const GET = operatorRoute<{
  projectId: string;
  flowShadowRunId: string;
}>(async (_request, ctx, routeCtx) => {
  const { projectId, flowShadowRunId } = await routeCtx.params;
  const result = await getContentShadowRun(
    { workspaceId: ctx.operator.workspaceId },
    parseUuidParam(projectId),
    parseUuidParam(flowShadowRunId),
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
