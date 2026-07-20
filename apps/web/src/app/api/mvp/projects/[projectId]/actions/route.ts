import {
  Cursor,
  type ActionStatus,
  type RoadmapLane,
} from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseOptionalQueryEnum,
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectActions } from "@/lib/services/actions-service";

const ROADMAP_LANES = [
  "now",
  "next",
  "later",
] as const satisfies readonly RoadmapLane[];
const ACTION_STATUSES = [
  "candidate",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "dismissed",
] as const satisfies readonly ActionStatus[];

/** `GET /api/mvp/projects/{projectId}/actions` — the 30/60/90 plan (spec §9.3). */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);

    const searchParams = new URL(request.url).searchParams;
    const lane = parseOptionalQueryEnum(searchParams, "lane", ROADMAP_LANES);
    const status = parseOptionalQueryEnum(
      searchParams,
      "status",
      ACTION_STATUSES,
    );
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
    const limit = parseQueryLimit(searchParams);

    const result = await listProjectActions(
      { workspaceId: ctx.operator.workspaceId },
      id,
      { lane, status, limit, cursor },
    );
    return ok(result.data, ctx.requestId, {
      meta: {
        nextCursor: result.nextCursor,
        hasNext: result.nextCursor !== null,
        limit: result.limit,
      },
    });
  },
);

export const dynamic = "force-dynamic";
