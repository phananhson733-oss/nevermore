import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryLimit,
  parseUuidParam,
} from "@/lib/http/validate";
import {
  DEFAULT_MEASUREMENT_WINDOW_RECENT_LIMIT,
  listProjectRecentMeasurementWindows,
} from "@/lib/services/measurement";

function queryPointer(name: string): string {
  return `/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function assertRecentQuery(searchParams: URLSearchParams): void {
  for (const key of searchParams.keys()) {
    if (key === "limit") continue;
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Query parameter failed validation.",
      {
        errors: [
          {
            pointer: queryPointer(key),
            code: "unknown_query_parameter",
            message: "Unknown query parameter.",
          },
        ],
      },
    );
  }
}

/**
 * Project-level Results feed of complete immutable Measurement Windows across
 * all URL targets. `limit` is the only accepted selector; target-specific
 * history remains available from the parent Measurement Window route.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    assertRecentQuery(searchParams);
    const limit = parseQueryLimit(
      searchParams,
      DEFAULT_MEASUREMENT_WINDOW_RECENT_LIMIT,
    );
    const result = await listProjectRecentMeasurementWindows(
      { workspaceId: ctx.operator.workspaceId },
      id,
      { limit },
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
