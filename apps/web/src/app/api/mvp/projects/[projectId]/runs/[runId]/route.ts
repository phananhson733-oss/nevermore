import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectRun } from "@/lib/services/runs";

/** `GET /api/mvp/projects/{projectId}/runs/{runId}` — unified async-run status (spec §11.2). */
export const GET = operatorRoute<{ projectId: string; runId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId, runId } = await routeCtx.params;
    const run = await getProjectRun(
      { workspaceId: ctx.operator.workspaceId },
      parseUuidParam(projectId),
      parseUuidParam(runId),
    );
    return ok(run, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
