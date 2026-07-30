import { CreateCollectionRunRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { createCollectionRun } from "@/lib/services/collection";

/**
 * `POST /api/mvp/projects/{projectId}/collection-runs` — queue one
 * customer-triggerable Crawl/GSC/GA4 collection (spec §7.5, §13.2).
 * Server-owned providers such as DataForSEO run only inside Analysis Refresh.
 * Returns 202 with the run + statusUrl + Location using the shared `{ data }`
 * success envelope.
 */
export const POST = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const idempotencyKey = requireIdempotencyKey(request);
  await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
    idempotencyKey,
    scope: "collection_run",
    maxAttempts: 20,
    windowMs: 15 * 60 * 1000,
  });
  const body = await parseJsonBody(request, CreateCollectionRunRequest);

  const result = await createCollectionRun(
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
