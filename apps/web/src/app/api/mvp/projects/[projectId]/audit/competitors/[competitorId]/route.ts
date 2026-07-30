import { ReviewCompetitorRequest, Uuid } from "@sf/contracts";
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
  getProjectAuditCompetitor,
  getProjectAuditCompetitorReviewDetail,
  reviewProjectAuditCompetitor,
} from "@/lib/services/growth-map-competitors";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CanonicalUuid = Uuid.refine((value) => CANONICAL_UUID.test(value));
const DETAIL_QUERY_NAMES = new Set(["view", "diagnosticRunId"]);

function queryPointer(name: string): string {
  return `/${name.replace(/~/gu, "~0").replace(/\//gu, "~1")}`;
}

function rejectQuery(
  name: string,
  code:
    | "unknown_query_parameter"
    | "mutually_exclusive_query_parameters",
): never {
  const unknown = code === "unknown_query_parameter";
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Query parameter failed validation.",
    {
      errors: [
        {
          pointer: queryPointer(name),
          code,
          message: unknown
            ? "Unknown query parameter."
            : "Query parameters are mutually exclusive.",
        },
      ],
    },
  );
}

function assertOnlyDetailQuery(searchParams: URLSearchParams): void {
  for (const name of searchParams.keys()) {
    if (!DETAIL_QUERY_NAMES.has(name)) {
      rejectQuery(name, "unknown_query_parameter");
    }
  }
}

function assertNoMutationQuery(searchParams: URLSearchParams): void {
  const first = searchParams.keys().next();
  if (!first.done) {
    rejectQuery(first.value, "unknown_query_parameter");
  }
}

/** Exact stable Competitor detail inside the current operator workspace/project. */
export const GET = operatorRoute<{
  projectId: string;
  competitorId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, competitorId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedCompetitorId = parseUuidParam(competitorId);
  const searchParams = new URL(request.url).searchParams;
  assertOnlyDetailQuery(searchParams);
  const view = parseOptionalQueryEnum(searchParams, "view", ["review"]);
  const diagnosticRunId = parseQueryValue(
    searchParams,
    "diagnosticRunId",
    CanonicalUuid,
  );
  if (view === "review" && diagnosticRunId !== null) {
    rejectQuery(
      "diagnosticRunId",
      "mutually_exclusive_query_parameters",
    );
  }
  const result =
    view === "review"
      ? await getProjectAuditCompetitorReviewDetail(
          { workspaceId: ctx.operator.workspaceId },
          id,
          selectedCompetitorId,
        )
      : await getProjectAuditCompetitor(
          { workspaceId: ctx.operator.workspaceId },
          id,
          selectedCompetitorId,
          { diagnosticRunId },
        );

  return ok(result, ctx.requestId);
});

/** Optimistic Competitor governance review; immutable origin lineage is unchanged. */
export const PATCH = operatorRoute<{
  projectId: string;
  competitorId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, competitorId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedCompetitorId = parseUuidParam(competitorId);
  assertNoMutationQuery(new URL(request.url).searchParams);
  const body = await parseJsonBody(request, ReviewCompetitorRequest);
  const result = await reviewProjectAuditCompetitor(
    { workspaceId: ctx.operator.workspaceId },
    id,
    selectedCompetitorId,
    body,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
