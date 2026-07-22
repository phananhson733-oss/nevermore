import { AddProductProfileCompetitorRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { addProductProfileCompetitor } from "@/lib/services/product-profile";

export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const body = await parseJsonBody(
      request,
      AddProductProfileCompetitorRequest,
    );
    const profile = await addProductProfileCompetitor(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      body,
    );
    return ok(profile, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
