import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";
import { buildSeoAuditPayload, buildSeoAuditReport } from "./model.ts";
import { isSeoAuditPayload } from "./contract.ts";
import type { SeoAuditRaw } from "./scan.ts";

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
      headings: ["Heading", "Section"],
      wordCount: 320,
      internalOutlinks: [],
      jsonLd: { types: ["WebPage"], errorCount: 0 },
      sitemapMember: true,
      bodyExcerpt: "Page body",
      paragraphs: ["Page body"],
      responseMs: 42,
      contentType: "text/html; charset=utf-8",
      ...overrides,
    },
  };
}

function raw(overrides: Partial<SeoAuditRaw> = {}): SeoAuditRaw {
  const home = page(
    "https://acme.test/",
    {
      title: "Acme",
      metaDescription: "Acme description",
      internalOutlinks: [
        {
          targetSubjectUrl: "https://acme.test/about",
          rel: null,
          anchorText: "About",
        },
        {
          targetSubjectUrl: "https://acme.test/not-collected",
          rel: null,
          anchorText: "Outside the free budget",
        },
      ],
    },
    0,
  );
  const about = page("https://acme.test/about", {
    title: "About Acme",
    metaDescription: "About Acme description",
  });
  return {
    origin: "https://acme.test",
    host: "acme.test",
    pages: [home, about],
    robots: {
      fetched: true,
      groups: [{ userAgent: "*", disallow: [], allow: ["/"] }],
      sitemaps: ["https://acme.test/sitemap.xml"],
    },
    sitemap: {
      fetched: true,
      urlCount: 2,
      subjectUrls: ["https://acme.test/", "https://acme.test/about"],
    },
    availability: "available",
    capturedAt: "2026-07-30T09:00:00.000Z",
    sourceWindow: {
      start: "2026-07-30T09:00:00.000Z",
      end: "2026-07-30T09:00:00.000Z",
    },
    stopReason: null,
    providerUsage: {
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
    },
    limitation: "Fixture crawl.",
    requestedUrl: "https://acme.test/",
    ...overrides,
  };
}

function byId(report: ReturnType<typeof buildSeoAuditReport>, id: string) {
  return report.records.find((record) => record.id === id);
}

