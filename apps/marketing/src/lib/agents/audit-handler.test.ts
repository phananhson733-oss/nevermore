// @input  -- authenticated requests and controlled buffered crawler responses
// @output -- auth-order, projection, passthrough, and fail-closed API assertions
// @pos    -- focused tests for the shared SEO and Tech Agent request wrapper

import { describe, expect, it, vi } from "vitest";
import type { SeoAuditPayload, SeoAuditRecord } from "@sf/public-tools";
import { buildSearchPerformanceRecords } from "@sf/public-tools/seo-audit/search-performance";
import {
  buildPagePerformanceRecords,
  buildPageWeightRecords,
  buildImageWeightRecords,
} from "@sf/public-tools/seo-audit/page-performance";
import {
  AGENT_PAGE_PERFORMANCE_VERSION,
  AGENT_AUDIT_RECORD_CATEGORIES,
  AGENT_SEARCH_PERFORMANCE_VERSION,
  isAgentAuditSuccessEnvelope,
} from "./audit-contract.ts";
import {
  handleAgentAuditRequest,
  type AgentAuditHandlerDependencies,
} from "./audit-handler.ts";

// Derived from the producer's ledger. A fourth hand-written copy of it lived
// here, which is part of why a detector could land in the crawl and this
// handler could start answering 502 with every one of these tests green.
const RECORD_SPECS = Object.entries(AGENT_AUDIT_RECORD_CATEGORIES);

function record(
  id: string,
  category: SeoAuditRecord["category"],
  index: number,
): SeoAuditRecord {
  const state: SeoAuditRecord["state"] =
    index % 3 === 0
      ? "observed"
      : index % 3 === 1
        ? "not_observed"
        : "unverified";
  return {
    id,
    category,
    state,
    unit: "pages",
    population: "every_collected_page" as const,
    targetTested: null,
    tested: 2,
    affected: state === "observed" ? 1 : 0,
    observations:
      state === "observed"
        ? [
            {
              url: "https://acme.test/",
              values: [{ label: "sample", value: null }],
            },
          ]
        : [],
    limitation: state === "unverified" ? "Evidence was unavailable." : null,
  };
}

const upstreamPayload = {
  run: {
    tool: "seo_audit",
    schemaVersion: "seo_audit.sitewide.v15",
    mode: "public_preview",
    scope: "discoverable_same_origin_static_html_audit",
    persistence: "none",
    completedAt: "2026-08-12T09:00:00.000Z",
  },
  result: {
    targetUrl: "https://acme.test/",
    siteOrigin: "https://acme.test",
    scannedAt: "2026-08-12T09:00:00.000Z",
    targetInspected: true,
    inspectedTargetUrl: "https://acme.test/",
    targetPageExtract: null,
    coverage: {
      availability: "partial",
      pagesInspected: 2,
      linksObserved: 3,
      sitemapUrlsObserved: 1,
      urlsSkipped: 1,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 1,
      stopReason: "page_budget",
    },
    siteResources: {
      robotsFetched: true,
      robotsGroupsObserved: 1,
      sitemapReferencesObserved: 1,
      sitemapFetched: false,
      sitemapUrls: [],
      sitemapUrlsComplete: true,
    },
    records: RECORD_SPECS.map(([id, category], index) =>
      record(id, category, index),
    ),
    pages: [],
  },
} satisfies SeoAuditPayload;

function request(accept = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/agents/seo/audit", {
    method: "POST",
    headers: {
      accept,
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify({ url: "acme.test" }),
  });
}

function keywordRequest(
  targetQueries: readonly string[],
  pageRole?: string,
): Request {
  return new Request("https://gengrowth.ai/api/agents/seo/audit", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify({
      url: "acme.test",
      targetQueries,
      ...(pageRole === undefined ? {} : { pageRole }),
    }),
  });
}

/** An upstream payload whose target page actually carries readable text. */
function successWithExtract(
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    {
      data: {
        ...upstreamPayload,
        result: {
          ...upstreamPayload.result,
          targetPageExtract: {
            url: "https://acme.test/",
            title: "Acme birth chart calculator",
            metaDescription: "Calculate a birth chart.",
            h1: ["Birth chart calculator"],
            subHeadings: ["How the chart is drawn"],
            openingText: "A birth chart maps the sky at a moment in time.",
            staticBodyWords: 900,
            staticBodyUnits: null,
            termFrequencies: null,
            truncatedLists: false,
            headingLevels: null,
            wordsUnderEachH3: null,
            response: {
              status: 200,
              finalStatus: 200,
              redirectHops: 0,
              responseMs: 42,
              contentType: "text/html; charset=utf-8",
              canonicalTarget: "https://acme.test/",
              robotsIndexable: true,
              robotsDirectives: [],
              sitemapMember: true,
              jsonLdTypes: ["WebPage"],
              jsonLdErrorCount: 0,
              internalOutlinks: 3,
              internalOutlinksWithoutAnchorText: 0,
            },
            declared: {
              lang: "en",
              openGraph: {
                title: "Acme birth chart calculator",
                description: "Calculate a birth chart.",
                image: "https://acme.test/card.png",
              },
              twitterCard: "summary_large_image",
              viewport: "width=device-width, initial-scale=1",
              charset: "utf-8",
              faviconDeclared: true,
              hreflang: ["en"],
              images: {
      total: 2,
      withAlt: 2,
      withEmptyAlt: 0,
      withoutAlt: 0,
      withDimensions: 0,
      lazyLoaded: 0,
      first: null,
      sources: [],
    },
              externalLinks: { total: 1, nofollow: 0, blankWithoutNoopener: 0 },
              htmlBytes: 24_576,
              visibleTextBytes: 8_192,
              scriptBytes: 0,
              interactive: {
                forms: 0,
                inputs: 0,
                buttons: 0,
                selects: 0,
                textareas: 0,
                canvases: 0,
                media: 0,
                iframes: 0,
              },
            },
          },
        },
      },
    },
    { status: 200, headers },
  );
}

