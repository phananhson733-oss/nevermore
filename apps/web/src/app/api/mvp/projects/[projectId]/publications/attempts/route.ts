import {
  CreatePublicationAttemptRequest,
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
import { createPublicationAttempt } from "@/lib/services/publication-attempts";

/**
 * 在现有执行中心中创建一次发布。浏览器只提交批准、目标、预览引用与
 * optimistic precondition；Artifact hash、provider bytes checksum、授权快照
 * 和 rollback facts 全部由服务端在同一事务中重新解析并冻结。
 */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "publication_attempt",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
    });
    const body = await parseJsonBody(
      request,
      CreatePublicationAttemptRequest,
    );
    const result = await createPublicationAttempt(
      { workspaceId: ctx.operator.workspaceId },
      pid,
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
  },
);

export const dynamic = "force-dynamic";
