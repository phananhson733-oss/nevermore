// @input  -- synthetic crawl rows, navigation URLs and inspected-target identity
// @output -- proof the five candidate rules are complete, ordered and bounded honestly
// @pos    -- unit guard for the server-side key-page projection

import { describe, expect, it } from "vitest";
import type {
  SeoAuditCrawlTier,
  SeoAuditReport,
} from "@sf/public-tools/seo-audit/types";

import { selectAgentKeyPageCandidates } from "./key-page-candidates.ts";

type Page = SeoAuditReport["pages"][number];

function page(overrides: Partial<Page> & { readonly url: string }): Page {
  return {
    subjectUrl: overrides.url,
    finalUrl: overrides.url,
    depth: 1,
    initialStatus: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html; charset=utf-8",
    robotsDirectiveState: null,
    canonicalTarget: null,
    title: "Title",
    metaDescription: "Description",
    h1Count: 1,
    headingsCount: 3,
    wordCount: 400,
    inboundLinks: 1,
    outboundLinks: 5,
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
    ...overrides,
  } as unknown as Page;
}

const ORIGIN = "https://example.com";

function select({
  pages,
  inspectedTargetUrl = null,
  navigationUrls = [],
  manualUrls = [],
  crawlTier = "key-pages",
}: {
  readonly pages: readonly Page[];
  readonly inspectedTargetUrl?: string | null;
  readonly navigationUrls?: readonly string[];
  readonly manualUrls?: readonly string[];
  readonly crawlTier?: SeoAuditCrawlTier;
}) {
  return selectAgentKeyPageCandidates({
    pages,
    siteOrigin: ORIGIN,
    inspectedTargetUrl,
    navigationUrls,
    manualUrls,
    crawlTier,
  });
}