function success(
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    { data: upstreamPayload },
    { status: 200, headers },
  );
}

function dependencies(
  overrides: Partial<AgentAuditHandlerDependencies> = {},
): AgentAuditHandlerDependencies {
  return {
    authenticate: vi.fn(async () => "authenticated" as const),
    delegate: vi.fn(async () => success()),
    reportAs: "agent-audit",
    ...overrides,
  };
}

describe("handleAgentAuditRequest", () => {
  // Built by the producer, never written out by hand. The hand-written version
  // was a single record chosen to satisfy the guard, so when a fourth record
  // joined the ledger the fixture silently described a region the guard refuses
  // — and the tests that read it never noticed, because they read the records
  // rather than the envelope.
  const searchRegion = {
    version: AGENT_SEARCH_PERFORMANCE_VERSION,
    property: "sc-domain:acme.test",
    startDate: "2026-07-19",
    endDate: "2026-08-15",
    records: buildSearchPerformanceRecords(
      {
        property: "sc-domain:acme.test",
        startDate: "2026-07-19",
        endDate: "2026-08-15",
        pages: [
          { key: "https://acme.test/", clicks: 3, impressions: 90, position: 4 },
        ],
        queries: [{ key: "acme", clicks: 3, impressions: 90, position: 4 }],
        pagesTruncated: false,
        queriesTruncated: false,
        targetPageQueries: null,
        targetPageUrl: null,
        confirmedQueries: [],
        targetPageQueriesTruncated: false,
      },
      [],
    ),
  };

  it("returns a region the client guard actually accepts", async () => {
    // Built by the real producer and read by the real guard. Both previous
    // rounds shipped a consumer that refused its own producer's output while
    // every unit test passed, because the fixtures were written to match the
    // guard rather than taken from the thing that feeds it.
    const region = {
      version: AGENT_SEARCH_PERFORMANCE_VERSION,
      property: "sc-domain:acme.test",
      startDate: "2026-07-19",
      endDate: "2026-08-15",
      records: buildSearchPerformanceRecords(
        {
          property: "sc-domain:acme.test",
          startDate: "2026-07-19",
          endDate: "2026-08-15",
          pages: [
            {
              key: "https://acme.test/",
              clicks: 3,
              impressions: 90,
              position: 4,
            },
          ],
          queries: [
            { key: "acme", clicks: 3, impressions: 90, position: 4 },
          ],
          pagesTruncated: false,
          queriesTruncated: false,
          targetPageQueries: null,
          targetPageUrl: null,
          confirmedQueries: [],
          targetPageQueriesTruncated: false,
        },
        [],
      ),
    };
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ readSearchPerformance: async () => region }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(region.records.length).toBeGreaterThan(0);
    expect(isAgentAuditSuccessEnvelope(body)).toBe(true);
  });

  it("asks Search Console about the URL the crawl landed on, not the one it requested", async () => {
    // On any site that redirects — trailing slash, http to https — the
    // requested form matches no Search Console row, so 9.5 published "no
    // impressions for this URL" about a page that ranks.
    const seen: { url: string | null }[] = [];
    const requested = "https://acme.test/pricing";
    const landed = "https://acme.test/pricing/";
    const collected = {
      url: requested,
      subjectUrl: requested,
      // Where the journey ended. Search Console keys its rows by this one.
      finalUrl: landed,
      depth: 1,
      initialStatus: 301,
      finalStatus: 200,
      redirectHops: 1,
      contentType: "text/html",
      robotsDirectiveState: "noindex_not_observed" as const,
      canonicalTarget: landed,
      title: "Pricing",
      metaDescription: "D",
      h1Count: 1,
      headingsCount: 1,
      wordCount: 100,
      inboundLinks: 1,
      outboundLinks: 1,
      sitemapMember: true,
      jsonLdTypes: [],
      jsonLdErrorCount: 0,
    };
    await handleAgentAuditRequest(
      keywordRequest(["acme"]),
      "seo",
      dependencies({
        delegate: async () =>
          Response.json({
            data: {
              ...upstreamPayload,
              result: {
                ...upstreamPayload.result,
                targetInspected: true,
                inspectedTargetUrl: requested,
                pages: [collected],
              },
            },
          }),
        readSearchPerformance: async (input) => {
          seen.push({ url: input.targetPageUrl });
          return null;
        },
      }),
    );

    expect(seen[0]?.url).toBe(landed);
  });

  it("asks PageSpeed about the URL the crawl landed on, not the one it requested", async () => {
    // The sibling above has had this guard since the day 9.5 published "no
    // impressions" about a page that ranks. The PageSpeed call twenty lines
    // below it kept passing `inspectedTargetUrl` — the pre-redirect form — so
    // on any site that redirects, CrUX found no url-level sample and 8.1-8.4
    // silently fell back to the whole origin's p75. That is the fast page
    // inheriting the slow site's verdict the producer explicitly warns about.
    const requested = "http://acme.test/page";
    const landed = "https://acme.test/page/";
    const seen: string[] = [];
    const collected = {
      url: requested,
      subjectUrl: requested,
      finalUrl: landed,
      depth: 0,
      initialStatus: 301,
      finalStatus: 200,
      redirectHops: 1,
      contentType: "text/html; charset=utf-8",
      robotsDirectiveState: "noindex_not_observed",
      canonicalTarget: landed,
      title: "T",
      metaDescription: "D",
      h1Count: 1,
      headingsCount: 1,
      wordCount: 300,
      inboundLinks: 0,
      outboundLinks: 0,
      sitemapMember: true,
      jsonLdTypes: [],
      jsonLdErrorCount: 0,
    };

    await handleAgentAuditRequest(
      keywordRequest(["acme"]),
      "seo",
      dependencies({
        delegate: async () =>
          Response.json({
            data: {
              ...upstreamPayload,
              result: {
                ...upstreamPayload.result,
                targetInspected: true,
                inspectedTargetUrl: requested,
                pages: [collected],
              },
            },
          }),
        readPagePerformance: async (input) => {
          seen.push(input.url);
          return {
            status: "unavailable" as const,
            reason: "no_field_data" as const,
            weight: null,
          };
        },
      }),
    );

    expect(seen[0]).toBe(landed);
  });

  it("says no source was configured, not that CrUX has nothing for the page", async () => {
    // PAGESPEED_API_KEY now exists on the marketing project for Preview and
    // Production, so this is no longer the production path — but it is still
    // the path taken by any deployment without the key, and by every run whose
    // key is rejected. The first version substituted a fabricated
    // `no_field_data` result here, which publishes a claim about the visitor's
    // own real-user traffic that the run never went and looked for.
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ readPagePerformance: () => undefined }),
    );
    const body = (await response.json()) as {
      data: {
        result: {
          pagePerformance?: {
            records: readonly { readonly limitation: string }[];
          };
        };
      };
    };

    const records = body.data.result.pagePerformance?.records ?? [];
    // Six: the four Core Web Vitals, the page-weight record behind 8.5, and
    // the image-weight record behind 5.2. All three sources are per-visitor
    // measurements of one page, which is what the region is for.
    expect(records).toHaveLength(6);
    // The five PageSpeed-sourced records say the source was not configured.
    // The image record does NOT: its bytes come from our own fetches, not from
    // PageSpeed, and borrowing PageSpeed's reason for it would state something
    // about a provider that has nothing to do with why there are no weights.
    const [psiSourced, imageSourced] = [records.slice(0, 5), records[5]];
    for (const record of psiSourced) {
      expect(record.limitation).toBe(
        "no_field_data_source_was_configured_for_this_run",
      );
    }
    // This fixture wires no image reader at all, and that is its own fact —
    // distinct from "the page declares no images" and from "every fetch
    // failed", both of which this run would be lying about if it claimed them.
    expect(imageSourced?.limitation).toBe(
      "no_image_weights_were_measured_for_this_run",
    );
  });

  it.each([
    ["market_not_supported", "this_runs_market_is_not_one_the_results_page_provider_covers"],
    ["provider_unavailable", "the_results_page_provider_did_not_answer_this_run"],
  ])("does not blame the visitor for a %s sample", async (reason, code) => {
    // The region is only attached when a query WAS confirmed, so
    // "no target query was confirmed" is false in every state that can show it.
    const response = await handleAgentAuditRequest(
      keywordRequest(["acme"]),
      "seo",
      dependencies({
        readSerpLandscape: async () =>
          ({ availability: "unavailable", reason }) as never,
      }),
    );
    const body = (await response.json()) as {
      data: {
        result: {
          serpShape?: { records: readonly { readonly limitation: string }[] };
        };
      };
    };

    const records = body.data.result.serpShape?.records ?? [];
    expect(records).toHaveLength(2);
    for (const record of records) expect(record.limitation).toBe(code);
  });

  it("says no provider was configured when there is no reader at all", async () => {
    const response = await handleAgentAuditRequest(
      keywordRequest(["acme"]),
      "seo",
      dependencies({
        readSerpLandscape: async () => ({
          availability: "unavailable" as const,
          reason: "provider_not_configured" as const,
        }),
      }),
    );
    const body = (await response.json()) as {
      data: {
        result: {
          serpShape?: { records: readonly { readonly limitation: string }[] };
        };
      };
    };

    expect(body.data.result.serpShape?.records[0]?.limitation).toBe(
      "no_results_page_provider_was_configured_for_this_run",
    );
  });

  it("accepts every region this handler can attach, not only the search one", async () => {
    // The gap the round-trip test above left. It proved one region's producer
    // survives the guard; a later region used a population value the guard's
    // own hand-written list did not know, so the whole envelope was refused —
    // and every test that read the records rather than the envelope passed.
    const response = await handleAgentAuditRequest(
      keywordRequest(["acme"]),
      "seo",
      dependencies({
        readSearchPerformance: async () => searchRegion,
        readPagePerformance: async () => ({
          status: "ok" as const,
          weight: null,
          field: {
            url: "https://acme.test/",
            sourceLevel: "url" as const,
            lcp: 2_100,
            inp: 150,
            cls: 0.04,
            ttfb: 600,
            formFactor: "mobile" as const,
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      data: {
        result: {
          keywordChecks?: { records: readonly unknown[] };
          pagePerformance?: { records: readonly unknown[] };
        };
      };
    };

    expect(response.status).toBe(200);
    // Every region present, and the guard accepting the whole envelope with
    // all of them attached at once.
    expect(body.data.result.keywordChecks?.records.length).toBeGreaterThan(0);
    expect(body.data.result.pagePerformance?.records).toHaveLength(6);
    expect(isAgentAuditSuccessEnvelope(body)).toBe(true);
  });

  it("attaches the visitor's search region beside the crawl ledger", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ readSearchPerformance: async () => searchRegion }),
    );
    const body = (await response.json()) as {
      data: { result: { searchPerformance?: typeof searchRegion; records: unknown[] } };
    };

    expect(response.status).toBe(200);
    expect(body.data.result.searchPerformance).toEqual(searchRegion);
    // Beside, not inside: the crawl ledger is what gets cached by host, and
    // these numbers belong to one visitor's verified property.
    expect(body.data.result.records).toHaveLength(47);
  });

  it("omits the region entirely when nothing covers the host", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ readSearchPerformance: async () => null }),
    );
    const body = (await response.json()) as {
      data: { result: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect("searchPerformance" in body.data.result).toBe(false);
  });

  it("finishes the audit when the Search Console read throws", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        readSearchPerformance: async () => {
          throw new Error("429 from Search Console");
        },
      }),
    );
    const body = (await response.json()) as {
      data: { result: Record<string, unknown> };
    };

    // A rate limit, an expired token or a slow property is not a failed audit.
    // The crawl evidence is complete and the search checks report the
    // authorization they need, which is a state the visitor can act on.
    expect(response.status).toBe(200);
    expect("searchPerformance" in body.data.result).toBe(false);
  });

  it("returns auth_required before reading the body or invoking the audit", async () => {
    const incoming = request();
    const delegate = vi.fn(async () => success());
    const response = await handleAgentAuditRequest(incoming, "seo", {
      authenticate: vi.fn(async () => "unauthenticated" as const),
      delegate,
      reportAs: "agent-audit",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(incoming.bodyUsed).toBe(false);
    expect(delegate).not.toHaveBeenCalled();
  });

  it("reports unavailable authentication without claiming the visitor is signed out", async () => {
    const incoming = request();
    const delegate = vi.fn(async () => success());
    const response = await handleAgentAuditRequest(incoming, "tech", {
      authenticate: async () => {
        throw new Error("Supabase unavailable");
      },
      delegate,
      reportAs: "agent-audit",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
    expect(incoming.bodyUsed).toBe(false);
    expect(delegate).not.toHaveBeenCalled();
  });

  it("authenticates before delegating the original request instance", async () => {
    const order: string[] = [];
    const incoming = request("application/x-ndjson");
    const response = await handleAgentAuditRequest(
      incoming,
      "seo",
      {
        authenticate: async () => {
          order.push("auth");
          return "authenticated";
        },
        delegate: async (forwarded, input) => {
          order.push("delegate");
          // Identity, not a copy: a reconstructed Request lost Next's own
          // state and crashed in production.
          expect(forwarded).toBe(incoming);
          expect(forwarded.headers.get("accept")).toBe(
            "application/x-ndjson",
          );
          // The body was read once, up there, and handed over rather than
          // left for this layer to read a second time.
          expect(input).toEqual({
            url: "acme.test",
            targetQueries: null,
            pageRole: null,
            market: null,
            language: null,
          });
          return success();
        },
        reportAs: "agent-audit",
      },
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["auth", "delegate"]);
  });

  it("returns the complete neutral ledger for SEO without inventing evaluation fields", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies(),
    );
    const body = await response.json();

    expect(body).toEqual({
      data: {
        run: {
          agent: "seo",
          mode: "authenticated_agent",
          persistence: "none",
          source: {
            tool: "seo_audit",
            schemaVersion: "seo_audit.sitewide.v15",
            completedAt: "2026-08-12T09:00:00.000Z",
            cache: { status: "miss", capturedAt: null },
          },
        },
        result: {
          targetUrl: upstreamPayload.result.targetUrl,
          siteOrigin: upstreamPayload.result.siteOrigin,
          scannedAt: upstreamPayload.result.scannedAt,
          targetInspected: upstreamPayload.result.targetInspected,
          inspectedTargetUrl: upstreamPayload.result.inspectedTargetUrl,
          targetPageExtract: null,
          coverage: upstreamPayload.result.coverage,
          siteResources: upstreamPayload.result.siteResources,
          records: upstreamPayload.result.records,
          // Present with nothing measured, which is the informative shape: the
          // limitation code says "no field-data source was configured" rather
          // than leaving the reader to guess between that and "CrUX has no data
          // for your page". The records come from the producer so this cannot
          // drift from what the handler attaches.
          pagePerformance: {
            version: AGENT_PAGE_PERFORMANCE_VERSION,
            records: [
              ...buildPagePerformanceRecords(null),
              ...buildPageWeightRecords(null),
              ...buildImageWeightRecords(null),
            ],
          },
        },
      },
    });
    expect("pages" in body.data.result).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(
      /"(?:score|priority|impact|opportunities)"/,
    );
  });

  it("rebuilds nested evidence objects from only public contract fields", async () => {
    const observedRecord = upstreamPayload.result.records[0]!;
    const upstream = Response.json({
      data: {
        ...upstreamPayload,
        result: {
          ...upstreamPayload.result,
          coverage: {
            ...upstreamPayload.result.coverage,
            debug: { requestId: "private-coverage-id" },
          },
          siteResources: {
            ...upstreamPayload.result.siteResources,
            internal: { robotsBody: "private robots body" },
          },
          records: upstreamPayload.result.records.map((entry) =>
            entry.id === observedRecord.id
              ? {
                  ...entry,
                  pages: [{ html: "private page source" }],
                  observations: entry.observations.map((observation) => ({
                    ...observation,
                    secret: "private observation metadata",
                    values: observation.values.map((value) => ({
                      ...value,
                      raw: "private raw measurement",
                    })),
                  })),
                }
              : entry,
          ),
        },
      },
    });

    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: async () => upstream }),
    );
    const body = await response.json();

    expect(body.data.result).toEqual({
      targetUrl: upstreamPayload.result.targetUrl,
      siteOrigin: upstreamPayload.result.siteOrigin,
      scannedAt: upstreamPayload.result.scannedAt,
      targetInspected: upstreamPayload.result.targetInspected,
      inspectedTargetUrl: upstreamPayload.result.inspectedTargetUrl,
      targetPageExtract: null,
      coverage: upstreamPayload.result.coverage,
      siteResources: upstreamPayload.result.siteResources,
      records: upstreamPayload.result.records,
      pagePerformance: {
        version: AGENT_PAGE_PERFORMANCE_VERSION,
        records: [
          ...buildPagePerformanceRecords(null),
          ...buildPageWeightRecords(null),
          ...buildImageWeightRecords(null),
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("returns the same complete neutral ledger for Tech with independent run identity", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "tech",
      dependencies(),
    );
    const body = await response.json();

    expect(body.data.run.agent).toBe("tech");
    expect(body.data.result.records).toEqual(upstreamPayload.result.records);
    expect(body.data.result.records).toHaveLength(47);
  });

  it.each([
    [
      "unknown record ID",
      (records: SeoAuditRecord[]) => {
        records[0] = { ...records[0]!, id: "future_unknown_record" };
      },
    ],
    [
      "known record with the wrong category",
      (records: SeoAuditRecord[]) => {
        records[0] = { ...records[0]!, category: "metadata" };
      },
    ],
    [
      "missing record",
      (records: SeoAuditRecord[]) => {
        records.pop();
      },
    ],
    [
      "duplicate record",
      (records: SeoAuditRecord[]) => {
        records[1] = records[0]!;
      },
    ],
  ] as const)("fails closed for a successful upstream ledger with a %s", async (_label, mutate) => {
    const payload = structuredClone(upstreamPayload);
    mutate(payload.result.records);
    const upstream = Response.json({ data: payload });

    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });

  it("rebuilds a known upstream error and copies only safe retry headers", async () => {
    const upstream = Response.json(
      { error: { code: "robots_disallowed" } },
      {
        status: 422,
        headers: {
          "retry-after": "5",
          "x-ratelimit-limit": "12",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1786525200",
          "set-cookie": "private_session=secret",
          "x-debug-id": "private-request-id",
          "x-upstream-marker": "private-marker",
          "content-length": "999999",
        },
      },
    );
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response).not.toBe(upstream);
    expect(response.status).toBe(422);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("x-ratelimit-limit")).toBe("12");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("x-ratelimit-reset")).toBe("1786525200");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-debug-id")).toBeNull();
    expect(response.headers.get("x-upstream-marker")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({
      error: { code: "robots_disallowed" },
    });
  });

  it.each([
    [
      "non-JSON transport",
      new Response(JSON.stringify({ error: { code: "robots_disallowed" } }), {
        status: 422,
        headers: { "content-type": "text/plain", "retry-after": "5" },
      }),
    ],
    [
      "unknown code",
      Response.json({ error: { code: "private_backend_failure" } }, { status: 502 }),
    ],
    [
      "extra private fields",
      Response.json(
        {
          error: {
            code: "robots_disallowed",
            debug: "private stack trace",
          },
        },
        { status: 422 },
      ),
    ],
    [
      "code/status mismatch",
      Response.json({ error: { code: "robots_disallowed" } }, { status: 500 }),
    ],
    [
      "oversized JSON",
      new Response(
        `${JSON.stringify({ error: { code: "robots_disallowed" } })}${" ".repeat(5_000)}`,
        {
          status: 422,
          headers: { "content-type": "application/json" },
        },
      ),
    ],
  ])("fails closed for a malformed upstream error: %s", async (_label, upstream) => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });

  it("preserves cache headers and records their provenance", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () =>
          success({
            "X-Crawl-Cache": "hit",
            "X-Crawl-Captured-At": "2026-08-12T08:30:00.000Z",
          }),
      }),
    );
    const body = await response.json();

    expect(response.headers.get("x-crawl-cache")).toBe("hit");
    expect(response.headers.get("x-crawl-captured-at")).toBe(
      "2026-08-12T08:30:00.000Z",
    );
    expect(body.data.run.source.cache).toEqual({
      status: "hit",
      capturedAt: "2026-08-12T08:30:00.000Z",
    });
  });

  it("forces an explicit cache miss to carry null capture provenance", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () => success({ "X-Crawl-Cache": "miss" }),
      }),
    );
    const body = await response.json();

    expect(body.data.run.source.cache).toEqual({
      status: "miss",
      capturedAt: null,
    });
    expect(response.headers.get("x-crawl-cache")).toBe("miss");
    expect(response.headers.get("x-crawl-captured-at")).toBeNull();
  });

  it.each([
    [
      "cache hit without capturedAt",
      success({ "X-Crawl-Cache": "hit" }),
    ],
    [
      "cache hit with an invalid capturedAt",
      success({
        "X-Crawl-Cache": "hit",
        "X-Crawl-Captured-At": "yesterday",
      }),
    ],
    [
      "cache miss with capturedAt",
      success({
        "X-Crawl-Cache": "miss",
        "X-Crawl-Captured-At": "2026-08-12T08:30:00.000Z",
      }),
    ],
    [
      "implicit cache miss with capturedAt",
      success({ "X-Crawl-Captured-At": "2026-08-12T08:30:00.000Z" }),
    ],
    [
      "unknown cache status",
      success({ "X-Crawl-Cache": "stale" }),
    ],
  ])("fails closed for invalid cache provenance: %s", async (_label, upstream) => {
    const response = await handleAgentAuditRequest(
      request(),
      "tech",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });

  it.each([
    ["completedAt", "not-a-timestamp"],
    ["completedAt", "2026-08-12T09:00:00Z"],
    ["scannedAt", "2026-02-30T09:00:00.000Z"],
    ["scannedAt", "2026-08-12T09:00:00.000+00:00"],
  ] as const)(
    "fails closed for a non-canonical %s provenance timestamp",
    async (field, invalidTimestamp) => {
      const payload = structuredClone(upstreamPayload);
      if (field === "completedAt") payload.run.completedAt = invalidTimestamp;
      else payload.result.scannedAt = invalidTimestamp;
      const upstream = Response.json({ data: payload });

      const response = await handleAgentAuditRequest(
        request(),
        "seo",
        dependencies({ delegate: async () => upstream }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error: { code: "audit_response_invalid" },
      });
    },
  );

  it("does not reuse the upstream body's content length", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () => success({ "Content-Length": "999999" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("does not copy private upstream headers on a successful projection", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () =>
          success({
            "set-cookie": "private_session=secret",
            "x-debug-id": "private-request-id",
          }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-debug-id")).toBeNull();
  });

  it.each([
    ["invalid JSON", new Response("not json", { status: 200 })],
    ["invalid shape", Response.json({ data: { nope: true } })],
    [
      "wrong crawl schema",
      Response.json({
        data: {
          ...upstreamPayload,
          run: {
            ...upstreamPayload.run,
            // An older schema: what a cache entry written before a bump holds.
            // A reader must refuse a version it was not built for rather than
            // assume the fields it knows are still there.
            schemaVersion: "seo_audit.sitewide.v5",
          },
        },
      }),
    ],
    [
      "wrong crawl scope",
      Response.json({
        data: {
          ...upstreamPayload,
          run: { ...upstreamPayload.run, scope: "unbounded_web_crawl" },
        },
      }),
    ],
    [
      "NDJSON transport",
      new Response(`${JSON.stringify({ data: upstreamPayload })}\n`, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      }),
    ],
  ])("fails closed for a malformed 200 response: %s", async (_label, upstream) => {
    const response = await handleAgentAuditRequest(
      request(),
      "tech",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });
  /**
   * The gate the contract calls unskippable: six wiring steps sit between the
   * upstream payload and the client, and a break in any one of them leaves the
   * unit tests green while the browser never sees a keyword region.
   */
  it("delivers the keyword region to the client end to end", async () => {
    const response = await handleAgentAuditRequest(
      keywordRequest(["birth chart"], "tool"),
      "seo",
      dependencies({ delegate: vi.fn(async () => successWithExtract()) }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        result: {
          targetPageExtract: { title: string } | null;
          keywordEvidence?: {
            availability: string;
            pageRole: string | null;
            queries: readonly {
              displayQuery: string;
              slots: { title: { state: string } };
            }[];
          };
        };
      };
    };

    expect(body.data.result.targetPageExtract?.title).toBe(
      "Acme birth chart calculator",
    );
    const evidence = body.data.result.keywordEvidence;
    expect(evidence?.availability).toBe("available");
    expect(evidence?.pageRole).toBe("tool");
    expect(evidence?.queries[0]?.displayQuery).toBe("birth chart");
    expect(evidence?.queries[0]?.slots.title.state).toBe("covered");
  });

  it("answers two callers asking about the same page with their own queries", async () => {
    const delegate = vi.fn(async () => successWithExtract());

    const first = (await (
      await handleAgentAuditRequest(
        keywordRequest(["birth chart"]),
        "seo",
        dependencies({ delegate }),
      )
    ).json()) as { data: { result: { keywordEvidence?: { queries: readonly { displayQuery: string }[] } } } };
    const second = (await (
      await handleAgentAuditRequest(
        keywordRequest(["horoscope"]),
        "seo",
        dependencies({ delegate }),
      )
    ).json()) as { data: { result: { keywordEvidence?: { queries: readonly { displayQuery: string }[] } } } };

    expect(first.data.result.keywordEvidence?.queries[0]?.displayQuery).toBe(
      "birth chart",
    );
    expect(second.data.result.keywordEvidence?.queries[0]?.displayQuery).toBe(
      "horoscope",
    );
  });

  it("omits the region entirely when no queries were submitted", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: vi.fn(async () => successWithExtract()) }),
    );

    const body = (await response.json()) as {
      data: { result: Record<string, unknown> };
    };
    expect("keywordEvidence" in body.data.result).toBe(false);
  });

  it.each([
    // Two different facts, two different answers. Telling someone their page
    // was unreachable when it was collected and read fine is a wrong answer,
    // not a vague one.
    [true, "extract_missing"],
    [false, "target_page_not_captured"],
  ])(
    "names why the region is unavailable when targetInspected is %s",
    async (targetInspected, reason) => {
      const response = await handleAgentAuditRequest(
        keywordRequest(["birth chart"]),
        "seo",
        dependencies({
          delegate: vi.fn(async () =>
            Response.json({
              data: {
                ...upstreamPayload,
                result: {
                  ...upstreamPayload.result,
                  targetInspected,
                  inspectedTargetUrl: targetInspected
                    ? upstreamPayload.result.inspectedTargetUrl
                    : null,
                  targetPageExtract: null,
                },
              },
            }),
          ),
        }),
      );

      const body = (await response.json()) as {
        data: {
          result: { keywordEvidence?: { availability: string; reason?: string } };
        };
      };
      expect(body.data.result.keywordEvidence?.availability).toBe("unavailable");
      expect(body.data.result.keywordEvidence?.reason).toBe(reason);
    },
  );

  it("rejects a sixth query before delegating anything", async () => {
    const delegate = vi.fn(async () => successWithExtract());
    const response = await handleAgentAuditRequest(
      keywordRequest(["a", "b", "c", "d", "e", "f"]),
      "seo",
      dependencies({ delegate }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(delegate).not.toHaveBeenCalled();
  });
  /**
   * The keyword layer made this boundary read the body itself. The bounded
   * reader it has to use streams with a byte cap and cancels past it; a plain
   * `json()` buffers whatever arrives, which turns a 4 KB limit into none.
   */
  it("rejects an oversized body without buffering it or delegating", async () => {
    const delegate = vi.fn(async () => successWithExtract());
    const response = await handleAgentAuditRequest(
      new Request("https://gengrowth.ai/api/agents/seo/audit", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-real-ip": "203.0.113.9",
        },
        body: JSON.stringify({ url: "acme.test", targetQueries: ["x".repeat(9_000)] }),
      }),
      "seo",
      dependencies({ delegate }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
    expect(delegate).not.toHaveBeenCalled();
  });

  it("keeps the wrong-media-type answer a 415 rather than a generic 400", async () => {
    const delegate = vi.fn(async () => successWithExtract());
    const response = await handleAgentAuditRequest(
      new Request("https://gengrowth.ai/api/agents/seo/audit", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "text/plain",
          "x-real-ip": "203.0.113.9",
        },
        body: JSON.stringify({ url: "acme.test" }),
      }),
      "seo",
      dependencies({ delegate }),
    );

    expect(response.status).toBe(415);
    expect(delegate).not.toHaveBeenCalled();
  });

  it("does not forward a field an upstream extract was not supposed to carry", async () => {
    const response = await handleAgentAuditRequest(
      keywordRequest(["birth chart"]),
      "seo",
      dependencies({
        delegate: vi.fn(async () =>
          Response.json({
            data: {
              ...upstreamPayload,
              result: {
                ...upstreamPayload.result,
                targetPageExtract: {
                  url: "https://acme.test/",
                  title: "Acme",
                  metaDescription: null,
                  h1: [],
                  subHeadings: null,
                  openingText: null,
                  staticBodyWords: null,
                  staticBodyUnits: null,
                  termFrequencies: null,
                  truncatedLists: false,
                  headingLevels: null,
                  wordsUnderEachH3: null,
                  rawHtml: "<html>everything the crawler held</html>",
                },
              },
            },
          }),
        ),
      }),
    );

    // The upstream guard rejects the unknown key outright, which is the answer
    // that cannot leak: a projection that merely copied the named fields would
    // still have accepted the payload.
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });

  it("bounds the extract instead of publishing whatever length arrived", async () => {
    const response = await handleAgentAuditRequest(
      keywordRequest(["birth chart"]),
      "seo",
      dependencies({
        delegate: vi.fn(async () =>
          Response.json({
            data: {
              ...upstreamPayload,
              result: {
                ...upstreamPayload.result,
                targetPageExtract: {
                  url: "https://acme.test/",
                  title: "x".repeat(5_000),
                  metaDescription: null,
                  h1: [],
                  subHeadings: null,
                  openingText: null,
                  staticBodyWords: null,
                  staticBodyUnits: null,
                  termFrequencies: null,
                  truncatedLists: false,
                  headingLevels: null,
                  wordsUnderEachH3: null,
                },
              },
            },
          }),
        ),
      }),
    );

    expect(response.status).toBe(502);
  });
});

