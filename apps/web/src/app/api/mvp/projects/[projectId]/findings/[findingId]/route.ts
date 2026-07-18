import { ReviewFindingRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { reviewProjectFinding } from "@/lib/services/finding-review";

/**
 * `PATCH /api/mvp/projects/{projectId}/findings/{findingId}` — confirm / ignore /
 * needs-more-data (spec §9.1). Confirm triggers a same-transaction Action upsert;
 * the response returns `{finding, action}`.
 */
export const PATCH = operatorRoute<{ projectId: string; findingId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, findingId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const fid = parseUuidParam(findingId);
    const body = await parseJsonBody(request, ReviewFindingRequest);

    const result = await reviewProjectFinding(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      fid,
      ctx.operator.userId,
      body,
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
