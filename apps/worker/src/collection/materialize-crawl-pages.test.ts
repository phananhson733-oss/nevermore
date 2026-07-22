import { describe, expect, it, vi } from "vitest";
import {
  contentHash,
  PageSnapshotsRepository,
  SitePagesRepository,
} from "@sf/db";
import {
  CRAWL_PROJECTION_LIMITS,
  type Availability,
  type SourceWindow,
} from "@sf/sources";
import {
  CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
  materializePreparedCrawlPages,
  prepareCrawlPageMaterialization,
  type CrawlPageMaterializationOutcome,
} from "./materialize-crawl-pages.ts";

const capturedAt = "2026-07-19T00:00:00.000Z";
const sourceWindow = {
  start: "2026-07-18T00:00:00.000Z",
  end: capturedAt,
} satisfies SourceWindow;
const expectedSite = {
  origin: "https://example.com",
  host: "example.com",
} as const;
const providerUsage = {
  urlsFetched: 3,
  pagesCollected: 1,
  urlsSkipped: 0,
  urlsBlocked: 0,
  urlsDisallowed: 0,
  urlsErrored: 0,
  redirectsFollowed: 1,
  bytesFetched: 2048,
  robotsFetched: 1,
  sitemapUrlCount: 1,
};
const projection = {
  fetchUrl: "https://example.com/pricing/",
  status: 301,
  finalStatus: 200,
  redirectChain: ["https://example.com/pricing/"],
  canonicalTarget: "https://example.com/pricing",
  robotsIndexable: true,
  robotsDirectives: ["index", "follow"],
  title: "Pricing",
  metaDescription: "Plans for growing teams.",
  h1: ["Pricing"],
  headings: ["Pricing", "Enterprise"],
  wordCount: 318,
  internalOutlinks: [
    {
      targetSubjectUrl: "https://example.com/contact",
      rel: "nofollow",
      anchorText: "Contact sales",
    },
  ],
  jsonLd: { types: ["Product"], errorCount: 0 },
  sitemapMember: true,
  bodyExcerpt: "Plans for growing teams.",
  paragraphs: ["Start with the plan that fits your team."],
  responseMs: 37,
  contentType: "text/html; charset=utf-8",
} as const;

function makeOutcome(
  availability: Availability = "available",
): CrawlPageMaterializationOutcome {
  const limitation =
    availability === "partial" ? "fixture partial crawl" : "fixture crawl";
  const stopReason = availability === "partial" ? "max_urls" : null;
  return {
    availability,
    capturedAt,
    sourceWindow,
    rowCount: 1,
    stopReason,
    providerUsage,
    limitation,
    raw: {
      origin: "https://example.com",
      host: "example.com",
      pages: [
        {
          subjectUrl: "https://example.com/pricing",
          depth: 1,
          projection,
        },
      ],
      robots: {
        fetched: true,
        groups: [
          { userAgent: "*", disallow: ["/private"], allow: ["/"] },
        ],
        sitemaps: ["https://example.com/sitemap.xml"],
      },
      sitemap: {
        fetched: true,
        urlCount: 1,
        subjectUrls: ["https://example.com/pricing"],
      },
      availability,
      capturedAt,
      sourceWindow,
      stopReason,
      providerUsage,
      limitation,
    },
  };
}

