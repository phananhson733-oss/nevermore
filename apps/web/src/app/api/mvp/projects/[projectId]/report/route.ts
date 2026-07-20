import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseOptionalOutputLocale,
  parseUuidParam,
} from "@/lib/http/validate";
import { getProjectReport } from "@/lib/services/report";

/**
 * `GET /api/mvp/projects/{projectId}/report` — the client report projection
 * (spec §10.4). `outputLocale` defaults to the project delivery locale.
 */
export const GET = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const outputLocale = parseOptionalOutputLocale(
    new URL(request.url).searchParams,
  );

  const report = await getProjectReport(
    { workspaceId: ctx.operator.workspaceId },
    id,
    outputLocale,
    new Date().toISOString(),
  );
  return ok(report, ctx.requestId);
});

export const dynamic = "force-dynamic";
