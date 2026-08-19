// @input  -- crawl fixtures where a page's only route in is a redirect hop
// @output -- proof C5 decides, and refuses to when the crawl was bounded
// @pos    -- coverage for the check that separates "no path" from "not seen"

import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";

import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const ORIGIN = "https://acme.test";

function page(
  url: string,
  options: {
    readonly linksTo?: readonly string[];
    readonly sitemapMember?: boolean;
  } = {},
): CrawlPageRecord {
  return {
    subjectUrl: url,
    depth: 1,
    projection: {
      fetchUrl: url,
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      canonicalTarget: url,
      robotsIndexable: true,
      robotsDirectives: [],
      title: `Title ${url}`,
      metaDescription: `Description ${url}`,
      h1: ["Heading"],
      headings: ["Heading"],
      wordCount: 320,
      internalOutlinks: (options.linksTo ?? []).map((target) => ({
        targetSubjectUrl: target,
        anchorText: "link",
        rel: "",
      })),
      jsonLd: { types: ["WebPage"], errorCount: 0 },
      sitemapMember: options.sitemapMember ?? false,
      bodyExcerpt: "Body",
      paragraphs: ["Body"],
      responseMs: 40,
      contentType: "text/html; charset=utf-8",
    },
  } as unknown as CrawlPageRecord;
}

function c5(
  pages: readonly CrawlPageRecord[],
  stopReason: string | null = null,
) {
  const report = buildSeoAuditReport({
    origin: ORIGIN,
    host: "acme.test",
    requestedUrl: `${ORIGIN}/`,
    pages,
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 0, subjectUrls: [] },
    availability: "available",
    capturedAt: "2026-08-19T00:00:00.000Z",
    sourceWindow: { start: null, end: null },
    stopReason,
    providerUsage: {},
    limitation: "",
  } as unknown as SeoAuditRaw);
  return evaluateAgentAuditScope("site", {
    availability: "available",
    records: report.records,
  }).checks.find((entry) => entry.check.id === "C5");
}

const HOME = page(`${ORIGIN}/`, { linksTo: [`${ORIGIN}/about`] });

describe("C5 — pages with no discovery path", () => {
  it("fires on a page reachable by neither a link nor the sitemap", () => {
    expect(c5([HOME, page(`${ORIGIN}/about`), page(`${ORIGIN}/stray`)])?.result).toBe(
      "warning",
    );
  });

  it("passes when every page is linked or listed", () => {
    // The sitemap member has no inbound link, which is C1's finding, not this
    // one. Charging it here would report the same page under two checks.
    expect(
      c5([HOME, page(`${ORIGIN}/about`), page(`${ORIGIN}/listed`, { sitemapMember: true })])
        ?.result,
    ).toBe("pass");
  });

  it("does not count the entry URL as orphaned", () => {
    // Nothing links to the homepage in a crawl of the homepage. Reading that
    // as an orphan would fail every site on its own front page.
    expect(c5([HOME, page(`${ORIGIN}/about`)])?.result).toBe("pass");
  });

  it("refuses to judge a crawl that stopped early", () => {
    // The page that links here may simply not have been fetched. "Nothing
    // links to it" and "we stopped before we got there" are the same shape.
    expect(c5([HOME, page(`${ORIGIN}/stray`)], "max_urls")?.result).toBe("excluded");
  });

  it("refuses to judge when a page's link list was truncated", () => {
    const many = Array.from({ length: 500 }, (_, i) => `${ORIGIN}/n${i}`);
    expect(
      c5([page(`${ORIGIN}/`, { linksTo: many }), page(`${ORIGIN}/stray`)])?.result,
    ).toBe("excluded");
  });
});
