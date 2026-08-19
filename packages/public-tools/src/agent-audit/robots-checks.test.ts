// @input  -- crawl fixtures driven through the real report producer
// @output -- proof A5, 1.2 and 7.5 decide, and refuse to when they cannot
// @pos    -- end-to-end coverage for the checks Batch 2 wired

import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";

import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

function page(
  url: string,
  overrides: Partial<CrawlPageRecord["projection"]> = {},
  depth = 1,
): CrawlPageRecord {
  return {
    subjectUrl: url,
    depth,
    projection: {
      fetchUrl: url,
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      canonicalTarget: url,
      robotsIndexable: true,
      robotsDirectives: [],
      title: `Title for ${url}`,
      metaDescription: `Description for ${url}`,
      h1: ["Heading"],
      headings: ["Heading"],
      wordCount: 320,
      internalOutlinks: [],
      jsonLd: { types: ["WebPage", "BreadcrumbList"], errorCount: 0 },
      sitemapMember: true,
      bodyExcerpt: "Body",
      paragraphs: ["Body"],
      responseMs: 42,
      contentType: "text/html; charset=utf-8",
      ...overrides,
    },
  };
}

type RobotsGroups = SeoAuditRaw["robots"]["groups"];

function raw(overrides: {
  readonly pages?: readonly CrawlPageRecord[];
  readonly robotsFetched?: boolean;
  readonly groups?: RobotsGroups;
  readonly sitemapFetched?: boolean;
  readonly sitemapUrls?: readonly string[];
}): SeoAuditRaw {
  const pages = overrides.pages ?? [
    page("https://acme.test/", {}, 0),
    page("https://acme.test/blog/post"),
  ];
  return {
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: "https://acme.test/blog/post",
    pages,
    robots: {
      fetched: overrides.robotsFetched ?? true,
      groups: overrides.groups ?? [],
      sitemaps: [],
    },
    sitemap: {
      fetched: overrides.sitemapFetched ?? true,
      urlCount: (overrides.sitemapUrls ?? []).length,
      subjectUrls: overrides.sitemapUrls ?? [],
    },
    availability: "available",
    capturedAt: "2026-08-18T00:00:00.000Z",
    sourceWindow: { start: null, end: null },
    stopReason: null,
    providerUsage: {},
    limitation: "",
  } as unknown as SeoAuditRaw;
}

function siteCheck(input: SeoAuditRaw, id: string) {
  const report = buildSeoAuditReport(input);
  return evaluateAgentAuditScope("site", {
    availability: "available",
    records: report.records,
  }).checks.find((entry) => entry.check.id === id);
}

function pageCheck(input: SeoAuditRaw, id: string) {
  const report = buildSeoAuditReport(input);
  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: report.records,
    targetUrl: "https://acme.test/blog/post",
    targetInspected: true,
    inspectedTargetUrl: "https://acme.test/blog/post",
  }).checks.find((entry) => entry.check.id === id);
}

const BLOCKS_GOOGLE: RobotsGroups = [
  { userAgent: "*", disallow: [], allow: ["/"] },
  { userAgent: "Googlebot", disallow: ["/blog"], allow: [] },
];

describe("A5 — sitemap URLs robots.txt blocks", () => {
  it("counts a URL the sitemap declares and robots.txt forbids", () => {
    const result = siteCheck(
      raw({
        groups: BLOCKS_GOOGLE,
        sitemapUrls: ["https://acme.test/", "https://acme.test/blog/post"],
      }),
      "A5",
    );

    expect(result?.result).toBe("blocker");
    expect(result?.evidenceRecordIds).toEqual([
      "sitemap_url_disallowed_by_robots",
    ]);
  });

  it("passes when the sitemap and the file agree", () => {
    expect(
      siteCheck(
        raw({ groups: BLOCKS_GOOGLE, sitemapUrls: ["https://acme.test/"] }),
        "A5",
      )?.result,
    ).toBe("pass");
  });

  it("is excluded, not passed, when robots.txt was never read", () => {
    // A file we could not read forbids nothing, so a naive read would report a
    // clean sitemap on exactly the sites where nothing could be checked.
    const result = siteCheck(
      raw({
        robotsFetched: false,
        sitemapUrls: ["https://acme.test/blog/post"],
      }),
      "A5",
    );

    expect(result?.result).toBe("excluded");
  });

  it("is excluded when no sitemap was collected", () => {
    expect(
      siteCheck(
        raw({ groups: BLOCKS_GOOGLE, sitemapFetched: false }),
        "A5",
      )?.result,
    ).toBe("excluded");
  });

  it("counts URLs the crawl itself never fetched", () => {
    // The point of reading the sitemap instead of the collected pages: our own
    // crawler obeys robots too, so a blocked URL never becomes a page and a
    // page-counting version would report zero on the site that has the problem.
    const result = siteCheck(
      raw({
        pages: [page("https://acme.test/", {}, 0)],
        groups: BLOCKS_GOOGLE,
        sitemapUrls: ["https://acme.test/blog/never-crawled"],
      }),
      "A5",
    );

    expect(result?.result).toBe("blocker");
  });
});

