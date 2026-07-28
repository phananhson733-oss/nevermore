import {
  IssuePublicationRollbackPreviewRequest,
  IssuePublicationRollbackPreviewResponse,
} from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { issuePublicationRollbackPreview } from "@/lib/services/publication-previews";

/**
 * Mint rollback authority only after re-reading the exact source attempt,
 * verified Change Receipt, historical approval and current provider revision.
 */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "publication_rollback_preview_issue",
      maxAttempts: 10,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await parseJsonBody(
      request,
      IssuePublicationRollbackPreviewRequest,
    );
    const issued = await issuePublicationRollbackPreview(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return ok(
      IssuePublicationRollbackPreviewResponse.parse(issued),
      ctx.requestId,
      { status: 201 },
    );
  },
);

export const dynamic = "force-dynamic";
