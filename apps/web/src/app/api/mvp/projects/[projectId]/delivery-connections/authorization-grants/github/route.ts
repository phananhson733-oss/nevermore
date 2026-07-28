import { ConnectGitHubDeliveryAuthorizationGrantRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { authorizeGitHubDeliveryConnection } from "@/lib/services/delivery-connections";

export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "delivery_connection_github_authorization",
      maxAttempts: 10,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await parseJsonBody(
      request,
      ConnectGitHubDeliveryAuthorizationGrantRequest,
    );
    const result = await authorizeGitHubDeliveryConnection(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return ok(result.grant, ctx.requestId, { status: result.status });
  },
);

export const dynamic = "force-dynamic";