describe("prepareCrawlPageMaterialization", () => {
  it.each(["available", "partial"] as const)(
    "builds one bounded, versioned, content-addressed extract for a %s crawl",
    (availability) => {
      const result = prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: makeOutcome(availability),
        expectedSite,
      });

      expect(result).toEqual([
        {
          normalizedUrl: "https://example.com/pricing/",
          contentHash: contentHash({
            schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
            subjectUrl: "https://example.com/pricing",
            depth: 1,
            projection,
          }),
          extract: {
            schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
            subjectUrl: "https://example.com/pricing",
            depth: 1,
            projection,
          },
        },
      ]);
    },
  );

  it("returns no prepared pages for non-crawl providers without interpreting their raw shape", () => {
    expect(
      prepareCrawlPageMaterialization({
        provider: "ga4",
        outcome: { ...makeOutcome(), raw: { rows: [{ arbitrary: true }] } },
      }),
    ).toEqual([]);
  });

  it.each([
    ["origin", { origin: "https://foreign.example", host: "foreign.example" }],
    ["host", { origin: "https://example.com", host: "other.example" }],
  ] as const)(
    "rejects a self-consistent crawl whose %s differs from the trusted Site row",
    (_name, foreignSite) => {
      expect(() =>
        prepareCrawlPageMaterialization({
          provider: "crawl",
          outcome: makeOutcome(),
          expectedSite: foreignSite,
        }),
      ).toThrow("Crawl raw payload does not match its collection outcome.");
    },
  );

  it("rejects unavailable crawl claims that contain collected pages", () => {
    expect(() =>
      prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: makeOutcome("unavailable"),
        expectedSite,
      }),
    ).toThrow("Crawl raw payload does not match its collection outcome.");
  });

  it("rejects unavailable crawl claims with positive pagesCollected even when pages are empty", () => {
    const outcome = makeOutcome("unavailable");
    const raw = outcome.raw as Record<string, unknown>;

    expect(() =>
      prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: {
          ...outcome,
          rowCount: 0,
          raw: { ...raw, pages: [] },
        },
        expectedSite,
      }),
    ).toThrow("Crawl raw payload does not match its collection outcome.");
  });

  it("accepts an honest unavailable crawl with no page facts", () => {
    const outcome = makeOutcome("unavailable");
    const raw = outcome.raw as Record<string, unknown>;
    const emptyUsage = {
      urlsFetched: 0,
      pagesCollected: 0,
      urlsSkipped: 0,
      urlsBlocked: 3,
      urlsDisallowed: 0,
      urlsErrored: 0,
      redirectsFollowed: 0,
      bytesFetched: 0,
      robotsFetched: 0,
      sitemapUrlCount: 0,
    };

    expect(
      prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: {
          ...outcome,
          rowCount: 0,
          providerUsage: emptyUsage,
          raw: {
            ...raw,
            pages: [],
            robots: { fetched: false, groups: [], sitemaps: [] },
            sitemap: { fetched: false, urlCount: 0, subjectUrls: [] },
            providerUsage: emptyUsage,
          },
        },
        expectedSite,
      }),
    ).toEqual([]);
  });

  it.each([
    ["capturedAt", { capturedAt: "2026-07-19T00:00:01.000Z" }],
    ["availability", { availability: "partial" }],
    [
      "sourceWindow",
      {
        sourceWindow: {
          start: "2026-07-18T00:00:00.000Z",
          end: "2026-07-19T00:00:01.000Z",
        },
      },
    ],
  ] as const)("rejects %s drift between raw and CollectionOutcome", (_name, drift) => {
    const outcome = makeOutcome();
    const raw = outcome.raw as Record<string, unknown>;

    expect(() =>
      prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: { ...outcome, raw: { ...raw, ...drift } },
        expectedSite,
      }),
    ).toThrow("Crawl raw payload does not match its collection outcome.");
  });

  it.each([
    ["page count", (outcome: CrawlPageMaterializationOutcome) => ({ ...outcome, rowCount: 2 })],
    [
      "provider usage",
      (outcome: CrawlPageMaterializationOutcome) => ({
        ...outcome,
        providerUsage: { ...outcome.providerUsage, pagesCollected: 2 },
      }),
    ],
    [
      "stop reason",
      (outcome: CrawlPageMaterializationOutcome) => ({
        ...outcome,
        stopReason: "max_duration",
      }),
    ],
    [
      "limitation",
      (outcome: CrawlPageMaterializationOutcome) => ({
        ...outcome,
        limitation: "different claim",
      }),
    ],
  ] as const)("rejects %s drift from the raw crawl contract", (_name, mutate) => {
    expect(() =>
      prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: mutate(makeOutcome()),
        expectedSite,
      }),
    ).toThrow("Crawl raw payload does not match its collection outcome.");
  });

  it("rejects malformed or unbounded page projections instead of truncating or claiming them", () => {
    const outcome = makeOutcome();
    const raw = outcome.raw as {
      pages: readonly [{ projection: typeof projection }];
    };
    const oversized = {
      ...raw.pages[0].projection,
      title: "x".repeat(CRAWL_PROJECTION_LIMITS.maxTitleChars + 1),
    };

    expect(() =>
      prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: {
          ...outcome,
          raw: {
            ...(outcome.raw as Record<string, unknown>),
            pages: [{ ...raw.pages[0], projection: oversized }],
          },
        },
        expectedSite,
      }),
    ).toThrow("Crawl raw payload does not match its collection outcome.");
  });

  it("rejects duplicate exact fetch identities and non-canonical page identities", () => {
    const outcome = makeOutcome();
    const raw = outcome.raw as Record<string, unknown> & {
      pages: readonly Record<string, unknown>[];
    };
    const duplicateRaw = {
      ...raw,
      pages: [...raw.pages, raw.pages[0]],
    };
    const nonCanonicalRaw = {
      ...raw,
      pages: [
        {
          ...raw.pages[0],
          subjectUrl: "https://EXAMPLE.com/pricing/?utm_source=test",
        },
      ],
    };

    for (const invalidRaw of [duplicateRaw, nonCanonicalRaw]) {
      expect(() =>
        prepareCrawlPageMaterialization({
          provider: "crawl",
          outcome: {
            ...outcome,
            rowCount: invalidRaw.pages.length,
            raw: invalidRaw,
          },
          expectedSite,
        }),
      ).toThrow("Crawl raw payload does not match its collection outcome.");
    }
  });

  it("keeps two exact fetch identities that intentionally share one aggregation subject", () => {
    const outcome = makeOutcome();
    const raw = outcome.raw as Record<string, unknown> & {
      pages: readonly [{
        subjectUrl: string;
        depth: number;
        projection: typeof projection;
      }];
    };
    const slashVariant = {
      ...raw.pages[0],
      projection: {
        ...raw.pages[0].projection,
        fetchUrl: "https://example.com/pricing",
        status: 200,
        redirectChain: [],
      },
    };
    const pages = [raw.pages[0], slashVariant];
    const usage = { ...outcome.providerUsage, pagesCollected: 2 };

    const prepared = prepareCrawlPageMaterialization({
      provider: "crawl",
      outcome: {
        ...outcome,
        rowCount: 2,
        providerUsage: usage,
        raw: {
          ...raw,
          pages,
          providerUsage: usage,
        },
      },
      expectedSite,
    });

    expect(prepared.map((page) => page.normalizedUrl)).toEqual([
      "https://example.com/pricing",
      "https://example.com/pricing/",
    ]);
    expect(new Set(prepared.map((page) => page.extract.subjectUrl))).toEqual(
      new Set(["https://example.com/pricing"]),
    );
  });

  it("keeps the initial request identity separate from its terminal redirect journey", () => {
    const outcome = makeOutcome();
    const raw = outcome.raw as Record<string, unknown> & {
      pages: readonly Record<string, unknown>[];
    };
    const pages = [
      {
        ...raw.pages[0],
        projection: {
          ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
          status: 301,
          finalStatus: 200,
          redirectChain: ["https://example.com/plans"],
        },
      },
    ];

    const [prepared] = prepareCrawlPageMaterialization({
      provider: "crawl",
      outcome: { ...outcome, raw: { ...raw, pages } },
      expectedSite,
    });

    expect(prepared).toMatchObject({
      normalizedUrl: "https://example.com/pricing/",
      extract: {
        subjectUrl: "https://example.com/pricing",
        projection: {
          fetchUrl: "https://example.com/pricing/",
          status: 301,
          finalStatus: 200,
          redirectChain: ["https://example.com/plans"],
        },
      },
    });
  });

  it.each([
    [
      "page with unavailable HTTP status hidden inside an available row",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        pages: [
          {
            ...raw.pages[0],
            projection: {
              ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
              status: null,
              finalStatus: null,
            },
          },
        ],
      }),
    ],
    [
      "redirect chain attached to a non-redirect initial response",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        pages: [
          {
            ...raw.pages[0],
            projection: {
              ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
              status: 200,
              finalStatus: 200,
              redirectChain: ["https://example.com/plans"],
            },
          },
        ],
      }),
    ],
    [
      "indexability flag that contradicts the observed robots directives",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        pages: [
          {
            ...raw.pages[0],
            projection: {
              ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
              robotsIndexable: true,
              robotsDirectives: ["noindex"],
            },
          },
        ],
      }),
    ],
    [
      "cross-origin redirect",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        pages: [
          {
            ...raw.pages[0],
            projection: {
              ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
              redirectChain: ["https://attacker.example/redirect"],
            },
          },
        ],
      }),
    ],
    [
      "non-canonical redirect",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        pages: [
          {
            ...raw.pages[0],
            projection: {
              ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
              redirectChain: [
                "https://EXAMPLE.com/plans/?utm_source=redirect",
              ],
            },
          },
        ],
      }),
    ],
    [
      "cross-origin sitemap subject",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        sitemap: {
          fetched: true,
          urlCount: 1,
          subjectUrls: ["https://attacker.example/pricing"],
        },
      }),
    ],
    [
      "non-canonical sitemap subject",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        sitemap: {
          fetched: true,
          urlCount: 1,
          subjectUrls: ["https://EXAMPLE.com/pricing/?utm_source=sitemap"],
        },
      }),
    ],
    [
      "cross-origin internal link",
      (raw: Record<string, unknown> & { pages: readonly Record<string, unknown>[] }) => ({
        ...raw,
        pages: [
          {
            ...raw.pages[0],
            projection: {
              ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
              internalOutlinks: [
                {
                  targetSubjectUrl: "https://attacker.example/contact",
                  rel: null,
                  anchorText: "Contact",
                },
              ],
            },
          },
        ],
      }),
    ],
  ] as const)("rejects a %s in crawl lineage", (_name, mutate) => {
    const outcome = makeOutcome();
    const raw = outcome.raw as Record<string, unknown> & {
      pages: readonly Record<string, unknown>[];
    };
    expect(() =>
      prepareCrawlPageMaterialization({
        provider: "crawl",
        outcome: { ...outcome, raw: mutate(raw) },
        expectedSite,
      }),
    ).toThrow("Crawl raw payload does not match its collection outcome.");
  });

  it.each([
    null,
    "https://example.com/pricing",
    "https://example.com/pricing/",
    "https://publisher.example/original-pricing",
  ] as const)(
    "retains a %s canonical target as an observed URL fact without treating it as a crawl target",
    (canonicalTarget) => {
      const outcome = makeOutcome();
      const raw = outcome.raw as Record<string, unknown> & {
        pages: readonly Record<string, unknown>[];
      };
      const pages = [
        {
          ...raw.pages[0],
          projection: {
            ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
            canonicalTarget,
          },
        },
      ];

      expect(
        prepareCrawlPageMaterialization({
          provider: "crawl",
          outcome: { ...outcome, raw: { ...raw, pages } },
          expectedSite,
        }),
      ).toHaveLength(1);
    },
  );

  it("produces identical prepared values when the same immutable crawl is replayed", () => {
    const first = prepareCrawlPageMaterialization({
      provider: "crawl",
      outcome: makeOutcome(),
      expectedSite,
    });
    const second = prepareCrawlPageMaterialization({
      provider: "crawl",
      outcome: makeOutcome(),
      expectedSite,
    });

    expect(second).toEqual(first);
  });
});

describe("materializePreparedCrawlPages", () => {
  it("upserts stable identities and creates append-only snapshots against the exact DataSnapshot", async () => {
    const upsert = vi
      .spyOn(SitePagesRepository.prototype, "upsertNormalizedUrl")
      .mockResolvedValue({ id: "site-page-1" } as never);
    const create = vi
      .spyOn(PageSnapshotsRepository.prototype, "create")
      .mockResolvedValue({ id: "page-snapshot-1" } as never);
    const prepared = prepareCrawlPageMaterialization({
      provider: "crawl",
      outcome: makeOutcome("partial"),
      expectedSite,
    });

    await materializePreparedCrawlPages({} as never, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      siteId: "site-1",
      dataSnapshotId: "snapshot-1",
      capturedAt,
      pages: prepared,
    });

    expect(upsert).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      projectId: "project-1",
      siteId: "site-1",
      normalizedUrl: prepared[0]!.normalizedUrl,
      templateKey: null,
    });
    expect(create).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      projectId: "project-1",
      sitePageId: "site-page-1",
      dataSnapshotId: "snapshot-1",
      contentHash: prepared[0]!.contentHash,
      extract: prepared[0]!.extract,
      capturedAt,
    });
  });
});
