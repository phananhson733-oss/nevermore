import { Cursor, Uuid } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectAuditCompetitors } from "@/lib/services/growth-map-competitors";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CanonicalUuid = Uuid.refine((value) => CANONICAL_UUID.test(value));
const LIST_QUERY_NAMES = new Set(["limit", "cursor", "diagnosticRunId"]);

function queryPointer(name: string): string {
  return `/${name.replace(/~/gu, "~0").replace(/\//gu, "~1")}`;
}

function assertOnlyListQuery(searchParams: URLSearchParams): void {
  for (const name of searchParams.keys()) {
    if (LIST_QUERY_NAMES.has(name)) continue;
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Query parameter failed validation.",
      {
        errors: [
          {
            pointer: queryPointer(name),
            code: "unknown_query_parameter",
            message: "Unknown query parameter.",
          },
        ],
      },
    );
  }
}

/** One bounded page of stable Competitor entities and immutable origin lineage. */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    assertOnlyListQuery(searchParams);
    const limit = parseQueryLimit(searchParams);
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
    const diagnosticRunId = parseQueryValue(
      searchParams,
      "diagnosticRunId",
      CanonicalUuid,
    );
    const result = await listProjectAuditCompetitors(
      { workspaceId: ctx.operator.workspaceId },
      id,
      { limit, cursor, diagnosticRunId },
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
