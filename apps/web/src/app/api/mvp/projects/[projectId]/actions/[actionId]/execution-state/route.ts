import {
  UpdateActionExecutionStateRequest,
  Uuid,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";

import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseQueryValue,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import {
  getActionExecutionStateTimeline,
  updateActionExecutionState,
} from "@/lib/services/action-execution-state";

function executionArtifactId(request: Request): string | null {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (key !== "artifactId") {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Query parameter failed validation.",
        {
          errors: [
            {
              pointer: `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
              code: "invalid_query_value",
              message: "Unknown query parameter.",
            },
          ],
        },
      );
    }
  }
  return parseQueryValue(searchParams, "artifactId", Uuid);
}

/**
 * Exact delivery execution stream inside the existing Execution Center.
 *
 * No `artifactId` means the Action-level stream. Supplying one selects that
 * Artifact's independent stream; the API never merges the two implicitly.
 */
export const GET = operatorRoute<{
  projectId: string;
  actionId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, actionId } = await routeCtx.params;
  const pid = parseUuidParam(projectId);
  const aid = parseUuidParam(actionId);
  const artifactId = executionArtifactId(request);
  const timeline = await getActionExecutionStateTimeline(
    { workspaceId: ctx.operator.workspaceId },
    pid,
    aid,
    artifactId,
  );
  return ok(timeline, ctx.requestId);
});

/**
 * Append one manual customer/operator execution update. The path/query,
 * authenticated actor, Idempotency-Key header and server time/source complete
 * the trusted internal command; none may be authored in the JSON body.
 */
export const POST = operatorRoute<{
  projectId: string;
  actionId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, actionId } = await routeCtx.params;
  const pid = parseUuidParam(projectId);
  const aid = parseUuidParam(actionId);
  const artifactId = executionArtifactId(request);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "action_execution_state",
    maxAttempts: 60,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(
    request,
    UpdateActionExecutionStateRequest,
  );
  const result = await updateActionExecutionState(
    { workspaceId: ctx.operator.workspaceId },
    pid,
    aid,
    artifactId,
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
  return ok(result, ctx.requestId, { status: 201 });
});

export const dynamic = "force-dynamic";
