import { Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseOptionalQueryEnum,
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectArtifacts } from "@/lib/services/artifacts";

const ARTIFACT_TYPES = [
  "content_brief",
  "metadata_rewrite",
  "technical_ticket",
] as const;
const ARTIFACT_STATUSES = [
  "generating",
  "draft",
  "ready",
  "failed",
  "archived",
] as const;

/** `GET /api/mvp/projects/{projectId}/artifacts` — list artifacts + revision meta (spec §11). */
export const GET = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const url = new URL(request.url);
  const cursor = parseQueryValue(url.searchParams, "cursor", Cursor);
  const limit = parseQueryLimit(url.searchParams);
  const artifactType = parseOptionalQueryEnum(
    url.searchParams,
    "type",
    ARTIFACT_TYPES,
  );
  const status = parseOptionalQueryEnum(
    url.searchParams,
    "status",
    ARTIFACT_STATUSES,
  );

  const result = await listProjectArtifacts({ workspaceId: ctx.operator.workspaceId }, id, {
    limit,
    cursor,
    artifactType,
    status,
  });
  return ok(result.data, ctx.requestId, {
    meta: { nextCursor: result.nextCursor, hasNext: result.nextCursor !== null, limit: result.limit },
  });
});

export const dynamic = "force-dynamic";