describe("selectAgentKeyPageCandidates", () => {
  it("drops pages the crawl could not read as 2xx HTML", () => {
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/ok` }),
        page({ url: `${ORIGIN}/gone`, finalStatus: 404 }),
        page({ url: `${ORIGIN}/redirect`, finalStatus: 301 }),
        page({ url: `${ORIGIN}/never`, finalStatus: null }),
        page({ url: `${ORIGIN}/feed.xml`, contentType: "application/xml" }),
      ],
      navigationUrls: [`${ORIGIN}/ok`],
    });

    expect(selection.candidates.map((entry) => entry.url)).toEqual([
      `${ORIGIN}/ok`,
    ]);
    expect(selection.candidates[0]?.reason).toBe("navigation");
    expect(selection.omittedUrls).toEqual([]);
    expect(selection.manualUnavailableUrls).toEqual([]);
  });

  it("keeps one row per subject when a page was reached twice", () => {
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/pricing`, subjectUrl: `${ORIGIN}/pricing` }),
        page({
          url: `${ORIGIN}/pricing?ref=nav`,
          subjectUrl: `${ORIGIN}/pricing`,
        }),
      ],
      navigationUrls: [`${ORIGIN}/pricing`],
    });

    expect(selection.candidates.map((entry) => entry.url)).toEqual([
      `${ORIGIN}/pricing`,
    ]);
  });

  it("chooses the exact inspected target as a subject's stable representative", () => {
    const exactTarget = `${ORIGIN}/pricing/`;
    const rows = [
      page({
        url: `${ORIGIN}/pricing`,
        subjectUrl: `${ORIGIN}/pricing`,
      }),
      page({
        url: exactTarget,
        subjectUrl: `${ORIGIN}/pricing`,
      }),
    ];

    for (const pages of [rows, rows.toReversed()]) {
      const selection = select({ pages, inspectedTargetUrl: exactTarget });
      expect(selection.candidates).toMatchObject([
        { url: exactTarget, reason: "target" },
      ]);
    }
  });

  it("prefers a query-free canonical root and never calls a query root home", () => {
    const rows = [
      page({ url: `${ORIGIN}/`, subjectUrl: `${ORIGIN}/` }),
      page({ url: `${ORIGIN}/?a=1`, subjectUrl: `${ORIGIN}/` }),
    ];

    for (const pages of [rows, rows.toReversed()]) {
      const selection = select({ pages });
      expect(selection.candidates).toMatchObject([
        { url: `${ORIGIN}/`, reason: "home" },
      ]);
    }

    expect(
      select({
        pages: [page({ url: `${ORIGIN}/?a=1` })],
        navigationUrls: [`${ORIGIN}/?a=1`],
      }).candidates,
    ).toMatchObject([{ url: `${ORIGIN}/?a=1`, reason: "navigation" }]);
  });

  it("pins home then target before every other rule", () => {
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/tools/alpha`, inboundLinks: 50 }),
        page({ url: `${ORIGIN}/pricing`, inboundLinks: 2 }),
        page({ url: `${ORIGIN}/`, inboundLinks: 1 }),
        page({ url: `${ORIGIN}/tools/beta` }),
        page({ url: `${ORIGIN}/tools/gamma` }),
      ],
      inspectedTargetUrl: `${ORIGIN}/pricing`,
      navigationUrls: [
        `${ORIGIN}/tools/alpha`,
        `${ORIGIN}/pricing`,
        `${ORIGIN}/`,
      ],
    });

    expect(
      selection.candidates.slice(0, 3).map(({ url, reason }) => ({
        url,
        reason,
      })),
    ).toEqual([
      { url: `${ORIGIN}/`, reason: "home" },
      { url: `${ORIGIN}/pricing`, reason: "target" },
      { url: `${ORIGIN}/tools/alpha`, reason: "navigation" },
    ]);
  });

  it("lists home only once when it is also the submitted page", () => {
    const selection = select({
      pages: [page({ url: `${ORIGIN}/` })],
      inspectedTargetUrl: `${ORIGIN}/`,
      navigationUrls: [`${ORIGIN}/`],
    });

    expect(selection.candidates).toMatchObject([
      { url: `${ORIGIN}/`, reason: "home" },
    ]);
  });

  it("keeps all twenty collected navigation tools without a business cap", () => {
    const navigationUrls = Array.from(
      { length: 20 },
      (_, index) => `${ORIGIN}/tools/tool-${index}`,
    );
    const selection = select({
      pages: navigationUrls.map((url) => page({ url })),
      navigationUrls,
    });

    expect(selection.candidates).toHaveLength(20);
    expect(selection.candidates.map((entry) => entry.url)).toEqual(
      navigationUrls,
    );
    expect(
      selection.candidates.every((entry) => entry.reason === "navigation"),
    ).toBe(true);
  });

  it("lets navigation override the blacklist", () => {
    const selection = select({
      pages: [page({ url: `${ORIGIN}/about` })],
      navigationUrls: [`${ORIGIN}/about`],
    });

    expect(selection.candidates).toMatchObject([
      { url: `${ORIGIN}/about`, reason: "navigation" },
    ]);
  });

  it("places manual pages after home and target while overriding navigation and blacklist", () => {
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/` }),
        page({ url: `${ORIGIN}/submitted` }),
        page({ url: `${ORIGIN}/about` }),
        page({ url: `${ORIGIN}/tools/manual` }),
        page({ url: `${ORIGIN}/tools/beta` }),
        page({ url: `${ORIGIN}/tools/gamma` }),
      ],
      inspectedTargetUrl: `${ORIGIN}/submitted`,
      manualUrls: [`${ORIGIN}/tools/manual`, `${ORIGIN}/about`],
      navigationUrls: [`${ORIGIN}/about`, `${ORIGIN}/tools/manual`],
    });

    expect(
      selection.candidates.slice(0, 4).map(({ url, reason }) => ({
        url,
        reason,
      })),
    ).toEqual([
      { url: `${ORIGIN}/`, reason: "home" },
      { url: `${ORIGIN}/submitted`, reason: "target" },
      { url: `${ORIGIN}/about`, reason: "manual" },
      { url: `${ORIGIN}/tools/manual`, reason: "manual" },
    ]);
    expect(selection.manualUnavailableUrls).toEqual([]);
  });

  it("reports every manual URL that was not collected as 2xx HTML", () => {
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/manual-ok` }),
        page({ url: `${ORIGIN}/manual-gone`, finalStatus: 404 }),
        page({
          url: `${ORIGIN}/manual-feed`,
          contentType: "application/xml",
        }),
      ],
      manualUrls: [
        `${ORIGIN}/manual-missing`,
        `${ORIGIN}/manual-ok`,
        `${ORIGIN}/manual-gone`,
        `${ORIGIN}/manual-feed`,
        `${ORIGIN}/manual-missing`,
      ],
    });

    expect(selection.candidates).toMatchObject([
      { url: `${ORIGIN}/manual-ok`, reason: "manual" },
    ]);
    expect(selection.manualUnavailableUrls).toEqual([
      `${ORIGIN}/manual-feed`,
      `${ORIGIN}/manual-gone`,
      `${ORIGIN}/manual-missing`,
    ]);
  });

  it("keeps every eligible member of a three-to-twenty page cluster", () => {
    const urls = [
      `${ORIGIN}/tools/alpha`,
      `${ORIGIN}/tools/about-page-checker`,
      `${ORIGIN}/tools/gamma`,
    ];
    const selection = select({ pages: urls.map((url) => page({ url })) });

    expect(selection.candidates.map((entry) => entry.url)).toEqual(
      urls.toSorted(),
    );
    expect(selection.candidates.map((entry) => entry.reason)).toEqual(
      urls.map(() => ({ kind: "cluster", prefix: "/tools/" })),
    );
  });

  it("orders cluster prefixes and members identically when crawl rows reverse", () => {
    const rows = ["zeta", "alpha"].flatMap((prefix) =>
      ["z", "a", "m"].map((slug) =>
        page({ url: `${ORIGIN}/${prefix}/${slug}` }),
      ),
    );
    const expected = ["alpha", "zeta"].flatMap((prefix) =>
      ["a", "m", "z"].map((slug) => `${ORIGIN}/${prefix}/${slug}`),
    );

    expect(select({ pages: rows }).candidates.map((entry) => entry.url)).toEqual(
      expected,
    );
    expect(
      select({ pages: rows.toReversed() }).candidates.map((entry) => entry.url),
    ).toEqual(expected);
  });

  it("does not form a cluster from root-level pages", () => {
    const selection = select({
      pages: ["a", "b", "c", "d"].map((slug) =>
        page({ url: `${ORIGIN}/${slug}` }),
      ),
    });

    expect(selection).toEqual({
      candidates: [],
      omittedUrls: [],
      manualUnavailableUrls: [],
    });
  });

  it("publishes nothing when the crawl collected nothing", () => {
    expect(select({ pages: [] })).toEqual({
      candidates: [],
      omittedUrls: [],
      manualUnavailableUrls: [],
    });
  });

  it("publishes every unique collected 2xx HTML page for a full-site run", () => {
    const selection = select({
      crawlTier: "full-site",
      pages: [
        page({ url: `${ORIGIN}/` }),
        page({ url: `${ORIGIN}/about` }),
        page({ url: `${ORIGIN}/lonely` }),
        page({
          url: `${ORIGIN}/lonely?ref=duplicate`,
          subjectUrl: `${ORIGIN}/lonely`,
        }),
        page({ url: `${ORIGIN}/gone`, finalStatus: 404 }),
        page({ url: `${ORIGIN}/feed.xml`, contentType: "application/xml" }),
      ],
    });

    expect(selection.candidates.map(({ url, reason }) => ({ url, reason })))
      .toEqual([
        { url: `${ORIGIN}/`, reason: "home" },
        { url: `${ORIGIN}/about`, reason: "full-site" },
        { url: `${ORIGIN}/lonely`, reason: "full-site" },
      ]);
    expect(selection.omittedUrls).toEqual([]);
  });

  it("applies the blacklist by exact segment and top-level keyword prefix", () => {
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/tools/alpha` }),
        page({ url: `${ORIGIN}/tools/about` }),
        page({ url: `${ORIGIN}/tools/gamma` }),
        page({ url: `${ORIGIN}/tools/delta` }),
        page({ url: `${ORIGIN}/about-us` }),
      ],
    });

    expect(selection.candidates.map((entry) => entry.url)).toEqual([
      `${ORIGIN}/tools/alpha`,
      `${ORIGIN}/tools/delta`,
      `${ORIGIN}/tools/gamma`,
    ]);
    expect(selection.candidates.map((entry) => entry.reason)).toEqual([
      { kind: "cluster", prefix: "/tools/" },
      { kind: "cluster", prefix: "/tools/" },
      { kind: "cluster", prefix: "/tools/" },
    ]);
  });

  it("takes the fifteen highest-inbound blog pages out of eighty", () => {
    const pages = Array.from({ length: 80 }, (_, index) =>
      page({
        url: `${ORIGIN}/blog/post-${String(index).padStart(2, "0")}`,
        inboundLinks: index,
      }),
    );
    const selection = select({ pages });

    expect(selection.candidates).toHaveLength(15);
    expect(selection.candidates.map((entry) => entry.inboundLinks)).toEqual(
      Array.from({ length: 15 }, (_, index) => 79 - index),
    );
    expect(
      selection.candidates.every(
        (entry) =>
          typeof entry.reason === "object" &&
          entry.reason.kind === "content" &&
          entry.reason.inboundLinks === entry.inboundLinks,
      ),
    ).toBe(true);
  });

  it("routes clusters larger than twenty through the content top fifteen", () => {
    const pages = Array.from({ length: 21 }, (_, index) =>
      page({
        url: `${ORIGIN}/catalog/item-${String(index).padStart(2, "0")}`,
        inboundLinks: index,
      }),
    );
    const selection = select({ pages });

    expect(selection.candidates).toHaveLength(15);
    expect(selection.candidates[0]).toMatchObject({
      url: `${ORIGIN}/catalog/item-20`,
      reason: { kind: "content", inboundLinks: 20 },
    });
    expect(
      selection.candidates.every(
        (entry) =>
          typeof entry.reason === "object" &&
          entry.reason.kind === "content",
      ),
    ).toBe(true);
  });

  it("uses an ASCII-stable URL tie-break for equal inbound counts", () => {
    const selection = select({
      pages: [
        ...["z", "a", "A"].map((slug) =>
          page({ url: `${ORIGIN}/blog/${slug}`, inboundLinks: 9 }),
        ),
        ...Array.from({ length: 18 }, (_, index) =>
          page({
            url: `${ORIGIN}/blog/low-${String(index).padStart(2, "0")}`,
            inboundLinks: 1,
          }),
        ),
      ],
    });

    expect(selection.candidates.slice(0, 3).map((entry) => entry.url)).toEqual([
      `${ORIGIN}/blog/A`,
      `${ORIGIN}/blog/a`,
      `${ORIGIN}/blog/z`,
    ]);
  });

  it("only compresses content and reports every safety-valve omission stably", () => {
    const clusterPages = ["agents", "tools"].flatMap((prefix) =>
      Array.from({ length: 20 }, (_, index) =>
        page({
          url: `${ORIGIN}/${prefix}/item-${String(index).padStart(2, "0")}`,
        }),
      ),
    );
    const contentPages = Array.from({ length: 30 }, (_, index) =>
      page({
        url: `${ORIGIN}/blog/post-${String(index).padStart(2, "0")}`,
        inboundLinks: 100 - index,
      }),
    );
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/` }),
        page({ url: `${ORIGIN}/submitted` }),
        ...clusterPages,
        ...contentPages,
      ],
      inspectedTargetUrl: `${ORIGIN}/submitted`,
    });

    expect(selection.candidates).toHaveLength(47);
    expect(
      selection.candidates.filter(
        (entry) =>
          typeof entry.reason === "object" && entry.reason.kind === "cluster",
      ),
    ).toHaveLength(40);
    expect(
      selection.candidates.filter(
        (entry) =>
          typeof entry.reason === "object" && entry.reason.kind === "content",
      ),
    ).toHaveLength(5);
    expect(selection.omittedUrls).toEqual(
      contentPages.slice(5, 15).map((entry) => entry.url),
    );
  });

  it("stops at ten content pages when the first safety-valve step is enough", () => {
    const clusterPages = [
      ...Array.from({ length: 20 }, (_, index) =>
        page({ url: `${ORIGIN}/tools/item-${index}` }),
      ),
      ...Array.from({ length: 15 }, (_, index) =>
        page({ url: `${ORIGIN}/agents/item-${index}` }),
      ),
    ];
    const contentPages = Array.from({ length: 21 }, (_, index) =>
      page({
        url: `${ORIGIN}/blog/post-${String(index).padStart(2, "0")}`,
        inboundLinks: 100 - index,
      }),
    );
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/` }),
        page({ url: `${ORIGIN}/submitted` }),
        ...clusterPages,
        ...contentPages,
      ],
      inspectedTargetUrl: `${ORIGIN}/submitted`,
    });

    expect(selection.candidates).toHaveLength(47);
    expect(
      selection.candidates.filter(
        (entry) =>
          typeof entry.reason === "object" && entry.reason.kind === "cluster",
      ),
    ).toHaveLength(35);
    expect(
      selection.candidates.filter(
        (entry) =>
          typeof entry.reason === "object" && entry.reason.kind === "content",
      ),
    ).toHaveLength(10);
    expect(selection.omittedUrls).toEqual(
      contentPages.slice(10, 15).map((entry) => entry.url),
    );
  });

  it("does not let a later rule overwrite an earlier reason", () => {
    const selection = select({
      pages: [
        page({ url: `${ORIGIN}/` }),
        page({ url: `${ORIGIN}/tools/target` }),
        page({ url: `${ORIGIN}/tools/navigation` }),
        page({ url: `${ORIGIN}/tools/cluster` }),
      ],
      inspectedTargetUrl: `${ORIGIN}/tools/target`,
      navigationUrls: [
        `${ORIGIN}/`,
        `${ORIGIN}/tools/target`,
        `${ORIGIN}/tools/navigation`,
      ],
    });

    expect(
      selection.candidates.map(({ url, reason }) => ({ url, reason })),
    ).toEqual([
      { url: `${ORIGIN}/`, reason: "home" },
      { url: `${ORIGIN}/tools/target`, reason: "target" },
      { url: `${ORIGIN}/tools/navigation`, reason: "navigation" },
      {
        url: `${ORIGIN}/tools/cluster`,
        reason: { kind: "cluster", prefix: "/tools/" },
      },
    ]);
  });

  it("publishes the fetch URL and exactly the six reviewed candidate fields", () => {
    const selection = select({
      pages: [
        page({
          url: `${ORIGIN}/pricing?ref=nav`,
          subjectUrl: `${ORIGIN}/pricing`,
        }),
      ],
      navigationUrls: [`${ORIGIN}/pricing`],
    });
    const [candidate] = selection.candidates;

    expect(candidate?.url).toBe(`${ORIGIN}/pricing?ref=nav`);
    expect(Object.keys(candidate ?? {}).toSorted()).toEqual([
      "depth",
      "inboundLinks",
      "metaDescription",
      "reason",
      "title",
      "url",
    ]);
  });
});
