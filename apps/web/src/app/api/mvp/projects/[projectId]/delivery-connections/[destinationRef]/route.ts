import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getDeliveryConnection } from "@/lib/services/delivery-connections";

export const GET = operatorRoute<{
  projectId: string;
  destinationRef: string;
}>(async (_request, ctx, routeCtx) => {
  const { projectId, destinationRef } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const ref = parseUuidParam(destinationRef);
  const destination = await getDeliveryConnection(
    { workspaceId: ctx.operator.workspaceId },
    id,
    ref,
  );
  return ok(destination, ctx.requestId);
});

export const dynamic = "force-dynamic";
