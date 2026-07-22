import { Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectAuditKeywords } from "@/lib/services/growth-map-keywords";

/** One bounded page of stable Keyword entities and immutable source lineage. */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    const limit = parseQueryLimit(searchParams);
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
    const result = await listProjectAuditKeywords(
      { workspaceId: ctx.operator.workspaceId },
      id,
      { limit, cursor },
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
