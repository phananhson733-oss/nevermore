import { NextResponse } from "next/server";
import { REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { parseUuidParam } from "@/lib/http/validate";
import { disconnectProjectSource } from "@/lib/services/sources";

/**
 * `DELETE /api/mvp/projects/{projectId}/sources/{sourceConnectionId}` — disconnect
 * a source and erase its credential; snapshots are retained (spec §7, §12.3).
 * Returns 204. The `[sourceRef]` segment here is the source connection id.
 */
export const DELETE = operatorRoute<{ projectId: string; sourceRef: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId, sourceRef } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const sourceConnectionId = parseUuidParam(sourceRef);
    await disconnectProjectSource(
      { workspaceId: ctx.operator.workspaceId },
      id,
      sourceConnectionId,
    );
    const response = new NextResponse(null, { status: 204 });
    response.headers.set(REQUEST_ID_HEADER, ctx.requestId);
    return response;
  },
);

export const dynamic = "force-dynamic";
