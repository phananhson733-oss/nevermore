import {
  UpdateProductProfileDraftRequest,
} from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import {
  getProductProfileWorkspace,
  updateProductProfileDraft,
} from "@/lib/services/product-profile";

export const GET = operatorRoute<{ projectId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const workspace = await getProductProfileWorkspace(
      { workspaceId: ctx.operator.workspaceId },
      id,
    );
    return ok(workspace, ctx.requestId);
  },
);

export const PATCH = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const body = await parseJsonBody(request, UpdateProductProfileDraftRequest);
    const profile = await updateProductProfileDraft(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      body,
    );
    return ok(profile, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
