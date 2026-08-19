// @input  -- the two fixtures D1's published launch gate names
// @output -- proof the detector fires on a real duplicate and not on a variant
// @pos    -- the P6 gate for D1, executed rather than asserted in prose

import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";

import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

function page(
  url: string,
  title: string,
  canonicalTarget: string = url,
): CrawlPageRecord {
  return {
    subjectUrl: url,
    depth: 1,
    projection: {
      fetchUrl: url,
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      canonicalTarget,
      robotsIndexable: true,
      robotsDirectives: [],
      title,
      metaDescription: `Description for ${url}`,
      h1: ["Heading"],
      headings: ["Heading"],
      wordCount: 320,
      internalOutlinks: [],
      jsonLd: { types: ["WebPage"], errorCount: 0 },
      sitemapMember: true,
      bodyExcerpt: "Body",
      paragraphs: ["Body"],
      responseMs: 40,
      contentType: "text/html; charset=utf-8",
    },
  };
}

function d1(pages: readonly CrawlPageRecord[]) {
  const report = buildSeoAuditReport({
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: "https://acme.test/",
    pages,
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 0, subjectUrls: [] },
    availability: "available",
    capturedAt: "2026-08-18T00:00:00.000Z",
    sourceWindow: { start: null, end: null },
    stopReason: null,
    providerUsage: {},
    limitation: "",
  } as unknown as SeoAuditRaw);
  return evaluateAgentAuditScope("site", {
    availability: "available",
    records: report.records,
  }).checks.find((entry) => entry.check.id === "D1");
}

/** Fifty distinct pages, so a single duplicate pair lands near the 2% mark. */
const DISTINCT = Array.from({ length: 50 }, (_, i) =>
  page(`https://acme.test/p${i}`, `Page ${i}`),
);

describe("D1 launch gate", () => {
  it("KNOWN TRUE POSITIVE: two self-canonical pages sharing one title", () => {
    // Two genuinely separate pages competing for the same result. Nothing about
    // them says they are the same page, which is what makes this a real finding
    // rather than a canonical problem.
    const result = d1([
      ...DISTINCT.slice(0, 20),
      page("https://acme.test/shoes", "Running shoes"),
      page("https://acme.test/sneakers", "Running shoes"),
    ]);

    expect(result?.result).toBe("warning");
  });

  it("KNOWN FALSE POSITIVE: variants that already converge on a canonical", () => {
    // A filtered listing and its sort variants carry the same title on purpose
    // and point at one canonical. Counting them is the false positive the gate
    // exists to prevent: the site did the right thing and would be told it did
    // the wrong thing, on a check whose fix is to edit forty titles.
    const result = d1([
      ...DISTINCT,
      page("https://acme.test/shop", "Shop"),
      page("https://acme.test/shop?sort=price", "Shop", "https://acme.test/shop"),
      page("https://acme.test/shop?sort=new", "Shop", "https://acme.test/shop"),
      page("https://acme.test/shop?page=2", "Shop", "https://acme.test/shop"),
    ]);

    expect(result?.result).toBe("pass");
  });

  it("passes just under the published 2% mark and fails just over it", () => {
    // One duplicate pair among 100 pages is 2%, which the published rule
    // reports; the same pair among 200 is 1% and does not.
    const wide = Array.from({ length: 200 }, (_, i) =>
      page(`https://acme.test/w${i}`, `W ${i}`),
    );
    const pair = [
      page("https://acme.test/a", "Same"),
      page("https://acme.test/b", "Same"),
    ];

    expect(d1([...wide, ...pair])?.result).toBe("pass");
    expect(d1([...wide.slice(0, 98), ...pair])?.result).toBe("warning");
  });

  it("is excluded rather than passed when no page carried a title", () => {
    const result = d1([
      { ...page("https://acme.test/x", ""), projection: { ...page("https://acme.test/x", "").projection, title: null } },
    ]);

    expect(result?.result).toBe("excluded");
  });
});
