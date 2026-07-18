import { ConnectSourceRequest, OAuthProvider } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { connectProjectSource } from "@/lib/services/source-connect";

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
    const body = await parseJsonBody(request, ConnectSourceRequest);

    const result = await connectProjectSource(
      { workspaceId: ctx.operator.workspaceId },
      id,
      provider.data,
      ctx.operator.userId,
      body,
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
