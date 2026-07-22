import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditKeyword } from "@/lib/services/growth-map-keywords";

/** Exact stable Keyword detail inside the current operator workspace/project. */
export const GET = operatorRoute<{
  projectId: string;
  keywordId: string;
}>(async (_request, ctx, routeCtx) => {
  const { projectId, keywordId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedKeywordId = parseUuidParam(keywordId);
  const result = await getProjectAuditKeyword(
    { workspaceId: ctx.operator.workspaceId },
    id,
    selectedKeywordId,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
