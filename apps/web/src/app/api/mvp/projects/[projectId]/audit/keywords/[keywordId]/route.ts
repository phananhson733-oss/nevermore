import { ReviewKeywordRequest, Uuid } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseOptionalQueryEnum,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import {
  getProjectAuditKeyword,
  getProjectAuditKeywordReviewDetail,
  reviewProjectAuditKeyword,
} from "@/lib/services/growth-map-keywords";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function invalidQuery(name: string): never {
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Query parameter failed validation.",
    {
      errors: [
        {
          pointer: `/${name}`,
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ],
    },
  );
}

/** Exact stable Keyword detail inside the current operator workspace/project. */
export const GET = operatorRoute<{
  projectId: string;
  keywordId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, keywordId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedKeywordId = parseUuidParam(keywordId);
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (key !== "view" && key !== "diagnosticRunId") {
      invalidQuery(key);
    }
  }
  const view = parseOptionalQueryEnum(searchParams, "view", ["review"]);
  const diagnosticRunIdRaw = parseQueryValue(
    searchParams,
    "diagnosticRunId",
    Uuid,
  );
  const diagnosticRunId =
    diagnosticRunIdRaw === null
      ? null
      : CANONICAL_UUID.test(diagnosticRunIdRaw)
        ? diagnosticRunIdRaw
        : invalidQuery("diagnosticRunId");
  if (view === "review" && diagnosticRunId !== null) {
    invalidQuery("diagnosticRunId");
  }
  const result =
    view === "review"
      ? await getProjectAuditKeywordReviewDetail(
          { workspaceId: ctx.operator.workspaceId },
          id,
          selectedKeywordId,
        )
      : await getProjectAuditKeyword(
          { workspaceId: ctx.operator.workspaceId },
          id,
          selectedKeywordId,
          diagnosticRunId,
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
  if (new URL(request.url).searchParams.size > 0) {
    invalidQuery("query");
  }
  const body = await parseJsonBody(request, ReviewKeywordRequest);
  const result = await reviewProjectAuditKeyword(
    {
      workspaceId: ctx.operator.workspaceId,
      actorId: ctx.operator.userId,
      logger: ctx.logger.child({
        workspaceId: ctx.operator.workspaceId,
        projectId: id,
      }),
    },
    id,
    selectedKeywordId,
    body,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
