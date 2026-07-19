import { CreateExportRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { createProjectExport } from "@/lib/services/export-service";

/**
 * `POST /api/mvp/projects/{projectId}/exports` — async bundle generation (spec §10.5).
 * 202 with run + statusUrl. `export:{kind}` serializes concurrent same-kind exports.
 */
export const POST = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "project_export",
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(request, CreateExportRequest);

  const result = await createProjectExport(
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
