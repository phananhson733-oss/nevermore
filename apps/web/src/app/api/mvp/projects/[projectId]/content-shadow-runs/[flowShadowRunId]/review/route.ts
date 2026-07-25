import { ReviewContentShadowRevisionRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { reviewContentShadowRevision } from "@/lib/services/content-shadow-review";

/**
 * `POST /api/mvp/projects/{projectId}/content-shadow-runs/{flowShadowRunId}/review`
 * — record a human review of the draft revision this run produced.
 *
 * The single write is the artifact's `draft -> ready` status edge. Nothing
 * leaves the system: this stage connects to no CMS, Git or third-party
 * publishing target, and the receipt reports that as a field rather than as
 * prose. `baseRevision` binds the review to the revision the person read; a
 * deliverable that moved on returns 409 STALE_REVISION with nothing written.
 */
export const POST = operatorRoute<{
  projectId: string;
  flowShadowRunId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, flowShadowRunId } = await routeCtx.params;
  const body = await parseJsonBody(request, ReviewContentShadowRevisionRequest);
  const receipt = await reviewContentShadowRevision(
    { workspaceId: ctx.operator.workspaceId },
    parseUuidParam(projectId),
    parseUuidParam(flowShadowRunId),
    body,
  );

  return ok(receipt, ctx.requestId);
});

export const dynamic = "force-dynamic";
