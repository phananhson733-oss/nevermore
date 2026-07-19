import { CreateDiagnosticRunRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { createDiagnosticRun } from "@/lib/services/diagnostics";

/**
 * `POST /api/mvp/projects/{projectId}/diagnostic-runs` — start a diagnostic run
 * (spec §8.1). 202 with run + statusUrl + Location. Hard gates return 422
 * (CONTEXT_INCOMPLETE / CRAWL_SNAPSHOT_REQUIRED / SNAPSHOT_PROJECT_MISMATCH).
 */
export const POST = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "diagnostic_run",
    maxAttempts: 20,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(request, CreateDiagnosticRunRequest);

  const result = await createDiagnosticRun(
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
