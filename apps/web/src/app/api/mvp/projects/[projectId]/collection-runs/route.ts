import { NextResponse } from "next/server";
import { CreateCollectionRunRequest } from "@sf/contracts";
import { REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { parseJsonBody, parseUuidParam, requireIdempotencyKey } from "@/lib/http/validate";
import { createCollectionRun } from "@/lib/services/collection";

/**
 * `POST /api/mvp/projects/{projectId}/collection-runs` — queue one provider
 * collection (spec §7.5, §13.2). Returns 202 with the run + statusUrl + Location
 * (the AsyncAcceptedResponse body is NOT wrapped in the `{data}` envelope).
 */
export const POST = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const idempotencyKey = requireIdempotencyKey(request);
  const body = await parseJsonBody(request, CreateCollectionRunRequest);

  const result = await createCollectionRun(
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
