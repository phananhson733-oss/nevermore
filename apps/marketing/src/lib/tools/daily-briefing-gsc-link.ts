// @input  -- the property, exact metric scope, and observed reporting dates
// @output -- a Search Console link with the same exact filters as the evidence
// @pos    -- browser verification entrypoint; never proof a browser check occurred

export type DailyBriefingMetricScope = "query" | "query_page" | "page" | "property";

export function dailyBriefingGscLink({ property, window, scope, query, page }: {
  readonly property: string;
  readonly window: { readonly startDate: string; readonly endDate: string } | null;
  readonly scope: DailyBriefingMetricScope;
  readonly query: string | null;
  readonly page: string | null;
}): string | null {
  if (window === null) return null;
  if ((scope === "query" || scope === "query_page") && !query) return null;
  if ((scope === "page" || scope === "query_page") && !page) return null;
  const params = new URLSearchParams({
    resource_id: property,
    time_granularity: "DAY",
    start_date: window.startDate.replaceAll("-", ""),
    end_date: window.endDate.replaceAll("-", ""),
  });
  // Search Console uses ! for exact matches and + for contains. In
  // particular a query total must never acquire a page filter from attribution.
  if (scope === "query" || scope === "query_page") params.set("query", `!${query}`);
  if (scope === "page" || scope === "query_page") params.set("page", `!${page}`);
  return `https://search.google.com/search-console/performance/search-analytics?${params}`;
}
