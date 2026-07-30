import { CreateAnalysisRefreshRunRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { createAnalysisRefreshRun } from "@/lib/services/analysis-refresh";

/** Queue the fixed, server-owned Analysis Refresh orchestration plan. */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "analysis_refresh_run",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
    });
    // OpenAPI makes requestBody optional, while the UI deliberately sends `{}`.
    // A present body remains strict: unknown members/non-objects are rejected
    // because the client cannot plan orchestration steps.
    const body =
      request.body === null
        ? {}
        : await parseJsonBody(request, CreateAnalysisRefreshRunRequest);
    const result = await createAnalysisRefreshRun(
      { workspaceId: ctx.operator.workspaceId },
      id,
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
