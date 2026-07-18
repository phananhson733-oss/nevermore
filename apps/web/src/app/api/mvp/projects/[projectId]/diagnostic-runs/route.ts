import { NextResponse } from "next/server";
import { CreateDiagnosticRunRequest } from "@sf/contracts";
import { REQUEST_ID_HEADER } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
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
  const body = await parseJsonBody(request, CreateDiagnosticRunRequest);

  const result = await createDiagnosticRun(
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
