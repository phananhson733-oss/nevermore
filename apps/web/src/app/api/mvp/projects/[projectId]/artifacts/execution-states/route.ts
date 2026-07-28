import {
  MAX_ACTION_EXECUTION_STATE_BATCH_SIZE,
  Uuid,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";

import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getArtifactExecutionStateBatch } from "@/lib/services/action-execution-state";

function rejectArtifactIds(): never {
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Query parameter failed validation.",
    {
      errors: [
        {
          pointer: "/artifactId",
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ],
    },
  );
}

function artifactIds(searchParams: URLSearchParams): string[] {
  for (const key of searchParams.keys()) {
    if (key !== "artifactId") rejectArtifactIds();
  }
  const values = searchParams.getAll("artifactId");
  if (
    values.length < 1 ||
    values.length > MAX_ACTION_EXECUTION_STATE_BATCH_SIZE ||
    new Set(values).size !== values.length ||
    values.some((value) => !Uuid.safeParse(value).success)
  ) {
    return rejectArtifactIds();
  }
  return values;
}

/**
 * Bounded current-state read for Artifact cards in the existing Execution
 * Center. Full history remains on the exact Action/Artifact stream endpoint.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const batch = await getArtifactExecutionStateBatch(
      { workspaceId: ctx.operator.workspaceId },
      id,
      artifactIds(new URL(request.url).searchParams),
    );
    return ok(batch, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
