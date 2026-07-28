import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditTopicModelWorkspace } from "@/lib/services/growth-map-topic-model";

/**
 * Return both the latest confirmed Topic Model and its unique editable draft.
 * The draft is a Growth Map working state and never replaces confirmed
 * authority before the explicit confirmation command succeeds.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const result = await getProjectAuditTopicModelWorkspace(
      { workspaceId: ctx.operator.workspaceId },
      id,
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
