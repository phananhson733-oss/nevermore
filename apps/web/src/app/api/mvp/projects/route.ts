import { CreateProjectWireRequest, Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseQueryBoolean,
  parseQueryLimit,
  parseQueryValue,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import { createProject, listProjects } from "@/lib/services/projects";

/** `GET /api/mvp/projects` — keyset page of the workspace's projects (spec §11.1). */
export const GET = operatorRoute(async (request, ctx) => {
  const url = new URL(request.url);
  const cursor = parseQueryValue(url.searchParams, "cursor", Cursor);
  const limit = parseQueryLimit(url.searchParams);
  const archived = parseQueryBoolean(url.searchParams, "archived", false);

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
  // Preserve a valid historical wire URL until createProject has checked for a
  // completed idempotency replay. New commands are still restricted to origins
  // by the service before any DNS lookup or persistence.
  const body = await parseJsonBody(request, CreateProjectWireRequest);
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
