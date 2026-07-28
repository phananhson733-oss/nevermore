import {
  CreatePublicationRollbackAttemptRequest,
  PublicationAttemptAccepted,
} from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { createPublicationRollbackAttempt } from "@/lib/services/publication-attempts";

/**
 * 基于 path 中的源 Attempt 与请求中精确的 verified Change Receipt 创建一次
 * 新的授权回滚写入。回滚不会修改或“复活”原发布运行。
 */
export const POST = operatorRoute<{
  projectId: string;
  publicationAttemptId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, publicationAttemptId } = await routeCtx.params;
  const pid = parseUuidParam(projectId);
  const sourceAttemptId = parseUuidParam(publicationAttemptId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "publication_rollback",
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(
    request,
    CreatePublicationRollbackAttemptRequest,
  );
  const result = await createPublicationRollbackAttempt(
    { workspaceId: ctx.operator.workspaceId },
    pid,
    sourceAttemptId,
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
  const accepted = PublicationAttemptAccepted.parse({
    publicationAttemptId: result.publicationAttemptId,
    asyncRunId: result.asyncRunId,
    state: result.state,
    replayed: result.replayed,
  });
  return asyncAccepted(accepted, ctx.requestId, result.location);
});

export const dynamic = "force-dynamic";
