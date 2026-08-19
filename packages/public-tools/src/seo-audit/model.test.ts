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
      schemaVersion: "seo_audit.sitewide.v15",

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
        // The URL, not just the count. "3 pages link to this 404" is not a fix
        // instruction: the reader cannot open the three pages.
        { label: "source_pages", value: "https://acme.test/" },
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

describe("crawl-response records", () => {
  const redirected = (url: string, to: string, finalStatus: number) =>
    page(url, { redirectChain: [to], finalStatus });

  it("reports a redirect whose destination errors, and only over redirects", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          redirected("https://acme.test/old", "https://acme.test/gone", 404),
          redirected("https://acme.test/moved", "https://acme.test/new", 200),
        ],
      }),
    );
    const record = byId(report, "redirect_destination_error");

    expect(record?.observations.map((entry) => entry.url)).toEqual([
      "https://acme.test/old",
    ]);
    // Only the two redirecting pages are the population: counting the direct
    // 200 would make the share of broken destinations read as one in three.
    expect(record?.tested).toBe(2);
  });

  it("counts a redirect onto a server error, which the check now names", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          redirected("https://acme.test/old", "https://acme.test/down", 503),
        ],
      }),
    );

    expect(
      byId(report, "redirect_destination_error")?.observations.map((e) => e.url),
    ).toEqual(["https://acme.test/old"]);
  });

  it("concludes a site with no redirects rather than leaving it unverified", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [page("https://acme.test/", {}, 0), page("https://acme.test/b")],
      }),
    );
    const record = byId(report, "redirect_destination_error");

    // Nothing redirected, so no redirect destination can be broken. Reporting
    // that as unverified is what puts a grey label on a site that is fine.
    expect(record?.state).toBe("not_observed");
    expect(record?.observations).toEqual([]);
  });

  it("does not read a redirect with an unknown destination as a clean one", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          page("https://acme.test/timeout", {
            redirectChain: ["https://acme.test/somewhere"],
            finalStatus: null,
          }),
        ],
      }),
    );
    const record = byId(report, "redirect_destination_error");

    // The redirect exists and its destination never answered, so it was not
    // tested. Counting it would turn "we do not know" into "it is fine".
    expect(record?.tested).toBe(0);
    expect(record?.limitation).toBe(
      "redirect_destination_status_not_observed_for_every_redirect",
    );
  });

  it("charges a request with no status to the crawl, not to the site", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          page("https://acme.test/aborted", { finalStatus: null }),
          page("https://acme.test/fine"),
        ],
      }),
    );

    // Our own timeout is not the site's crawl waste, and it is not a healthy
    // page either: it leaves the tested population entirely.
    const waste = byId(report, "fetch_without_direct_page");
    expect(waste?.tested).toBe(2);
    expect(waste?.observations).toEqual([]);
    expect(waste?.population).toBe("conditional_subset");

    const serverErrors = byId(report, "server_error_response");
    expect(serverErrors?.tested).toBe(2);
    expect(serverErrors?.population).toBe("conditional_subset");
  });

  it("does not read a direct 404 as a broken redirect destination", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          page("https://acme.test/missing", { finalStatus: 404 }),
        ],
      }),
    );

    expect(byId(report, "redirect_destination_error")?.observations).toEqual([]);
    expect(
      byId(report, "non_2xx_final_status")?.observations.map((e) => e.url),
    ).toEqual(["https://acme.test/missing"]);
  });

  it("averages response time over the pages that were actually timed", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", { responseMs: 100 }, 0),
          page("https://acme.test/b", { responseMs: 300 }),
          // No timing: left out of the mean rather than counted as zero, which
          // would drag the average down and read as a faster site.
          page("https://acme.test/c", { responseMs: null }),
        ],
      }),
    );
    const record = byId(report, "average_response_time");
    const value = (label: string) =>
      record?.observations[0]?.values.find((entry) => entry.label === label)
        ?.value;

    expect(record?.tested).toBe(2);
    expect(value("average_response_ms")).toBe(200);
    expect(value("slowest_response_ms")).toBe(300);
    expect(record?.observations[0]?.url).toBeNull();
  });

  it("reports no timing at all rather than an average of nothing", () => {
    const report = buildSeoAuditReport(
      raw({ pages: [page("https://acme.test/", { responseMs: null }, 0)] }),
    );
    const record = byId(report, "average_response_time");

    expect(record?.observations).toEqual([]);
    expect(record?.state).toBe("unverified");
  });

  it("averages click depth over collected HTML pages", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          page("https://acme.test/b", {}, 2),
          page("https://acme.test/c", {}, 4),
        ],
      }),
    );
    const record = byId(report, "average_click_depth");
    const value = (label: string) =>
      record?.observations[0]?.values.find((entry) => entry.label === label)
        ?.value;

    expect(value("average_click_depth")).toBe(2);
    expect(value("deepest_click_depth")).toBe(4);
    expect(record?.tested).toBe(3);
  });

  it("separates a server failure from a missing page", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          page("https://acme.test/down", { finalStatus: 503 }),
          page("https://acme.test/missing", { finalStatus: 404 }),
        ],
      }),
    );
    const record = byId(report, "server_error_response");

    expect(record?.observations.map((entry) => entry.url)).toEqual([
      "https://acme.test/down",
    ]);
    expect(record?.tested).toBe(3);
  });

  it("counts a redirect as a request that did not land on a page", () => {
    const report = buildSeoAuditReport(
      raw({
        pages: [
          page("https://acme.test/", {}, 0),
          redirected("https://acme.test/moved", "https://acme.test/new", 200),
          page("https://acme.test/missing", { finalStatus: 404 }),
          page("https://acme.test/fine"),
        ],
      }),
    );
    const record = byId(report, "fetch_without_direct_page");

    // The redirect resolved to 200 and is still waste: a correct link would not
    // have spent the hop.
    expect(record?.observations.map((entry) => entry.url).sort()).toEqual([
      "https://acme.test/missing",
      "https://acme.test/moved",
    ]);
    expect(record?.tested).toBe(4);
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

    // Swept rather than listed: a record that tested fewer units than the
    // crawl collected has a qualifying population, and saying otherwise turns
    // its silence into evidence about pages it never looked at. A named list
    // only covers the records someone remembered to add to it.
    const collected = report.pages.length;
    for (const record of report.records) {
      if (record.unit !== "pages") continue;
      if (record.tested >= collected) continue;
      expect([record.id, record.population]).toEqual([
        record.id,
        "conditional_subset",
      ]);
    }
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

  it("matches the target the entry redirect moved to the site's other host variant", () => {
    // The visitor submits the www host; the site 301s to the apex, so the
    // crawler resolved the origin to the apex and every collected page carries
    // the apex subject URL. Comparing the submitted string against those pages
    // finds nothing, and the run reports a fully crawled site whose one
    // requested page was supposedly never collected.
    const report = buildSeoAuditReport(
      raw({ requestedUrl: "https://www.acme.test/about" }),
    );

    expect(report.targetInspected).toBe(true);
    expect(report.inspectedTargetUrl).toBe("https://acme.test/about");
  });

  it("matches the target when the site redirects the apex to www", () => {
    const report = buildSeoAuditReport(
      raw({
        requestedUrl: "https://acme.test/about",
        origin: "https://www.acme.test",
        host: "www.acme.test",
        pages: [
          page("https://www.acme.test/", {}, 0),
          page("https://www.acme.test/about"),
        ],
      }),
    );

    expect(report.targetInspected).toBe(true);
    expect(report.inspectedTargetUrl).toBe("https://www.acme.test/about");
  });

  it("matches the target when the entry redirect only upgraded the scheme", () => {
    const report = buildSeoAuditReport(
      raw({ requestedUrl: "http://acme.test/about" }),
    );

    expect(report.targetInspected).toBe(true);
    expect(report.inspectedTargetUrl).toBe("https://acme.test/about");
  });

  it("never rebases a submitted host the entry redirect could not have reached", () => {
    // Rebasing on the origin alone would report this crawl's /about page as the
    // inspected target for a URL on a different site entirely.
    const report = buildSeoAuditReport(
      raw({ requestedUrl: "https://other.test/about" }),
    );

    expect(report.targetInspected).toBe(false);
    expect(report.inspectedTargetUrl).toBeNull();
  });

  it("does not let the host rebase invent a page the crawl never collected", () => {
    const report = buildSeoAuditReport(
      raw({ requestedUrl: "https://www.acme.test/never-crawled" }),
    );

    expect(report.targetInspected).toBe(false);
    expect(report.inspectedTargetUrl).toBeNull();
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

/**
 * `pages` is a positional map of `raw.pages`, and the extract is read out of
 * `raw.pages` at the index the target was found at in `pages`. Nothing outside
 * this file can see that pairing come apart: a wrong index still produces a
 * well-formed extract, one that reports another page's words under this page's
 * URL. So every page in this fixture carries text of its own.
 */
function positionalFixture(): SeoAuditRaw {
  return raw({
    requestedUrl: "https://acme.test/pricing",
    pages: [
      page(
        "https://acme.test/",
        {
          title: "Acme home",
          metaDescription: "Home description",
          h1: ["Home heading"],
          headings: ["Home heading", "Home section"],
          bodyExcerpt: "Home opening text",
          wordCount: 100,
        },
        0,
      ),
      page("https://acme.test/blog", {
        title: "Acme blog",
        metaDescription: "Blog description",
        h1: ["Blog heading"],
        headings: ["Blog heading", "Blog section"],
        bodyExcerpt: "Blog opening text",
        wordCount: 200,
      }),
      page("https://acme.test/pricing", {
        title: "Acme pricing",
        metaDescription: "Pricing description",
        h1: ["Pricing heading"],
        headings: ["Pricing heading", "Pricing section"],
        bodyExcerpt: "Pricing opening text",
        wordCount: 300,
      }),
      page("https://acme.test/contact", {
        title: "Acme contact",
        metaDescription: "Contact description",
        h1: ["Contact heading"],
        headings: ["Contact heading", "Contact section"],
        bodyExcerpt: "Contact opening text",
        wordCount: 400,
      }),
    ],
  });
}

describe("target page extract", () => {
  it("extracts the same page the report says it inspected", () => {
    const report = buildSeoAuditReport(positionalFixture());

    expect(report.targetInspected).toBe(true);
    expect(report.inspectedTargetUrl).toBe("https://acme.test/pricing");
    // Whole-object, so an index that is off by one in either direction reports
    // the blog's or the contact page's text and fails here.
    expect(report.targetPageExtract).toEqual({
      url: "https://acme.test/pricing",
      title: "Acme pricing",
      metaDescription: "Pricing description",
      h1: ["Pricing heading"],
      subHeadings: ["Pricing section"],
      openingText: "Pricing opening text",
      staticBodyWords: 300,
      staticBodyUnits: null,
      termFrequencies: null,
      truncatedLists: false,
      headingLevels: null,
      wordsUnderEachH3: null,
      // The crawl's own journey to this page, always known once collected.
      response: {
        status: 200,
        finalStatus: 200,
        redirectHops: 0,
        responseMs: 42,
        contentType: "text/html; charset=utf-8",
        canonicalTarget: "https://acme.test/pricing",
        robotsIndexable: true,
        robotsDirectives: [],
        sitemapMember: true,
        jsonLdTypes: ["WebPage"],
        jsonLdErrorCount: 0,
        internalOutlinks: 0,
        internalOutlinksWithoutAnchorText: 0,
      },
      // This fixture builds page records without the crawler's side-car, and
      // unknown must not render as a page that declared nothing.
      declared: null,
    });
    expect(report.targetPageExtract?.url).toBe(report.inspectedTargetUrl);
  });

  it("carries no text belonging to any other collected page", () => {
    const serialized = JSON.stringify(
      buildSeoAuditReport(positionalFixture()).targetPageExtract,
    );

    for (const neighbour of [
      "Acme home",
      "Acme blog",
      "Acme contact",
      "Home opening text",
      "Blog opening text",
      "Contact opening text",
      "Home section",
      "Blog section",
      "Contact section",
    ]) {
      expect(serialized).not.toContain(neighbour);
    }
  });

  it("reads the index of the inspected journey, not the first record sharing the subject", () => {
    // Two records for one subject URL: a redirect hop that was never an
    // inspectable HTML response, then the response that was. Selecting the raw
    // record by a second predicate on `subjectUrl` picks the stub, and the
    // report then quotes text from a page it did not inspect.
    const report = buildSeoAuditReport(
      raw({
        requestedUrl: "https://acme.test/pricing",
        pages: [
          page("https://acme.test/", { title: "Acme home" }, 0),
          page("https://acme.test/pricing", {
            status: 301,
            finalStatus: 301,
            redirectChain: ["https://acme.test/pricing/"],
            title: "Redirect stub",
            metaDescription: "Redirect stub description",
            bodyExcerpt: "Redirect stub body",
          }),
          page("https://acme.test/pricing", {
            title: "Acme pricing",
            metaDescription: "Pricing description",
            bodyExcerpt: "Pricing opening text",
          }),
        ],
      }),
    );

    expect(report.targetPageExtract?.title).toBe("Acme pricing");
    expect(report.targetPageExtract?.metaDescription).toBe(
      "Pricing description",
    );
    expect(report.targetPageExtract?.openingText).toBe("Pricing opening text");
  });

  it("publishes no extract when the submitted page was never inspected", () => {
    const uncollected = buildSeoAuditReport(
      raw({ requestedUrl: "https://acme.test/never-crawled" }),
    );
    expect(uncollected.targetInspected).toBe(false);
    expect(uncollected.targetPageExtract).toBeNull();

    const notHtml = buildSeoAuditReport(
      raw({
        requestedUrl: "https://acme.test/paper",
        pages: [
          page(
            "https://acme.test/paper",
            { contentType: "application/pdf", title: "Not HTML" },
            0,
          ),
        ],
      }),
    );
    expect(notHtml.targetInspected).toBe(false);
    expect(notHtml.targetPageExtract).toBeNull();

    const errorStatus = buildSeoAuditReport(
      raw({
        requestedUrl: "https://acme.test/missing",
        pages: [
          page(
            "https://acme.test/missing",
            { status: 404, finalStatus: 404, title: "Gone" },
            0,
          ),
        ],
      }),
    );
    expect(errorStatus.targetInspected).toBe(false);
    expect(errorStatus.targetPageExtract).toBeNull();
  });

  it("pins the schema version the extract ships under", () => {
    const payload = buildSeoAuditPayload(positionalFixture());

    expect(payload.run.schemaVersion).toBe("seo_audit.sitewide.v15");

    expect(payload.result.targetPageExtract).not.toBeNull();
    expect(isSeoAuditPayload(payload)).toBe(true);
  });
});

/**
 * The keyword region is derived per request from one visitor's queries. This
 * payload is what gets stored under a cache key shared by every visitor to the
 * same host, so a payload carrying that region must not read as a valid
 * instance of this shape — otherwise the next visitor is answered with the
 * previous visitor's questions.
 */
describe("cache eligibility of the audit payload", () => {
  const validRegion = {
    availability: "available",
    version: "keyword_evidence.v1",
    textUnitsVersion: "text_units.v1",
    pageRole: null,
    queries: [],
    focus: { covered: 0, applicable: 0 },
    limitations: ["density_basis_captured_text_only"],
  } as const;

  it("rejects an otherwise valid payload purely for carrying a keyword region", () => {
    const accepted = buildSeoAuditPayload(raw());
    const rejected = {
      ...accepted,
      result: { ...accepted.result, keywordEvidence: validRegion },
    };

    // The same payload, one key apart.
    expect(isSeoAuditPayload(accepted)).toBe(true);
    expect(isSeoAuditPayload(rejected)).toBe(false);
  });

  it("rejects the key even when it carries nothing", () => {
    // A spread that copies `keywordEvidence: undefined` still leaves the key
    // present, and a check for a truthy or defined value would wave it through.
    const accepted = buildSeoAuditPayload(raw());

    for (const carried of [undefined, null, {}]) {
      expect(
        isSeoAuditPayload({
          ...accepted,
          result: { ...accepted.result, keywordEvidence: carried },
        }),
      ).toBe(false);
    }
  });
});
