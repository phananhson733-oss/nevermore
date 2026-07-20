import { CreateArtifactWireRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { createActionArtifact } from "@/lib/services/artifacts";

/**
 * `POST /api/mvp/projects/{projectId}/actions/{actionId}/artifacts` — async artifact
 * generation (spec §10.1). Always 202 (even template mode). Re-POST for the same
 * action+type is a regenerate.
 */
export const POST = operatorRoute<{ projectId: string; actionId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, actionId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const aid = parseUuidParam(actionId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "artifact_generation",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
    });
    // Preserve the exact, valid wire locale until the service has checked for
    // a completed historical idempotency record. The service applies the
    // template-locale policy and canonicalization only to new commands.
    const body = await parseJsonBody(request, CreateArtifactWireRequest);

    const result = await createActionArtifact(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      aid,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return asyncAccepted(
      { run: result.run, statusUrl: result.statusUrl, resourceRef: result.resourceRef },
      ctx.requestId,
      result.location,
    );
  },
);

export const dynamic = "force-dynamic";
