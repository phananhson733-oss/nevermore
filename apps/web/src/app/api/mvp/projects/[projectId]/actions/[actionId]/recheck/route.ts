import { CreateActionRecheckRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { createActionRecheck } from "@/lib/services/action-recheck";

/**
 * `POST /api/mvp/projects/{projectId}/actions/{actionId}/recheck` — queue a
 * targeted recheck of one confirmed Action's technical condition (Slice 1,
 * Task 8). 202 with run + statusUrl + resourceRef{type:audit_run}. The recheck
 * creates a brand-new immutable audit run; the prior run is never mutated.
 */
export const POST = operatorRoute<{ projectId: string; actionId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, actionId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const aid = parseUuidParam(actionId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "growth_audit_recheck",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
    });
    const body = await parseJsonBody(request, CreateActionRecheckRequest);
    if (body.actionId !== aid) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "The recheck actionId must match the request path.",
      );
    }

    const result = await createActionRecheck(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return asyncAccepted(
      {
        run: result.run,
        statusUrl: result.statusUrl,
        resourceRef: result.resourceRef,
      },
      ctx.requestId,
      result.location,
    );
  },
);

export const dynamic = "force-dynamic";
