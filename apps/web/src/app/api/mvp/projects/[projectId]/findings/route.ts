import { Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { listProjectFindings } from "@/lib/services/findings-list";

/**
 * `GET /api/mvp/projects/{projectId}/findings` — page of findings + evidence with
 * meta (latest run, coverage, 11 rule results) so "no finding" and "rule did not
 * run" are distinguishable (spec §11.3).
 */
export const GET = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);

  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor && Cursor.safeParse(rawCursor).success ? rawCursor : null;
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 100 ? rawLimit : 50;
  const activeOnly = url.searchParams.get("active") !== "false";

  const result = await listProjectFindings(
    { workspaceId: ctx.operator.workspaceId },
    id,
    { limit, cursor, activeOnly },
  );
  return ok(result.data, ctx.requestId, { meta: result.meta });
});

export const dynamic = "force-dynamic";
