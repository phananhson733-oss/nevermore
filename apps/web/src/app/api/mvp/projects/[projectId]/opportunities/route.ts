import { Cursor } from "@sf/contracts";
import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseQueryLimit, parseQueryValue, parseUuidParam } from "@/lib/http/validate";
import {
  DEFAULT_OPPORTUNITY_PAGE_SIZE,
  listProjectOpportunities,
} from "@/lib/services/opportunities";

/**
 * `GET /api/mvp/projects/{projectId}/opportunities` — one bounded cursor page of
 * traceable Growth Opportunities projected from the latest readable diagnostic
 * run. Read-only: confirmation flows through `PATCH .../findings/{findingId}`.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;

    const limit = parseQueryLimit(searchParams, DEFAULT_OPPORTUNITY_PAGE_SIZE);
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
    const uiLocale = resolveUiLocale(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
    );
    const result = await listProjectOpportunities(
      { workspaceId: ctx.operator.workspaceId, uiLocale },
      id,
      { limit, cursor },
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
