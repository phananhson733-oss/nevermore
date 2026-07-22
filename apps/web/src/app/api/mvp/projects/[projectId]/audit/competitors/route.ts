import { Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectAuditCompetitors } from "@/lib/services/growth-map-competitors";

/** One bounded page of stable Competitor entities and immutable origin lineage. */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    const limit = parseQueryLimit(searchParams);
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
    const result = await listProjectAuditCompetitors(
      { workspaceId: ctx.operator.workspaceId },
      id,
      { limit, cursor },
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
