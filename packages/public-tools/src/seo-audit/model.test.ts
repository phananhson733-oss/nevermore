import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";
import { buildSeoAuditPayload, buildSeoAuditReport } from "./model.ts";
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
  it("builds a site-wide, persistence-free audit envelope without advisory fields", () => {
    const payload = buildSeoAuditPayload(raw());

    expect(payload.run).toEqual({
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v3",
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
    const submitted = page(
      "https://acme.test/zh",
      { title: "Acme 中文" },
      0,
    );
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
        pages: [
          page("https://www.acme.test/", { title: "Canonical home" }, 0),
        ],
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
