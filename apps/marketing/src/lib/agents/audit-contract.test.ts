// @input  -- candidate Agent API success envelopes
// @output -- proof that the client guard accepts only the frozen evidence contract
// @pos    -- focused contract tests shared by Agent API and client rendering

import { describe, expect, it } from "vitest";
import {
  KEYWORD_EVIDENCE_VERSION,
  TEXT_UNITS_VERSION,
} from "@sf/public-tools/seo-audit/keyword-evidence/types";
import {
  isAgentAuditSuccessEnvelope,
  type AgentAuditSuccessEnvelope,
} from "./audit-contract.ts";

const RECORD_SPECS = [
  ["robots_resource", "crawl"],
  ["sitemap_resource", "crawl"],
  ["non_2xx_final_status", "crawl"],
  ["redirect_chain", "crawl"],
  ["http_url", "crawl"],
  ["noindex_directive", "indexability"],
  ["canonical_missing", "indexability"],
  ["canonical_differs", "indexability"],
  ["title_missing", "metadata"],
  ["title_duplicate", "metadata"],
  ["meta_description_missing", "metadata"],
  ["meta_description_duplicate", "metadata"],
  ["h1_missing", "structure"],
  ["multiple_h1", "structure"],
  ["sitemap_page_without_observed_inlink", "links"],
  ["internal_target_http_error", "links"],
  ["json_ld_parse_error", "structured_data"],
  ["page_outbound_broken_link", "links"],
  ["page_not_in_sitemap", "crawl"],
  ["title_length_outside_range", "metadata"],
  ["meta_description_length_outside_range", "metadata"],
  ["page_without_outbound_internal_link", "links"],
  ["click_depth_beyond_reviewed_limit", "links"],
  ["json_ld_missing", "structured_data"],
] as const;

const success = {
  data: {
    run: {
      agent: "seo",
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: "seo_audit.sitewide.v7",
        completedAt: "2026-08-12T09:00:00.000Z",
        cache: { status: "miss", capturedAt: null },
      },
    },
    result: {
      targetUrl: "https://acme.test/",
      siteOrigin: "https://acme.test",
      scannedAt: "2026-08-12T09:00:00.000Z",
      targetInspected: true,
      inspectedTargetUrl: "https://acme.test/",
      targetPageExtract: null,
      coverage: {
        availability: "available",
        pagesInspected: 1,
        linksObserved: 2,
        sitemapUrlsObserved: 1,
        urlsSkipped: 0,
        urlsBlocked: 0,
        urlsDisallowed: 0,
        urlsErrored: 0,
        stopReason: null,
      },
      siteResources: {
        robotsFetched: true,
        robotsGroupsObserved: 1,
        sitemapReferencesObserved: 1,
        sitemapFetched: true,
      },
      records: RECORD_SPECS.map(([id, category], index) => ({
        id,
        category,
        state: index === 0 ? ("observed" as const) : ("not_observed" as const),
        unit: "pages" as const,
        population: "every_collected_page" as const,
        targetTested: null,
        tested: 1,
        affected: index === 0 ? 1 : 0,
        observations:
          index === 0
            ? [
                {
                  url: "https://acme.test/",
                  values: [{ label: "sample", value: null }],
                },
              ]
            : [],
        limitation: null,
      })),
    },
  },
} satisfies AgentAuditSuccessEnvelope;

