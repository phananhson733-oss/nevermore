import { NextResponse } from "next/server";
import { CreateArtifactRequest } from "@sf/contracts";
import { REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { createActionArtifact } from "@/lib/services/artifacts";

/**
 * `POST /api/mvp/projects/{projectId}/actions/{actionId}/artifacts` — async artifact
 * generation (spec §10.1). Always 202 (even template mode). Re-POST for the same
 * action+type is a regenerate.
 */
export const POST = operatorRoute<{ projectId: string; actionId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, actionId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const aid = parseUuidParam(actionId);
    requireIdempotencyKey(request);
    const body = await parseJsonBody(request, CreateArtifactRequest);

    const result = await createActionArtifact(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      aid,
      ctx.operator.userId,
      body,
    );
    const response = NextResponse.json(
      { run: result.run, statusUrl: result.statusUrl, resourceRef: result.resourceRef },
      { status: 202 },
    );
    response.headers.set("Location", result.location);
    response.headers.set("Retry-After", "1");
    response.headers.set(REQUEST_ID_HEADER, ctx.requestId);
    return response;
  },
);

export const dynamic = "force-dynamic";
