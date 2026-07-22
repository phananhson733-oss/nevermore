import { ReviewProductProfileCompetitorRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { reviewProductProfileCompetitor } from "@/lib/services/product-profile";

export const PATCH = operatorRoute<{
  projectId: string;
  candidateId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, candidateId } = await routeCtx.params;
  const project = parseUuidParam(projectId);
  const candidate = parseUuidParam(candidateId);
  const body = await parseJsonBody(
    request,
    ReviewProductProfileCompetitorRequest,
  );
  const profile = await reviewProductProfileCompetitor(
    { workspaceId: ctx.operator.workspaceId },
    project,
    candidate,
    ctx.operator.userId,
    body,
  );
  return ok(profile, ctx.requestId);
});

export const dynamic = "force-dynamic";
