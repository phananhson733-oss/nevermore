import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getPublicationAttempt } from "@/lib/services/publication-attempts";

/**
 * 返回客户可见的不可变发布历史。该读取使用 archive-readable canonical
 * repository，因此项目归档后仍能查看当时的 Attempt、Run 与 Receipt 证据。
 */
export const GET = operatorRoute<{
  projectId: string;
  publicationAttemptId: string;
}>(async (_request, ctx, routeCtx) => {
  const { projectId, publicationAttemptId } = await routeCtx.params;
  const pid = parseUuidParam(projectId);
  const attemptId = parseUuidParam(publicationAttemptId);
  const attempt = await getPublicationAttempt(
    { workspaceId: ctx.operator.workspaceId },
    pid,
    attemptId,
  );
  return ok(attempt, ctx.requestId);
});

export const dynamic = "force-dynamic";
