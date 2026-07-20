import { Cursor } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseOptionalQueryEnum,
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { listProjectSnapshots } from "@/lib/services/snapshots";

const PROVIDERS = ["crawl", "gsc", "ga4", "csv", "dataforseo"] as const;

/** `GET /api/mvp/projects/{projectId}/snapshots` — keyset page of snapshots (spec §11.2). */
export const GET = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);

  const url = new URL(request.url);
  const cursor = parseQueryValue(url.searchParams, "cursor", Cursor);
  const limit = parseQueryLimit(url.searchParams);
  const provider = parseOptionalQueryEnum(
    url.searchParams,
    "provider",
    PROVIDERS,
  );

  const result = await listProjectSnapshots(
    { workspaceId: ctx.operator.workspaceId },
    id,
    { limit, cursor, provider },
  );
  return ok(result.data, ctx.requestId, {
    meta: {
      nextCursor: result.nextCursor,
      hasNext: result.nextCursor !== null,
      limit: result.limit,
    },
  });
});

export const dynamic = "force-dynamic";
