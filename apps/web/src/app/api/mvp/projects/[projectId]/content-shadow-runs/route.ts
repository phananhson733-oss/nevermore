import { CreateContentShadowRunRequest, Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted, ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import {
  createContentShadowRun,
  listContentShadowRuns,
} from "@/lib/services/content-shadow";

/**
 * `POST /api/mvp/projects/{projectId}/content-shadow-runs` — queue one pinned
 * SEO/GEO Content Shadow run (Slice 2). 202 with run + statusUrl +
 * resourceRef{type:flow_shadow_run}. The command confirms nothing: an
 * unconfirmed Finding or a missing content brief returns 422, a Finding that
 * moved past its frozen diagnosis returns 409, and an already-active shadow run
 * for the same Action returns 409.
 */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "content_shadow_run",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000,
    });
    const body = await parseJsonBody(request, CreateContentShadowRunRequest);

    const result = await createContentShadowRun(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    return asyncAccepted(
      {
        run: result.run,
        statusUrl: result.statusUrl,
        resourceRef: result.resourceRef,
      },
      ctx.requestId,
      result.location,
    );
  },
);

/**
 * `GET /api/mvp/projects/{projectId}/content-shadow-runs` — the run index.
 * State-free by contract: each row carries only the run's own immutable columns
 * plus its frozen output locale, so a page never reports a phase, a verdict or
 * a research pack it did not read. Those come from the detail projection.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const url = new URL(request.url);
    const cursor = parseQueryValue(url.searchParams, "cursor", Cursor);
    const limit = parseQueryLimit(url.searchParams);

    const result = await listContentShadowRuns(
      { workspaceId: ctx.operator.workspaceId },
      id,
      { limit, cursor },
    );
    return ok(result.data, ctx.requestId, {
      meta: {
        nextCursor: result.nextCursor,
        hasNext: result.nextCursor !== null,
        limit: result.limit,
      },
    });
  },
);

export const dynamic = "force-dynamic";
