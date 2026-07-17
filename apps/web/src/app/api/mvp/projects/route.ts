import { CreateProjectRequest, Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, requireIdempotencyKey } from "@/lib/http/validate";
import { createProject, listProjects } from "@/lib/services/projects";

/** `GET /api/mvp/projects` — keyset page of the workspace's projects (spec §11.1). */
export const GET = operatorRoute(async (request, ctx) => {
  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor && Cursor.safeParse(rawCursor).success ? rawCursor : null;
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 100 ? rawLimit : 50;
  const archived = url.searchParams.get("archived") === "true";

  const result = await listProjects(
    { workspaceId: ctx.operator.workspaceId },
    { limit, cursor, archived },
  );
  return ok(result.data, ctx.requestId, {
    meta: { nextCursor: result.nextCursor, hasNext: result.nextCursor !== null, limit: result.limit },
  });
});

/** `POST /api/mvp/projects` — create project + primary site + Crawl source (spec §6.1). */
export const POST = operatorRoute(async (request, ctx) => {
  const idempotencyKey = requireIdempotencyKey(request);
  const body = await parseJsonBody(request, CreateProjectRequest);
  const result = await createProject(
    { workspaceId: ctx.operator.workspaceId },
    ctx.operator.userId,
    idempotencyKey,
    body,
  );
  return ok(result.project, ctx.requestId, {
    status: result.status,
    headers: { Location: result.location },
  });
});

export const dynamic = "force-dynamic";
