import { CreateGrowthAuditRunRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { createGrowthAuditRun } from "@/lib/services/audit-runs";

/**
 * `POST /api/mvp/projects/{projectId}/audit-runs` — queue a versioned full
 * Growth Audit (Slice 1). 202 with run + statusUrl + resourceRef{type:audit_run}.
 * Hard gates return 422 (CONTEXT_INCOMPLETE / CRAWL_SNAPSHOT_REQUIRED /
 * SNAPSHOT_PROJECT_MISMATCH); an already-active audit returns 409.
 */
export const POST = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "growth_audit_run",
    maxAttempts: 20,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(request, CreateGrowthAuditRunRequest);

  const result = await createGrowthAuditRun(
    { workspaceId: ctx.operator.workspaceId },
    id,
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
  return asyncAccepted(
    { run: result.run, statusUrl: result.statusUrl, resourceRef: result.resourceRef },
    ctx.requestId,
    result.location,
  );
});

export const dynamic = "force-dynamic";
