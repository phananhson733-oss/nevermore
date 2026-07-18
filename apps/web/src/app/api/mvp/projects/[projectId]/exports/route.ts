import { NextResponse } from "next/server";
import { CreateExportRequest } from "@sf/contracts";
import { REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
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
  const body = await parseJsonBody(request, CreateExportRequest);

  const result = await createProjectExport(
    { workspaceId: ctx.operator.workspaceId },
    id,
    ctx.operator.userId,
    idempotencyKey,
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
});

export const dynamic = "force-dynamic";
