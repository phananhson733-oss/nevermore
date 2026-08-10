import { ApproveKeywordReviewSuggestionRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { approveProjectAuditKeywordReviewSuggestion } from "@/lib/services/growth-map-keywords";

function rejectQuery(): never {
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Query parameter failed validation.",
    {
      errors: [
        {
          pointer: "/query",
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ],
    },
  );
}

/** Accept one immutable system suggestion as an explicit human decision. */
export const POST = operatorRoute<{
  projectId: string;
  keywordId: string;
  suggestionId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, keywordId, suggestionId } = await routeCtx.params;
  const selectedProjectId = parseUuidParam(projectId);
  const selectedKeywordId = parseUuidParam(keywordId);
  const selectedSuggestionId = parseUuidParam(suggestionId);
  if (new URL(request.url).searchParams.size > 0) rejectQuery();
  const body = await parseJsonBody(
    request,
    ApproveKeywordReviewSuggestionRequest,
  );
  const result = await approveProjectAuditKeywordReviewSuggestion(
    {
      workspaceId: ctx.operator.workspaceId,
      actorId: ctx.operator.userId,
      logger: ctx.logger.child({
        workspaceId: ctx.operator.workspaceId,
        projectId: selectedProjectId,
      }),
    },
    selectedProjectId,
    selectedKeywordId,
    selectedSuggestionId,
    body,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
