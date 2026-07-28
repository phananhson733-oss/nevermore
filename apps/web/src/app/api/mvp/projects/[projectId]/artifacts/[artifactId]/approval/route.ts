import { AppendArtifactApprovalEventRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { appendArtifactApprovalEvent } from "@/lib/services/artifact-approval";

/**
 * Append approval/revocation/supersession for one exact Artifact Revision.
 *
 * This stays inside the existing Execution module: it creates durable
 * publication authority but performs no CMS/GitHub write. The strict request
 * contract accepts only revision identity, optimistic QA version and explicit
 * acknowledgement intent; reviewer, hashes, snapshots and timestamps are
 * derived on the server.
 */
export const POST = operatorRoute<{
  projectId: string;
  artifactId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, artifactId } = await routeCtx.params;
  const pid = parseUuidParam(projectId);
  const aid = parseUuidParam(artifactId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "artifact_approval",
    maxAttempts: 60,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(
    request,
    AppendArtifactApprovalEventRequest,
  );
  const event = await appendArtifactApprovalEvent(
    { workspaceId: ctx.operator.workspaceId },
    pid,
    aid,
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
  return ok(event, ctx.requestId, { status: 201 });
});

export const dynamic = "force-dynamic";