describe("1.5 — included in sitemap", () => {
  it("passes a page that IS in the sitemap", () => {
    // The record declared a conditional subset while iterating every collected
    // page, so the projection refused to read the target's absence from the
    // observations as evidence and answered "not tested" for a page that is
    // correctly listed.
    expect(pageCheck(raw({}), "1.5")?.result).toBe("pass");
  });

  it("is excluded, not failed, when no sitemap was collected", () => {
    expect(
      pageCheck(raw({ sitemapFetched: false }), "1.5")?.result,
    ).toBe("excluded");
  });
});

describe("truncation is not permission", () => {
  it("refuses to judge when a group's rules hit this run's cap", () => {
    // The crawl projection slices each group at 128 rules. A Disallow that
    // fell off the end is indistinguishable from one never written, so the
    // page it forbids came back allowed and two Blocker-capable checks passed.
    const disallow = Array.from({ length: 128 }, (_, i) => `/x${i}`);
    const result = pageCheck(
      raw({ groups: [{ userAgent: "*", disallow, allow: [] }] }),
      "1.2",
    );

    expect(result?.result).toBe("excluded");
  });

  it("refuses to judge A5 when the sitemap hit this run's cap", () => {
    // Members are read in order, so what falls off is a whole late-alphabet
    // branch — exactly the kind of section a site disallows.
    const urls = Array.from(
      { length: 2_000 },
      (_, i) => `https://acme.test/p${i}`,
    );
    const result = siteCheck(
      raw({ groups: BLOCKS_GOOGLE, sitemapUrls: urls }),
      "A5",
    );

    expect(result?.result).toBe("excluded");
  });
});

describe("1.2 — robots.txt allowance for search", () => {
  it("fails the target page when a search-crawler group forbids it", () => {
    expect(
      pageCheck(raw({ groups: BLOCKS_GOOGLE }), "1.2")?.result,
    ).toBe("blocker");
  });

  it("passes when only a different crawler is forbidden", () => {
    expect(
      pageCheck(
        raw({
          groups: [{ userAgent: "AhrefsBot", disallow: ["/blog"], allow: [] }],
        }),
        "1.2",
      )?.result,
    ).toBe("pass");
  });

  it("is excluded when robots.txt was never read", () => {
    expect(
      pageCheck(raw({ robotsFetched: false }), "1.2")?.result,
    ).toBe("excluded");
  });
});

describe("7.5 — BreadcrumbList below the root", () => {
  it("flags a page below the root that declares none", () => {
    const result = pageCheck(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          page("https://acme.test/blog/post", {
            jsonLd: { types: ["WebPage"], errorCount: 0 },
          }),
        ],
      }),
      "7.5",
    );

    expect(result?.result).toBe("tip");
  });

  it("passes a page that declares one", () => {
    expect(pageCheck(raw({}), "7.5")?.result).toBe("pass");
  });

  it("judges the submitted page even though the crawl seeds it at depth 0", () => {
    // "Below the root" is a fact about the URL. Reading it as crawl depth
    // exempted the ONE page the page-scope check is about: the engine enqueues
    // the seed at depth 0 and never lowers it, so a submitted /blog/post with
    // no BreadcrumbList could never fail.
    const seeded = page("https://acme.test/blog/post", {
      jsonLd: { types: ["WebPage"], errorCount: 0 },
    });
    const result = pageCheck(
      raw({
        pages: [
          { ...seeded, depth: 0 },
          page("https://acme.test/", {}, 0),
        ],
      }),
      "7.5",
    );

    expect(result?.result).toBe("tip");
  });

  it("still exempts the origin root at any depth", () => {
    const result = pageCheck(
      raw({
        pages: [
          page("https://acme.test/", { jsonLd: { types: [], errorCount: 0 } }, 3),
          page("https://acme.test/blog/post"),
        ],
      }),
      "7.5",
    );

    expect(result?.result).toBe("pass");
  });

  it("does not judge the homepage", () => {
    // A root page has nothing above it to put in a breadcrumb. Including it
    // would make every correctly-built site fail by exactly one page.
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", { jsonLd: { types: [], errorCount: 0 } }, 0),
        ],
      }),
    );
    const record = report.records.find(
      (entry) => entry.id === "page_without_breadcrumb_list",
    );

    // The record still ran — the root is judged and passes, which is the right
    // verdict for a page that has nothing above it to put in a breadcrumb.
    expect(record?.tested).toBe(1);
    expect(record?.observations).toEqual([]);
    expect(record?.state).toBe("not_observed");
  });
});
