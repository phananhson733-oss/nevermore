import { Cursor, Uuid } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectAuditKeywords } from "@/lib/services/growth-map-keywords";

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

/** One bounded page of stable Keyword entities and immutable source lineage. */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    for (const key of searchParams.keys()) {
      if (
        key !== "limit" &&
        key !== "cursor" &&
        key !== "diagnosticRunId"
      ) {
        invalidQuery(key);
      }
    }
    const limit = parseQueryLimit(searchParams);
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
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
    const result = await listProjectAuditKeywords(
      { workspaceId: ctx.operator.workspaceId },
      id,
      { limit, cursor, diagnosticRunId },
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
