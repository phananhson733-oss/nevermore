import { Cursor, Uuid } from "@sf/contracts";
import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
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
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GrowthMapDiagnosticRunId = Uuid.refine((value) =>
  CANONICAL_UUID.test(value),
);
const GROWTH_MAP_URL_LIST_QUERY = new Set([
  "limit",
  "cursor",
  "search",
  "diagnosticRunId",
]);

function queryPointer(name: string): string {
  return `/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function assertGrowthMapUrlListQuery(searchParams: URLSearchParams): void {
  for (const key of searchParams.keys()) {
    if (GROWTH_MAP_URL_LIST_QUERY.has(key)) continue;
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Query parameter failed validation.",
      {
        errors: [
          {
            pointer: queryPointer(key),
            code: "unknown_query_parameter",
            message: "Unknown query parameter.",
          },
        ],
      },
    );
  }
}

/**
 * `GET /api/mvp/projects/{projectId}/audit/urls` — one bounded page of
 * canonical SitePages from the latest or one exact published Growth Map
 * generation.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    assertGrowthMapUrlListQuery(searchParams);

    const limit = parseQueryLimit(searchParams);
    const cursor = parseQueryValue(searchParams, "cursor", Cursor);
    const search = parseQueryValue(searchParams, "search", GrowthMapSearch);
    const diagnosticRunId = parseQueryValue(
      searchParams,
      "diagnosticRunId",
      GrowthMapDiagnosticRunId,
    );
    const uiLocale = resolveUiLocale(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
    );
    const result = await listProjectAuditUrls(
      { workspaceId: ctx.operator.workspaceId, uiLocale },
      id,
      { limit, cursor, search, diagnosticRunId },
    );

    // Keep the complete versioned GrowthMapUrlPortfolioResponse intact inside
    // the repository-wide success envelope. Its scope and internal meta are
    // part of the read model and must not be reconstructed by the browser.
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