describe("site-wide SEO audit model", () => {
  it("accepts only the current complete payload", () => {
    const current = buildSeoAuditPayload(raw());
    const stale = {
      ...current,
      run: { ...current.run, schemaVersion: "seo_audit.sitewide.v2" },
    };
    const malformed = {
      ...current,
      result: {
        ...current.result,
        coverage: {
          ...current.result.coverage,
          pagesInspected: "two",
        },
      },
    };

    expect(isSeoAuditPayload(current)).toBe(true);
    expect(isSeoAuditPayload(stale)).toBe(false);
    expect(isSeoAuditPayload(malformed)).toBe(false);
  });

  it.each([
    ["affected differs from observations", { tested: 2, affected: 2, state: "observed" }],
    ["affected exceeds tested", { tested: 0, affected: 1, state: "observed" }],
    ["observed has no affected observation", { tested: 1, affected: 0, state: "observed" }],
    ["not_observed has an affected observation", { tested: 1, affected: 1, state: "not_observed" }],
    ["unverified has an affected observation", { tested: 1, affected: 1, state: "unverified" }],
  ] as const)("rejects a record whose %s", (_description, contradiction) => {
    const malformed = structuredClone(buildSeoAuditPayload(raw())) as unknown as {
      result: {
        records: Array<{
          tested: number;
          affected: number;
          state: string;
          observations: unknown[];
        }>;
      };
    };
    const target = malformed.result.records[0]!;
    target.tested = contradiction.tested;
    target.affected = contradiction.affected;
    target.state = contradiction.state;
    target.observations = contradiction.affected === 0 ? [] : target.observations;

    expect(isSeoAuditPayload(malformed)).toBe(false);
  });

  it("builds a site-wide, persistence-free audit envelope without advisory fields", () => {
    const payload = buildSeoAuditPayload(raw());

    expect(payload.run).toEqual({
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v4",
      mode: "public_preview",
      scope: "discoverable_same_origin_static_html_audit",
      persistence: "none",
      completedAt: "2026-07-30T09:00:00.000Z",
    });
    expect(payload.result).toMatchObject({
      targetUrl: "https://acme.test/",
      siteOrigin: "https://acme.test",
    });
    expect(payload.result.coverage).toEqual({
      availability: "available",
      pagesInspected: 2,
      linksObserved: 2,
      sitemapUrlsObserved: 2,
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
      stopReason: null,
    });
    expect(payload.result.pages).toHaveLength(2);

    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      '"score"',
      '"grade"',
      '"severity"',
      '"priority"',
      '"diagnosis"',
      '"recommendation"',
      '"remediation"',
      '"actionPlan"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  /**
   * The live crawl panel shows the engine's collected-page count while a crawl
   * is still running, and the reader is told it is the figure this report
   * gives. That is only true while `pagesInspected` counts every collected
   * page — a filter added here would make the two disagree silently, so it has
   * to fail here instead.
   */
  it("counts every collected page, which is what the live progress seam reports", () => {
    const collected = [
      page("https://acme.test/", {}, 0),
      page("https://acme.test/missing", { finalStatus: 404 }),
      page("https://acme.test/paper", { contentType: "application/pdf" }),
    ];

    const report = buildSeoAuditReport(raw({ pages: collected }));

    expect(report.coverage.pagesInspected).toBe(collected.length);
    expect(report.pages).toHaveLength(collected.length);
  });

  it("aggregates duplicate metadata with every affected inspected URL", () => {
    const duplicate = "Same normalised title";
    const fixture = raw({
      pages: [
        page("https://acme.test/", { title: ` ${duplicate} ` }, 0),
        page("https://acme.test/a", { title: duplicate.toUpperCase() }),
        page("https://acme.test/b", { title: "Unique title" }),
      ],
    });
    const report = buildSeoAuditReport(fixture);

    expect(byId(report, "title_duplicate")).toMatchObject({
      state: "observed",
      tested: 3,
      affected: 2,
      limitation: "normalised_text_match_within_inspected_pages",
    });
    expect(
      byId(report, "title_duplicate")?.observations.map(
        (observation) => observation.url,
      ),
    ).toEqual(["https://acme.test/", "https://acme.test/a"]);
  });

  it("does not report duplicates when the only sharer is canonicalised elsewhere", () => {
    const fixture = raw({
      pages: [
        page("https://acme.test/en/wiki/aries", {
          title: "Aries",
          metaDescription: "About Aries",
        }),
        page("https://acme.test/wiki/aries", {
          title: "Aries",
          metaDescription: "About Aries",
          canonicalTarget: "https://acme.test/en/wiki/aries",
        }),
      ],
    });
    const report = buildSeoAuditReport(fixture);

    expect(byId(report, "title_duplicate")).toMatchObject({
      state: "not_observed",
      tested: 1,
      affected: 0,
    });
    expect(byId(report, "title_duplicate")?.observations).toEqual([]);
    expect(byId(report, "meta_description_duplicate")).toMatchObject({
      state: "not_observed",
      tested: 1,
      affected: 0,
    });
    expect(byId(report, "meta_description_duplicate")?.observations).toEqual(
      [],
    );
  });

  it("still reports a duplicate title shared by self-canonical pages", () => {
    const fixture = raw({
      pages: [
        page("https://acme.test/a", {
          title: "Shared title",
          canonicalTarget: "https://acme.test/a",
        }),
        page("https://acme.test/b", {
          title: "Shared title",
          // Slash variant of the page itself: still self-canonical by subject.
          canonicalTarget: "https://acme.test/b/",
        }),
      ],
    });
    const report = buildSeoAuditReport(fixture);

    expect(byId(report, "title_duplicate")).toMatchObject({
      state: "observed",
      tested: 2,
      affected: 2,
    });
    expect(
      byId(report, "title_duplicate")?.observations.map(
        (observation) => observation.url,
      ),
    ).toEqual(["https://acme.test/a", "https://acme.test/b"]);
  });

  it("groups a shared title only among its self-canonical sharers", () => {
    const fixture = raw({
      pages: [
        page("https://acme.test/en/wiki/aries", { title: "Aries" }),
        page("https://acme.test/en/wiki/aries-profile", { title: "Aries" }),
        page("https://acme.test/wiki/aries", {
          title: "Aries",
          canonicalTarget: "https://acme.test/en/wiki/aries",
        }),
      ],
    });
    const report = buildSeoAuditReport(fixture);

    expect(byId(report, "title_duplicate")).toMatchObject({
      state: "observed",
      tested: 2,
      affected: 2,
    });
    expect(byId(report, "title_duplicate")?.observations).toEqual([
      {
        url: "https://acme.test/en/wiki/aries",
        values: [
          { label: "title", value: "Aries" },
          { label: "matching_pages", value: 2 },
        ],
      },
      {
        url: "https://acme.test/en/wiki/aries-profile",
        values: [
          { label: "title", value: "Aries" },
          { label: "matching_pages", value: 2 },
        ],
      },
    ]);
  });

  it("groups a shared meta description only among its self-canonical sharers", () => {
    const shared = "Shared description";
    const fixture = raw({
      pages: [
        page("https://acme.test/en/wiki/aries", { metaDescription: shared }),
        page("https://acme.test/en/wiki/aries-profile", {
          metaDescription: shared,
        }),
        page("https://acme.test/wiki/aries", {
          metaDescription: shared,
          canonicalTarget: "https://acme.test/en/wiki/aries",
        }),
      ],
    });
    const report = buildSeoAuditReport(fixture);

    expect(byId(report, "meta_description_duplicate")).toMatchObject({
      state: "observed",
      tested: 2,
      affected: 2,
    });
    expect(
      byId(report, "meta_description_duplicate")?.observations.map(
        (observation) => observation.url,
      ),
    ).toEqual([
      "https://acme.test/en/wiki/aries",
      "https://acme.test/en/wiki/aries-profile",
    ]);
  });

  it("marks a technical page-safety stop as partial without evaluating site quality", () => {
    const report = buildSeoAuditReport(
      raw({
        availability: "partial",
        stopReason: "max_urls",
        providerUsage: {
          urlsSkipped: 4,
          urlsBlocked: 1,
          urlsDisallowed: 2,
          urlsErrored: 3,
        },
      }),
    );

    expect(report.coverage).toMatchObject({
      availability: "partial",
      stopReason: "max_urls",
      urlsSkipped: 4,
      urlsBlocked: 1,
      urlsDisallowed: 2,
      urlsErrored: 3,
    });
  });

  it("preserves the submitted depth-zero URL as the reported target", () => {
    const submitted = page("https://acme.test/zh", { title: "Acme 中文" }, 0);
    const report = buildSeoAuditReport(
      raw({
        requestedUrl: "https://acme.test/zh",
        pages: [
          submitted,
          page("https://acme.test/", { title: "Acme home" }, 1),
        ],
      }),
    );

    expect(report.targetUrl).toBe("https://acme.test/zh");
  });

  it("reports the canonical crawl origin separately from an apex entry URL", () => {
    const report = buildSeoAuditReport(
      raw({
        requestedUrl: "https://acme.test/",
        origin: "https://www.acme.test",
        host: "www.acme.test",
        pages: [page("https://www.acme.test/", { title: "Canonical home" }, 0)],
      }),
    );

    expect(report.targetUrl).toBe("https://acme.test/");
    expect(report.siteOrigin).toBe("https://www.acme.test");
  });

  it("does not infer robots indexability for a non-2xx response", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page(
            "https://acme.test/missing",
            {
              status: 404,
              finalStatus: 404,
              robotsIndexable: true,
            },
            0,
          ),
        ],
      }),
    );

    expect(report.pages[0]?.robotsDirectiveState).toBeNull();
    expect(byId(report, "noindex_directive")).toMatchObject({
      state: "unverified",
      tested: 0,
      affected: 0,
    });
  });

  it("does not classify an uncollected link target as broken", () => {
    const report = buildSeoAuditReport(raw());
    expect(byId(report, "internal_target_http_error")).toMatchObject({
      state: "not_observed",
      affected: 0,
      limitation: "uncollected_link_targets_not_classified",
    });
  });

  it("reports only collected internal targets whose observed response is 4xx/5xx", () => {
    const errorTarget = page("https://acme.test/missing", {
      status: 404,
      finalStatus: 404,
      title: "Not found",
    });
    const fixture = raw({
      pages: [
        page(
          "https://acme.test/",
          {
            internalOutlinks: [
              {
                targetSubjectUrl: "https://acme.test/missing",
                rel: null,
                anchorText: "Missing",
              },
            ],
          },
          0,
        ),
        errorTarget,
      ],
    });
    const report = buildSeoAuditReport(fixture);

    expect(byId(report, "internal_target_http_error")).toMatchObject({
      state: "observed",
      tested: 1,
      affected: 1,
    });
    expect(
      byId(report, "internal_target_http_error")?.observations[0],
    ).toMatchObject({
      url: "https://acme.test/missing",
      values: [
        { label: "final_status", value: 404 },
        { label: "observed_source_pages", value: 1 },
      ],
    });
  });

  it("keeps robots and sitemap unverified when the crawl did not observe them", () => {
    const report = buildSeoAuditReport(
      raw({
        robots: { fetched: false, groups: [], sitemaps: [] },
        sitemap: { fetched: false, urlCount: 0, subjectUrls: [] },
      }),
    );

    expect(byId(report, "robots_resource")).toMatchObject({
      state: "unverified",
      tested: 0,
      affected: 0,
      limitation: "resource_not_observed_does_not_prove_absence",
    });
    expect(byId(report, "sitemap_resource")).toMatchObject({
      state: "unverified",
      tested: 0,
      affected: 0,
    });
  });
});

