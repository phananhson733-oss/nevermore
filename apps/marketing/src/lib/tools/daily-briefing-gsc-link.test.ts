import { describe, expect, it } from "vitest";
import { dailyBriefingGscLink } from "./daily-briefing-gsc-link.ts";

const window = { startDate: "2026-08-21", endDate: "2026-08-27" };
const property = "sc-domain:dramashortstv.com";

describe("Daily Briefing exact Search Console evidence links", () => {
  it("preserves exact query text and dates without adding the attributed page to query totals", () => {
    const href = dailyBriefingGscLink({
      property, window, scope: "query", query: "великият + мощъщ & джин",
      page: "https://dramashortstv.com/an-attributed-page",
    });
    expect(href).not.toBeNull();
    const url = new URL(href!);
    expect(url.origin + url.pathname).toBe("https://search.google.com/search-console/performance/search-analytics");
    expect(url.searchParams.get("resource_id")).toBe(property);
    expect(url.searchParams.get("query")).toBe("!великият + мощъщ & джин");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.get("start_date")).toBe("20260821");
    expect(url.searchParams.get("end_date")).toBe("20260827");
    expect(url.searchParams.get("time_granularity")).toBe("DAY");
  });

  it("applies both exact filters only to query-page metrics", () => {
    const page = "https://dramashortstv.com/watch?episode=2&lang=bg";
    const href = dailyBriefingGscLink({ property, window, scope: "query_page", query: "drama", page });
    const params = new URL(href!).searchParams;
    expect(params.get("query")).toBe("!drama");
    expect(params.get("page")).toBe(`!${page}`);
  });

  it("keeps page and property metrics in their own scopes", () => {
    const page = "https://dramashortstv.com/watch";
    const pageParams = new URL(dailyBriefingGscLink({ property, window, scope: "page", query: null, page })!).searchParams;
    expect(pageParams.get("page")).toBe(`!${page}`);
    expect(pageParams.has("query")).toBe(false);
    const propertyParams = new URL(dailyBriefingGscLink({ property, window, scope: "property", query: null, page: null })!).searchParams;
    expect(propertyParams.has("query")).toBe(false);
    expect(propertyParams.has("page")).toBe(false);
  });

  it("does not broaden an incomplete evidence identity", () => {
    expect(dailyBriefingGscLink({ property, window, scope: "query_page", query: "drama", page: null })).toBeNull();
    expect(dailyBriefingGscLink({ property, window: null, scope: "query", query: "drama", page: null })).toBeNull();
    expect(dailyBriefingGscLink({ property, window, scope: "query", query: null, page: null })).toBeNull();
  });
});
