import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditKeywordRankHistory } from "@/lib/services/growth-map-keyword-rank-history";

/**
 * Return the fixed trailing 90-day rank evidence for one governed Keyword.
 * This is a Growth Map detail resource, not a separate workspace module.
 */
export const GET = operatorRoute<{
  projectId: string;
  keywordId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, keywordId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedKeywordId = parseUuidParam(keywordId);
  if (new URL(request.url).searchParams.size > 0) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Keyword rank history uses one fixed trailing 90-day UTC window.",
    );
  }

  const result = await getProjectAuditKeywordRankHistory(
    { workspaceId: ctx.operator.workspaceId },
    id,
    selectedKeywordId,
  );
  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
