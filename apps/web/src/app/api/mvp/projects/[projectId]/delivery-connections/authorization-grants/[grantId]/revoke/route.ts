import { RevokeDeliveryAuthorizationGrantRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { revokeDeliveryAuthorizationGrant } from "@/lib/services/delivery-connections";

export const POST = operatorRoute<{
  projectId: string;
  grantId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, grantId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const grantRef = parseUuidParam(grantId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "delivery_connection_grant_revoke",
    maxAttempts: 30,
    windowMs: 15 * 60 * 1_000,
  });
  const body = await parseJsonBody(
    request,
    RevokeDeliveryAuthorizationGrantRequest,
  );
  if (body.authorizationGrantRef !== grantRef) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Authorization grant path and body must match.",
      {
        errors: [
          {
            pointer: "/authorizationGrantRef",
            code: "path_body_mismatch",
            message: "Authorization grant path and body must match.",
          },
        ],
      },
    );
  }
  const result = await revokeDeliveryAuthorizationGrant(
    { workspaceId: ctx.operator.workspaceId },
    id,
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
  return ok(result.grant, ctx.requestId, { status: result.status });
});

export const dynamic = "force-dynamic";
