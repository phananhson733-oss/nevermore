import { ConnectSourceRequest, OAuthProvider } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceAttemptRateLimit } from "@/lib/http/rate-limit";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { createCollectionRun } from "@/lib/services/collection";
import {
  connectProjectSource,
  getSourceConnectionGate,
} from "@/lib/services/source-connect";

/**
 * `POST /api/mvp/projects/{projectId}/sources/{provider}/connect` — the three-phase
 * Google OAuth connect endpoint (spec §7.4). `{provider}` is `gsc` or `ga4`
 * (crawl/csv/dataforseo never reach here). Returns the `{data: <phase>}` envelope.
 */
export const POST = operatorRoute<{ projectId: string; sourceRef: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, sourceRef } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const provider = OAuthProvider.safeParse(sourceRef);
    if (!provider.success) {
      throw new ProblemError("NOT_FOUND", "Unknown OAuth provider.");
    }
    await assertWorkspaceAttemptRateLimit(ctx.operator.workspaceId, {
      scope: "source_oauth_connect",
      maxAttempts: 30,
      windowMs: 15 * 60 * 1000,
    });
    const body = await parseJsonBody(request, ConnectSourceRequest);

    const result = await connectProjectSource(
      { workspaceId: ctx.operator.workspaceId },
      id,
      provider.data,
      ctx.operator.userId,
      body,
    );

    // Property selection is the customer's final connection action. Once the
    // Product Profile is confirmed, queue the first collection in this same
    // server request so correctness never depends on a second browser mutation.
    // Optional onboarding connections remain durably connected but defer
    // collection until confirmation provides the market and language context.
    // The stable source-derived key makes the post-confirmation hand-off
    // idempotent.
    const sourceGate =
      result.phase === "connected"
        ? await getSourceConnectionGate(
            { workspaceId: ctx.operator.workspaceId },
            id,
          )
        : null;
    if (
      result.phase === "connected" &&
      result.source.id !== null &&
      sourceGate === "allowed"
    ) {
      try {
        await createCollectionRun(
          { workspaceId: ctx.operator.workspaceId },
          id,
          ctx.operator.userId,
          `oauth-initial-collection:${result.source.id}`,
          {
            provider: provider.data,
            sourceConnectionId: result.source.id,
          },
        );
      } catch (error) {
        // The OAuth connection is already durably committed. Preserve that
        // success and leave the existing retry control available, while making
        // the exceptional queue hand-off observable to operators.
        ctx.logger.warn("oauth_initial_collection_queue_failed", {
          code: error instanceof ProblemError ? error.code : "DEPENDENCY_UNAVAILABLE",
          provider: provider.data,
          type: "collection_queue",
        });
      }
    }
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
