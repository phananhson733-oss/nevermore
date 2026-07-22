import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditCompetitor } from "@/lib/services/growth-map-competitors";

/** Exact stable Competitor detail inside the current operator workspace/project. */
export const GET = operatorRoute<{
  projectId: string;
  competitorId: string;
}>(async (_request, ctx, routeCtx) => {
  const { projectId, competitorId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedCompetitorId = parseUuidParam(competitorId);
  const result = await getProjectAuditCompetitor(
    { workspaceId: ctx.operator.workspaceId },
    id,
    selectedCompetitorId,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