describe("seo audit record invariants", () => {
  it("keeps every record's affected count inside the population it tested", () => {
    // A 404 page is still parsed, so its outbound links can name a broken
    // target. Counting those pages as affected while the denominator only
    // counts 2xx HTML made `affected > tested`, which the payload guard
    // rejects — taking the whole audit down instead of reporting the links.
    const broken = page("https://acme.test/broken", {
      finalStatus: 404,
      status: 404,
    });
    const errorPageA = page("https://acme.test/gone-a", {
      finalStatus: 404,
      status: 404,
      internalOutlinks: [
        { targetSubjectUrl: "https://acme.test/broken", rel: null, anchorText: "x" },
      ],
    });
    const errorPageB = page("https://acme.test/gone-b", {
      finalStatus: 404,
      status: 404,
      internalOutlinks: [
        { targetSubjectUrl: "https://acme.test/broken", rel: null, anchorText: "y" },
      ],
    });
    const entry = page(
      "https://acme.test/",
      {
        internalOutlinks: [
          { targetSubjectUrl: "https://acme.test/broken", rel: null, anchorText: "z" },
        ],
      },
      0,
    );

    const report = buildSeoAuditReport(
      raw({ pages: [entry, broken, errorPageA, errorPageB] }),
    );

    for (const record of report.records) {
      expect(
        record.affected,
        `${record.id} reported ${record.affected} affected of ${record.tested} tested`,
      ).toBeLessThanOrEqual(record.tested);
    }
    expect(isSeoAuditPayload(buildSeoAuditPayload(raw({
      pages: [entry, broken, errorPageA, errorPageB],
    })))).toBe(true);
  });

  it("declares which records only tested a qualifying subset of pages", () => {
    const report = buildSeoAuditReport(raw());
    const populations = new Map(
      report.records.map((record) => [record.id, record.population]),
    );

    // Absence from these says nothing about a page that never qualified.
    expect(populations.get("title_length_outside_range")).toBe(
      "conditional_subset",
    );
    expect(populations.get("meta_description_duplicate")).toBe(
      "conditional_subset",
    );
    expect(populations.get("sitemap_page_without_observed_inlink")).toBe(
      "conditional_subset",
    );
    // These ran over everything collected, so absence is real evidence.
    expect(populations.get("noindex_directive")).toBe("every_collected_page");
    expect(populations.get("json_ld_missing")).toBe("every_collected_page");
  });

  it("reports the collected page that is the submitted target", () => {
    const report = buildSeoAuditReport(raw());

    expect(report.targetInspected).toBe(true);
    expect(report.inspectedTargetUrl).toBe("https://acme.test/");
  });

  it("matches the target through entry normalisation rather than raw string equality", () => {
    // The visitor submits a URL without the trailing slash the site serves.
    const report = buildSeoAuditReport(
      raw({ requestedUrl: "https://acme.test/about/" }),
    );

    expect(report.targetInspected).toBe(true);
    expect(report.inspectedTargetUrl).toBe("https://acme.test/about");
  });

  it("does not claim a target that was never collected as inspected", () => {
    const report = buildSeoAuditReport(
      raw({ requestedUrl: "https://acme.test/never-crawled" }),
    );

    expect(report.targetInspected).toBe(false);
    expect(report.inspectedTargetUrl).toBeNull();
  });

  it("only tests sitemap membership when a sitemap was collected", () => {
    const withoutSitemap = buildSeoAuditReport(
      raw({ sitemap: { fetched: false, urlCount: 0, subjectUrls: [] } }),
    );
    const record = withoutSitemap.records.find(
      (entry) => entry.id === "page_not_in_sitemap",
    );

    expect(record?.state).toBe("unverified");
    expect(record?.tested).toBe(0);
  });
});
