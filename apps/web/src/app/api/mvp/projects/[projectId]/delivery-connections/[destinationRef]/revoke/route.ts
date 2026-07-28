import { RevokePublicationDestinationRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { revokeDeliveryConnection } from "@/lib/services/delivery-connections";

export const POST = operatorRoute<{
  projectId: string;
  destinationRef: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, destinationRef } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const ref = parseUuidParam(destinationRef);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "delivery_connection_revoke",
    maxAttempts: 30,
    windowMs: 15 * 60 * 1_000,
  });
  const body = await parseJsonBody(
    request,
    RevokePublicationDestinationRequest,
  );
  const result = await revokeDeliveryConnection(
    { workspaceId: ctx.operator.workspaceId },
    id,
    ctx.operator.userId,
    ref,
    idempotencyKey,
    body,
  );
  return ok(result.destination, ctx.requestId, {
    status: result.status,
  });
});

export const dynamic = "force-dynamic";
