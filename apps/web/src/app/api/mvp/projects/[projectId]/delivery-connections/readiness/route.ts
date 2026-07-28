import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectDeliveryConnectorReadiness } from "@/lib/services/delivery-connections";

export const GET = operatorRoute<{ projectId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const readiness = await getProjectDeliveryConnectorReadiness(
      { workspaceId: ctx.operator.workspaceId },
      id,
    );
    return ok(readiness, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
