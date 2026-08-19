// @input  -- Search Console page rows joined against the crawl's own statuses
// @output -- proof A2 decides, and refuses on the population it cannot resolve
// @pos    -- coverage for the check that needed no new API call

import { describe, expect, it } from "vitest";

import {
  buildSearchPerformanceRecords,
  type SearchPerformanceRaw,
} from "../seo-audit/search-performance.ts";
import type { SeoAuditPage } from "../seo-audit/types.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const ORIGIN = "https://acme.test";

function page(
  path: string,
  finalStatus: number | null,
  redirectHops = 0,
): SeoAuditPage {
  return {
    url: `${ORIGIN}${path}`,
    subjectUrl: `${ORIGIN}${path}`,
    finalUrl: `${ORIGIN}${path}`,
    depth: 1,
    initialStatus: finalStatus,
    finalStatus,
    redirectHops,
    contentType: "text/html; charset=utf-8",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: `${ORIGIN}${path}`,
    title: "T",
    metaDescription: "D",
    h1Count: 1,
    headingsCount: 1,
    wordCount: 300,
    inboundLinks: 1,
    outboundLinks: 1,
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
  } as unknown as SeoAuditPage;
}

function raw(
  rows: readonly { path: string; impressions: number }[],
  pagesTruncated = false,
): SearchPerformanceRaw {
  return {
    property: `sc-domain:acme.test`,
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    pages: rows.map((row) => ({
      key: `${ORIGIN}${row.path}`,
      clicks: 0,
      impressions: row.impressions,
      position: 8,
    })),
    queries: [],
    pagesTruncated,
    queriesTruncated: false,
    targetPageQueries: null,
    targetPageUrl: null,
    confirmedQueries: [],
    targetPageQueriesTruncated: false,
  };
}

function a2(
  rows: readonly { path: string; impressions: number }[],
  pages: readonly SeoAuditPage[],
  pagesTruncated = false,
) {
  return evaluateAgentAuditScope("site", {
    availability: "available",
    records: buildSearchPerformanceRecords(raw(rows, pagesTruncated), pages),
  }).checks.find((entry) => entry.check.id === "A2");
}

const LIVE = [page("/a", 200), page("/b", 200), page("/c", 200)];

describe("A2 — impressions on URLs the site no longer serves", () => {
  it("passes a site whose ranking URLs all still resolve", () => {
    expect(
      a2(
        [
          { path: "/a", impressions: 900 },
          { path: "/b", impressions: 100 },
        ],
        LIVE,
      )?.result,
    ).toBe("pass");
  });

  it("reaches Blocker past the published 20% mark", () => {
    expect(
      a2(
        [
          { path: "/a", impressions: 700 },
          { path: "/gone", impressions: 300 },
        ],
        [...LIVE, page("/gone", 410)],
      )?.result,
    ).toBe("blocker");
  });

  it("counts a redirect as abandoned", () => {
    // The rule is about impressions spent on a URL that is no longer the page.
    // A 301 is exactly that: the result still costs the visitor a hop.
    expect(
      a2(
        [
          { path: "/a", impressions: 700 },
          { path: "/moved", impressions: 300 },
        ],
        [...LIVE, page("/moved", 200, 1)],
      )?.result,
    ).toBe("blocker");
  });

  it("leaves a URL the crawl never reached out of both halves", () => {
    // "The site dropped it" and "our bounded crawl did not reach it" produce
    // the identical row. Counting it as abandoned would fail every site with
    // deep pagination the crawl skips by design. With the unresolved share
    // small, the rest of the property can still be judged.
    expect(
      a2(
        [
          { path: "/a", impressions: 900 },
          { path: "/never-crawled", impressions: 50 },
        ],
        LIVE,
      )?.result,
    ).toBe("pass");
  });

  it("refuses when too much of the property never resolved to a crawled page", () => {
    // A retired URL is by definition no longer linked, so it is exactly what a
    // bounded crawl misses. Dropping those impressions from both halves and
    // publishing the rest computes the share over the pages that are still
    // alive — and a site whose dead URLs hold most of its impressions reads
    // as 0% abandoned, which is the failure this check exists to find.
    expect(
      a2(
        [
          { path: "/a", impressions: 300 },
          { path: "/never-crawled", impressions: 700 },
        ],
        LIVE,
      )?.result,
    ).toBe("excluded");
  });

  it("refuses to judge when the row list hit its cap", () => {
    // Rows come back ordered by clicks, so a cap drops the long tail — and the
    // tail is exactly where retired URLs live. The share would be computed over
    // the healthy head and report the site as cleaner than it is.
    expect(
      a2(
        [
          { path: "/a", impressions: 700 },
          { path: "/gone", impressions: 300 },
        ],
        [...LIVE, page("/gone", 404)],
        true,
      )?.result,
    ).toBe("excluded");
  });

  it("does not judge a property with no impressions at all", () => {
    expect(a2([{ path: "/a", impressions: 0 }], LIVE)?.result).toBe("excluded");
  });
});