describe("isAgentAuditSuccessEnvelope", () => {
  it.each(["seo", "tech"] as const)(
    "accepts the same complete neutral ledger for the %s Agent",
    (agent) => {
      const envelope: AgentAuditSuccessEnvelope = {
        data: {
          ...success.data,
          run: { ...success.data.run, agent },
        },
      };

      expect(isAgentAuditSuccessEnvelope(envelope)).toBe(true);
      expect(envelope.data.result.records).toHaveLength(24);
      expect("pages" in envelope.data.result).toBe(false);
    },
  );

  it("rejects an unknown neutral record", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { result: { records: Array<{ id: string }> } };
    };
    malformed.data.result.records[0]!.id = "future_unknown_record";

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a known record with the wrong category", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { result: { records: Array<{ category: string }> } };
    };
    malformed.data.result.records[0]!.category = "metadata";

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it.each(["missing", "duplicate"] as const)(
    "rejects a %s record in the neutral ledger",
    (fault) => {
      const malformed = structuredClone(success) as unknown as {
        data: { result: { records: Array<unknown> } };
      };
      if (fault === "missing") malformed.data.result.records.pop();
      else malformed.data.result.records[1] = malformed.data.result.records[0];

      expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
    },
  );

  it.each([
    ["affected differs from observations", { tested: 2, affected: 2, state: "observed" }],
    ["affected exceeds tested", { tested: 0, affected: 1, state: "observed" }],
    ["observed has no affected observation", { tested: 1, affected: 0, state: "observed" }],
    ["not_observed has an affected observation", { tested: 1, affected: 1, state: "not_observed" }],
    ["unverified has an affected observation", { tested: 1, affected: 1, state: "unverified" }],
  ] as const)("rejects a projected record whose %s", (_description, contradiction) => {
    const malformed = structuredClone(success) as unknown as {
      data: {
        result: {
          records: Array<{
            tested: number;
            affected: number;
            state: string;
            observations: unknown[];
          }>;
        };
      };
    };
    const target = malformed.data.result.records[0]!;
    target.tested = contradiction.tested;
    target.affected = contradiction.affected;
    target.state = contradiction.state;
    target.observations = contradiction.affected === 0 ? [] : target.observations;

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects missing source provenance", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { run: { source: { schemaVersion?: string } } };
    };
    delete malformed.data.run.source.schemaVersion;

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects empty source version and timestamp provenance", () => {
    for (const key of ["schemaVersion", "completedAt"] as const) {
      const malformed = structuredClone(success) as unknown as {
        data: { run: { source: Record<(typeof key), string> } };
      };
      malformed.data.run.source[key] = "";

      expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
    }
  });

  it.each([
    ["completedAt", "not-a-timestamp"],
    ["completedAt", "2026-08-12T09:00:00Z"],
    ["scannedAt", "2026-02-30T09:00:00.000Z"],
    ["scannedAt", "2026-08-12T09:00:00.000+00:00"],
  ] as const)("rejects non-canonical %s provenance", (field, value) => {
    const malformed = structuredClone(success) as unknown as {
      data: {
        run: { source: { completedAt: string } };
        result: { scannedAt: string };
      };
    };
    if (field === "completedAt") malformed.data.run.source.completedAt = value;
    else malformed.data.result.scannedAt = value;

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it.each([
    ["hit", null],
    ["hit", "yesterday"],
    ["miss", "2026-08-12T08:30:00.000Z"],
  ] as const)(
    "rejects the invalid cache provenance combination %s/%s",
    (status, capturedAt) => {
      const malformed = structuredClone(success) as unknown as {
        data: {
          run: {
            source: {
              cache: { status: "hit" | "miss"; capturedAt: string | null };
            };
          };
        };
      };
      malformed.data.run.source.cache = { status, capturedAt };

      expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
    },
  );

  it("accepts a cache hit with canonical capture provenance", () => {
    const cached = structuredClone(success) as AgentAuditSuccessEnvelope;
    const withCacheHit = {
      data: {
        ...cached.data,
        run: {
          ...cached.data.run,
          source: {
            ...cached.data.run.source,
            cache: {
              status: "hit" as const,
              capturedAt: "2026-08-12T08:30:00.000Z",
            },
          },
        },
      },
    };

    expect(isAgentAuditSuccessEnvelope(withCacheHit)).toBe(true);
  });

  /**
   * The keyword region and the extract, present.
   *
   * The base fixture leaves both out, which is a valid response — and which
   * meant the ~135 lines of deep validation behind them were reachable by no
   * test at all: the whole branch could be deleted and this suite would stay
   * green.
   */
  describe("the derived keyword region", () => {
    const slot = (
      state: "covered" | "not_covered" | "not_applicable",
      occurrences: number | null,
    ) => ({ state, occurrences });

    const evidence = {
      availability: "available" as const,
      version: KEYWORD_EVIDENCE_VERSION,
      textUnitsVersion: TEXT_UNITS_VERSION,
      pageRole: "tool" as const,
      queries: [
        {
          displayQuery: "birth chart calculator",
          isPrimary: true,
          primaryReason: "most_fields_covered" as const,
          brandCandidate: "not_matched" as const,
          tokenization: "whitespace" as const,
          slots: {
            title: slot("covered", 1),
            description: slot("not_applicable", null),
            h1: slot("covered", 2),
            subHeadings: slot("not_covered", 0),
            openingText: slot("covered", 1),
            url: { state: "covered" as const },
          },
          capturedOccurrences: 4,
          density: {
            value: 0.0044,
            basis: "captured_text" as const,
            unitsBasis: "words" as const,
            numeratorUnits: 4,
            denominatorUnits: 900,
          },
        },
      ],
      focus: { covered: 4, applicable: 5 },
      limitations: ["captured_text_only"],
    };

    const extract = {
      url: "https://acme.test/",
      title: "Acme birth chart calculator",
      metaDescription: null,
      h1: ["Birth chart calculator"],
      subHeadings: ["How the chart is drawn"],
      openingText: "A birth chart maps the sky at a moment in time.",
      staticBodyWords: 900,
      staticBodyUnits: null,
      termFrequencies: null,
      truncatedLists: false,
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
    };

    function withEvidence(overrides: Record<string, unknown> = {}): unknown {
      return {
        data: {
          ...success.data,
          result: {
            ...success.data.result,
            targetPageExtract: extract,
            keywordEvidence: { ...evidence, ...overrides },
          },
        },
      };
    }

    it("accepts a complete region beside a complete extract", () => {
      expect(isAgentAuditSuccessEnvelope(withEvidence())).toBe(true);
    });

    it("accepts an unavailable region with a frozen reason", () => {
      expect(
        isAgentAuditSuccessEnvelope({
          data: {
            ...success.data,
            result: {
              ...success.data.result,
              keywordEvidence: {
                availability: "unavailable",
                reason: "target_page_not_captured",
                version: KEYWORD_EVIDENCE_VERSION,
              },
            },
          },
        }),
      ).toBe(true);
    });

    it("rejects an unavailable region with an invented reason", () => {
      expect(
        isAgentAuditSuccessEnvelope({
          data: {
            ...success.data,
            result: {
              ...success.data.result,
              keywordEvidence: {
                availability: "unavailable",
                reason: "crawl_was_slow",
                version: KEYWORD_EVIDENCE_VERSION,
              },
            },
          },
        }),
      ).toBe(false);
    });

    /**
     * The counting algorithm is what the density means. A region computed under
     * another version is not readable under these rules, so accepting any
     * string here would publish a number the reader cannot interpret.
     */
    it("rejects a region counted under a different text-units version", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withEvidence({ textUnitsVersion: "text_units.v2" }),
        ),
      ).toBe(false);
    });

    it.each([
      ["a non-array queries field", { queries: "none" }],
      ["no queries at all", { queries: [] }],
      ["more queries than the request may carry", {
        queries: [
          evidence.queries[0],
          evidence.queries[0],
          evidence.queries[0],
          evidence.queries[0],
          evidence.queries[0],
          evidence.queries[0],
        ],
      }],
      ["a null focus", { focus: null }],
      ["a focus counting more covered slots than applicable ones", {
        focus: { covered: 6, applicable: 5 },
      }],
      ["a fractional focus count", { focus: { covered: 1.5, applicable: 5 } }],
      ["a page role outside the frozen vocabulary", { pageRole: "landing" }],
      ["limitations that are not strings", { limitations: [{ code: "x" }] }],
      ["a stale region version", { version: "keyword_evidence.v0" }],
    ])("rejects %s", (_name, overrides) => {
      expect(isAgentAuditSuccessEnvelope(withEvidence(overrides))).toBe(false);
    });

    /**
     * The slot rule the house cares about most: `not_applicable` means there was
     * nothing to read, and it must not arrive carrying a count.
     */
    it("rejects a not_applicable slot that carries an occurrence count", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withEvidence({
            queries: [
              {
                ...evidence.queries[0],
                slots: {
                  ...evidence.queries[0]?.slots,
                  description: { state: "not_applicable", occurrences: 0 },
                },
              },
            ],
          }),
        ),
      ).toBe(false);
    });

    it("rejects a density that claims a basis we never measure", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withEvidence({
            queries: [
              {
                ...evidence.queries[0],
                density: {
                  ...evidence.queries[0]?.density,
                  basis: "full_page_body",
                },
              },
            ],
          }),
        ),
      ).toBe(false);
    });

    it("rejects an extract carrying a field the Agent does not publish", () => {
      expect(
        isAgentAuditSuccessEnvelope({
          data: {
            ...success.data,
            result: {
              ...success.data.result,
              targetPageExtract: { ...extract, rawHtml: "<html></html>" },
            },
          },
        }),
      ).toBe(false);
    });
  });

  it("rejects a response from a different crawl schema", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { run: { source: { schemaVersion: string } } };
    };
    // Not the accepted literal — the point of the case is disagreement.
    malformed.data.run.source.schemaVersion = "seo_audit.sitewide.v5";

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });
});
