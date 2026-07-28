import {
  IssuePublicationPreviewRequest,
  IssuePublicationPreviewResponse,
} from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { issuePublicationPreview } from "@/lib/services/publication-previews";

/**
 * Mint one short-lived, append-only publish preview from current server facts.
 * The body selects only a destination revision and exact approval event.
 */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "publication_preview_issue",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await parseJsonBody(
      request,
      IssuePublicationPreviewRequest,
    );
    const issued = await issuePublicationPreview(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return ok(
      IssuePublicationPreviewResponse.parse(issued),
      ctx.requestId,
      { status: 201 },
    );
  },
);

export const dynamic = "force-dynamic";