/**
 * The results-page lookup, which only one of the two routes pays for.
 *
 * It runs after the crawl has already succeeded, so every one of its outcomes
 * has to leave the check intact — including the one where the provider is down.
 */
describe("the results-page region", () => {
  function landscapeRequest(): Request {
    return new Request("https://gengrowth.ai/api/tools/on-page-seo-check", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-real-ip": "203.0.113.9",
      },
      body: JSON.stringify({
        url: "acme.test",
        targetQueries: ["acme pricing", "pricing plans"],
        market: "GB",
        language: "en",
      }),
    });
  }

  it("looks up the query the evidence layer already called primary", async () => {
    const readSerpLandscape = vi.fn(async () => ({
      availability: "unavailable" as const,
      reason: "provider_unavailable" as const,
    }));

    await handleAgentAuditRequest(
      landscapeRequest(),
      "seo",
      dependencies({ readSerpLandscape, delegate: async () => successWithExtract() }),
    );

    expect(readSerpLandscape).toHaveBeenCalledOnce();
    const [input] = readSerpLandscape.mock.calls[0] as unknown as [
      { query: string; market: string; language: string; targetUrl: string },
    ];
    // The evidence layer's own primary, not a second choice made here: two
    // choosers would let the results page and the coverage table disagree
    // about which word the page is being judged on.
    expect(input.query).toBe("acme pricing");
    expect(input.market).toBe("GB");
    expect(input.language).toBe("en");
  });

  it("looks nothing up when the page was never read", async () => {
    // The default fixture has no extract, so there is no evidence and no
    // primary query. A lookup here would be a paid call about a page we could
    // not open.
    const readSerpLandscape = vi.fn(async () => ({
      availability: "unavailable" as const,
      reason: "no_target_query" as const,
    }));

    await handleAgentAuditRequest(
      landscapeRequest(),
      "seo",
      dependencies({ readSerpLandscape }),
    );

    const [input] = readSerpLandscape.mock.calls[0] as unknown as [
      { query: string | null },
    ];
    expect(input.query).toBeNull();
  });

  it("publishes what it found", async () => {
    const response = await handleAgentAuditRequest(
      landscapeRequest(),
      "seo",
      dependencies({
        readSerpLandscape: async () => ({
          availability: "available" as const,
          query: "acme pricing",
          market: "GB",
          language: "en",
          resultsObserved: 2,
          withSitelinks: 1,
          features: ["organic"],
          targetPosition: 2,
          targetPageOnPage: true,
          rows: [
            {
              position: 1,
              domain: "big.com",
              sitelinkCount: 3,
              isTarget: false,
              isTargetPage: null,
            },
            {
              position: 2,
              domain: "acme.test",
              sitelinkCount: 0,
              isTarget: true,
              isTargetPage: true,
            },
          ],
        }),
      }),
    );

    const body = (await response.json()) as {
      data: { result: { serpLandscape?: { targetPosition: number } } };
    };
    expect(body.data.result.serpLandscape?.targetPosition).toBe(2);
  });

  it("leaves the check whole when the lookup is not attached", async () => {
    const response = await handleAgentAuditRequest(
      landscapeRequest(),
      "seo",
      dependencies(),
    );

    const body = (await response.json()) as {
      data: { result: Record<string, unknown> };
    };
    expect(response.status).toBe(200);
    expect(Object.hasOwn(body.data.result, "serpLandscape")).toBe(false);
  });
});
