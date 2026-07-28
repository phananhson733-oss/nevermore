import { ReviewKeywordRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import {
  getProjectAuditKeyword,
  reviewProjectAuditKeyword,
} from "@/lib/services/growth-map-keywords";

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

/** Review Topic/page governance for one stable Keyword identity. */
export const PATCH = operatorRoute<{
  projectId: string;
  keywordId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, keywordId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedKeywordId = parseUuidParam(keywordId);
  const body = await parseJsonBody(request, ReviewKeywordRequest);
  const result = await reviewProjectAuditKeyword(
    {
      workspaceId: ctx.operator.workspaceId,
      actorId: ctx.operator.userId,
    },
    id,
    selectedKeywordId,
    body,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
