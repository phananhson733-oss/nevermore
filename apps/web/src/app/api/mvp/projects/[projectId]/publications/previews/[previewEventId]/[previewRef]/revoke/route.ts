import {
  PublicationPreviewRef,
  RevokePublicationPreviewRequest,
  RevokePublicationPreviewResponse,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { revokePublicationPreview } from "@/lib/services/publication-previews";

function parsePreviewRefParam(value: string): string {
  const parsed = PublicationPreviewRef.safeParse(value);
  if (!parsed.success) {
    throw new ProblemError("NOT_FOUND", "Resource not found.");
  }
  return parsed.data;
}

/**
 * Append a terminal authority-reducing event. Both preview identities are path
 * selectors; the strict body contains only customer revocation intent.
 */
export const POST = operatorRoute<{
  projectId: string;
  previewEventId: string;
  previewRef: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, previewEventId, previewRef } =
    await routeCtx.params;
  const pid = parseUuidParam(projectId);
  const eventId = parseUuidParam(previewEventId);
  const ref = parsePreviewRefParam(previewRef);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "publication_preview_revoke",
    maxAttempts: 30,
    windowMs: 15 * 60 * 1_000,
  });
  const body = await parseJsonBody(
    request,
    RevokePublicationPreviewRequest,
  );
  const terminal = await revokePublicationPreview(
    { workspaceId: ctx.operator.workspaceId },
    pid,
    eventId,
    ref,
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
  return ok(
    RevokePublicationPreviewResponse.parse(terminal),
    ctx.requestId,
  );
});

export const dynamic = "force-dynamic";
