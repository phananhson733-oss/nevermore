import { ReconcilePublicationAttemptRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { reconcilePublicationAttempt } from "@/lib/services/publication-attempts";

/**
 * 当前是显式 fail-closed 边界：在专用 Worker consumer 与 terminal path
 * 同时注册前，不会创建 async_run，也不会把“已排队”伪装成成功。
 */
export const POST = operatorRoute<{
  projectId: string;
  publicationAttemptId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, publicationAttemptId } = await routeCtx.params;
  const pid = parseUuidParam(projectId);
  const attemptId = parseUuidParam(publicationAttemptId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "publication_reconcile",
    maxAttempts: 20,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(
    request,
    ReconcilePublicationAttemptRequest,
  );
  return reconcilePublicationAttempt(
    { workspaceId: ctx.operator.workspaceId },
    pid,
    attemptId,
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
});

export const dynamic = "force-dynamic";
