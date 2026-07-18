import { Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { listProjectActions } from "@/lib/services/actions-service";

/** `GET /api/mvp/projects/{projectId}/actions` — the 30/60/90 plan (spec §9.3). */
export const GET = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);

  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor && Cursor.safeParse(rawCursor).success ? rawCursor : null;
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 100 ? rawLimit : 50;

  const result = await listProjectActions({ workspaceId: ctx.operator.workspaceId }, id, {
    limit,
    cursor,
  });
  return ok(result.data, ctx.requestId, {
    meta: { nextCursor: result.nextCursor, hasNext: result.nextCursor !== null, limit: result.limit },
  });
});

export const dynamic = "force-dynamic";
