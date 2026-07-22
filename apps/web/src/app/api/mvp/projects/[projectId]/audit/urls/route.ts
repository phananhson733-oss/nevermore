import { Cursor } from "@sf/contracts";
import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { z } from "zod";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import {
  listProjectAuditUrls,
  MAX_GROWTH_MAP_SEARCH_LENGTH,
} from "@/lib/services/growth-map";

/** A bounded customer-entered canonical URL search term. */
const GrowthMapSearch = z
  .string()
  .trim()
  .min(1)
  .max(MAX_GROWTH_MAP_SEARCH_LENGTH);

/**
 * `GET /api/mvp/projects/{projectId}/audit/urls` — one bounded, current-run
 * page of canonical SitePages and their immutable Growth Map provenance.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;

    const limit = parseQueryLimit(searchParams);
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
    const search = parseQueryValue(searchParams, "search", GrowthMapSearch);
    const uiLocale = resolveUiLocale(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
    );
    const result = await listProjectAuditUrls(
      { workspaceId: ctx.operator.workspaceId, uiLocale },
      id,
      { limit, cursor, search },
    );

    // Keep the complete versioned GrowthMapUrlPortfolioResponse intact inside
    // the repository-wide success envelope. Its scope and internal meta are
    // part of the read model and must not be reconstructed by the browser.
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
