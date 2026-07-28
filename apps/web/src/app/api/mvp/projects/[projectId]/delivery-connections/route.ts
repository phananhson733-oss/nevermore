import { AppendPublicationDestinationRevisionRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import {
  appendDeliveryConnectionRevision,
  listDeliveryConnections,
} from "@/lib/services/delivery-connections";

export const GET = operatorRoute<{ projectId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const destinations = await listDeliveryConnections(
      { workspaceId: ctx.operator.workspaceId },
      id,
    );
    return ok(destinations, ctx.requestId);
  },
);

export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "delivery_connection_revision",
      maxAttempts: 30,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await parseJsonBody(
      request,
      AppendPublicationDestinationRevisionRequest,
    );
    const result = await appendDeliveryConnectionRevision(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return ok(result.destination, ctx.requestId, {
      status: result.status,
    });
  },
);

export const dynamic = "force-dynamic";
