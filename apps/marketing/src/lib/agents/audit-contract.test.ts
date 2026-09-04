// @input  -- candidate Agent API success envelopes
// @output -- proof that the client guard accepts only the frozen evidence contract
// @pos    -- focused contract tests shared by Agent API and client rendering

import { describe, expect, it } from "vitest";
import {
  KEYWORD_EVIDENCE_VERSION,
  TEXT_UNITS_VERSION,
} from "@sf/public-tools/seo-audit/keyword-evidence/types";
import {
  buildIndexCoverageRecords,
  INDEX_COVERAGE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/index-coverage";
import {
  buildSearchPerformanceRecords,
  SEARCH_PERFORMANCE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/search-performance";
import { buildSerpShapeRecords } from "@sf/public-tools/seo-audit/serp-shape";
import type { SeoAuditPage } from "@sf/public-tools/seo-audit/types";
import {
  AGENT_SEARCH_PERFORMANCE_VERSION,
  AGENT_SERP_SHAPE_VERSION,
  AGENT_KEY_PAGE_WIRE_LIMIT,
  isAgentAuditSuccessEnvelope,
  type AgentAuditSuccessEnvelope,
  AGENT_AUDIT_RECORD_CATEGORIES,
} from "./audit-contract.ts";

// Derived from the producer's ledger, not a third hand-written copy of it. The
// copy that used to live here is why a detector could land in the crawl and the
// guard in this very file could start refusing real payloads with these tests
// green.
const RECORD_SPECS = Object.entries(AGENT_AUDIT_RECORD_CATEGORIES);

function searchPage(
  path: string,
  finalStatus: number,
  redirectHops = 0,
): SeoAuditPage {
  const url = `https://acme.test${path}`;
  return {
    url,
    subjectUrl: url,
    finalUrl: url,
    depth: 1,
    initialStatus: finalStatus,
    finalStatus,
    redirectHops,
    contentType: "text/html; charset=utf-8",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: url,
    title: "Acme",
    metaDescription: "Acme page",
    h1Count: 1,
    headingsCount: 1,
    wordCount: 300,
    inboundLinks: 1,
    outboundLinks: 1,
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
  };
}

const success = {
  data: {
    run: {
      agent: "seo",
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: "seo_audit.sitewide.v18",
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
      landedTargetUrl: "https://acme.test/",
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
        navigationUrls: ["https://acme.test/pricing"],
        sitemapUrls: [],
        sitemapUrlsComplete: true,
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

const searchPerformanceRecords = [
  ...buildSearchPerformanceRecords(
    {
      property: "sc-domain:acme.test",
      startDate: "2026-07-19",
      endDate: "2026-08-15",
      pages: [
        {
          key: "https://acme.test/",
          clicks: 3,
          impressions: 80,
          position: 4,
        },
        {
          key: "https://acme.test/retired",
          clicks: 0,
          impressions: 10,
          position: 8,
        },
      ],
      queries: [{ key: "acme", clicks: 3, impressions: 90, position: 4 }],
      pagesTruncated: false,
      queriesTruncated: false,
      targetPageQueries: null,
      targetPageUrl: null,
      confirmedQueries: [],
      targetPageQueriesTruncated: false,
    },
    [
      searchPage("/", 200),
      searchPage("/retired", 410),
      searchPage("/without-impressions", 200),
    ],
  ),
  ...buildIndexCoverageRecords([
    { url: "https://acme.test/", verdict: "PASS" },
    { url: "https://acme.test/retired", verdict: "NEUTRAL" },
  ]),
];

function withSearchPerformance(
  records: readonly unknown[] = searchPerformanceRecords,
  version: string = AGENT_SEARCH_PERFORMANCE_VERSION,
): unknown {
  return {
    data: {
      ...success.data,
      result: {
        ...success.data.result,
        searchPerformance: {
          version,
          property: "sc-domain:acme.test",
          startDate: "2026-07-19",
          endDate: "2026-08-15",
          records,
        },
      },
    },
  };
}

function withSerpShape(serpShape: unknown): unknown {
  return {
    data: {
      ...success.data,
      result: { ...success.data.result, serpShape },
    },
  };
}

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
      // Pinned as a literal so adding a detector shows up here as a number
      // someone has to change on purpose.
      expect(envelope.data.result.records).toHaveLength(55);
      expect("pages" in envelope.data.result).toBe(false);
    },
  );

  it("keeps legacy navigation absence readable but rejects malformed present URLs", () => {
    const legacy = structuredClone(success) as unknown as {
      data: { result: { siteResources: Record<string, unknown> } };
    };
    delete legacy.data.result.siteResources["navigationUrls"];
    const malformed = structuredClone(success) as unknown as {
      data: { result: { siteResources: Record<string, unknown> } };
    };
    malformed.data.result.siteResources["navigationUrls"] = [123];

    expect(isAgentAuditSuccessEnvelope(legacy)).toBe(true);
    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("keeps legacy crawl-tier absence readable and validates a present tier", () => {
    expect(isAgentAuditSuccessEnvelope(success)).toBe(true);
    for (const crawlTier of ["key-pages", "full-site"] as const) {
      const current = structuredClone(success) as unknown as {
        data: { result: Record<string, unknown> };
      };
      current.data.result["crawlTier"] = crawlTier;
      expect(isAgentAuditSuccessEnvelope(current)).toBe(true);
    }
    const malformed = structuredClone(success) as unknown as {
      data: { result: Record<string, unknown> };
    };
    malformed.data.result["crawlTier"] = "sitewide";
    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  describe("the key page shortlist", () => {
    function withKeyPages(keyPages: unknown): unknown {
      const envelope = structuredClone(success) as unknown as {
        data: { result: Record<string, unknown> };
      };
      envelope.data.result["keyPages"] = keyPages;
      return envelope;
    }

    const valid = {
      url: "https://example.com/pricing",
      title: "Pricing",
      metaDescription: "What it costs",
      depth: 1,
      inboundLinks: 4,
      reason: "navigation",
    };

    it("reads an envelope that carries no shortlist at all", () => {
      // Absent is the honest state for a cached payload written before this
      // region existed, and for a crawl that collected nothing.
      expect("keyPages" in success.data.result).toBe(false);
      expect(isAgentAuditSuccessEnvelope(success)).toBe(true);
      expect(isAgentAuditSuccessEnvelope(withKeyPages([]))).toBe(true);
      expect(isAgentAuditSuccessEnvelope(withKeyPages([valid]))).toBe(true);
    });

    it("refuses a row carrying anything the six published fields do not name", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withKeyPages([{ ...valid, rawHtml: "<html>" }]),
        ),
      ).toBe(false);
    });

    it("refuses a row missing a published field", () => {
      const { reason: _dropped, ...incomplete } = valid;
      expect(isAgentAuditSuccessEnvelope(withKeyPages([incomplete]))).toBe(
        false,
      );
    });

    it("refuses counts that cannot be counts", () => {
      expect(
        isAgentAuditSuccessEnvelope(withKeyPages([{ ...valid, depth: -1 }])),
      ).toBe(false);
      expect(
        isAgentAuditSuccessEnvelope(
          withKeyPages([{ ...valid, inboundLinks: 1.5 }]),
        ),
      ).toBe(false);
    });

    it.each([
      ["home", "home"],
      ["target", "target"],
      ["navigation", "navigation"],
      ["manual", "manual"],
      ["full site", "full-site"],
      ["cluster", { kind: "cluster", prefix: "/tools/" }],
      ["content", { kind: "content", inboundLinks: 4 }],
    ] as const)("accepts the %s reason", (_name, reason) => {
      expect(
        isAgentAuditSuccessEnvelope(withKeyPages([{ ...valid, reason }])),
      ).toBe(true);
    });

    it.each([
      ["unknown string", "featured"],
      ["cluster root", { kind: "cluster", prefix: "/" }],
      ["cluster without trailing slash", { kind: "cluster", prefix: "/tools" }],
      ["cluster with two segments", { kind: "cluster", prefix: "/tools/free/" }],
      ["cluster with an extra key", { kind: "cluster", prefix: "/tools/", rank: 1 }],
      ["content without inbound links", { kind: "content" }],
      ["content with an extra key", { kind: "content", inboundLinks: 4, rank: 1 }],
      ["unknown object kind", { kind: "manual" }],
    ])("rejects a %s reason", (_name, reason) => {
      expect(
        isAgentAuditSuccessEnvelope(withKeyPages([{ ...valid, reason }])),
      ).toBe(false);
    });

    it("requires a content reason to repeat the row's exact inbound count", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withKeyPages([
            { ...valid, reason: { kind: "content", inboundLinks: 3 } },
          ]),
        ),
      ).toBe(false);
      expect(
        isAgentAuditSuccessEnvelope(
          withKeyPages([
            { ...valid, reason: { kind: "content", inboundLinks: -1 } },
          ]),
        ),
      ).toBe(false);
    });

    it("refuses a shortlist longer than the published bound", () => {
      expect(AGENT_KEY_PAGE_WIRE_LIMIT).toBe(2_000);
      expect(
        isAgentAuditSuccessEnvelope(
          withKeyPages(
            Array.from({ length: AGENT_KEY_PAGE_WIRE_LIMIT + 1 }, () => valid),
          ),
        ),
      ).toBe(false);
    });
  });

  describe("the key page safety-valve selection", () => {
    function withSelection(selection: unknown): unknown {
      const envelope = structuredClone(success) as unknown as {
        data: { result: Record<string, unknown> };
      };
      envelope.data.result["keyPageSelection"] = selection;
      return envelope;
    }

    it("keeps a legacy response without the optional region readable", () => {
      expect("keyPageSelection" in success.data.result).toBe(false);
      expect(isAgentAuditSuccessEnvelope(success)).toBe(true);
    });

    it("keeps an older one-list selection region readable", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withSelection({
            omittedUrls: Array.from(
              { length: 10 },
              (_, index) => `https://acme.test/blog/${index}`,
            ),
          }),
        ),
      ).toBe(true);
    });

    it("accepts the exact bounded unavailable-manual URL region", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withSelection({
            omittedUrls: [],
            manualUnavailableUrls: Array.from(
              { length: 10 },
              (_, index) => `https://acme.test/manual/${index}`,
            ),
          }),
        ),
      ).toBe(true);
    });

    it.each([
      ["non-array manual list", "none"],
      ["non-string manual URL", [123]],
      ["relative manual URL", ["/manual/one"]],
      [
        "duplicate manual URL",
        ["https://acme.test/manual/one", "https://acme.test/manual/one"],
      ],
      ["foreign-origin manual URL", ["https://other.test/manual/one"]],
      [
        "credential-bearing manual URL",
        ["https://user:pass@acme.test/manual/one"],
      ],
      [
        "fragment-bearing manual URL",
        ["https://acme.test/manual/one#details"],
      ],
      [
        "more than ten manual URLs",
        Array.from(
          { length: 11 },
          (_, index) => `https://acme.test/manual/${index}`,
        ),
      ],
    ])("rejects a %s", (_name, manualUnavailableUrls) => {
      expect(
        isAgentAuditSuccessEnvelope(
          withSelection({ omittedUrls: [], manualUnavailableUrls }),
        ),
      ).toBe(false);
    });

    it.each([
      ["missing list", {}],
      ["extra key", { omittedUrls: [], source: "content" }],
      ["non-array list", { omittedUrls: "none" }],
      ["non-string URL", { omittedUrls: [123] }],
      ["relative URL", { omittedUrls: ["/blog/one"] }],
      ["duplicate URL", {
        omittedUrls: [
          "https://acme.test/blog/one",
          "https://acme.test/blog/one",
        ],
      }],
      ["foreign-origin URL", {
        omittedUrls: ["https://other.test/blog/one"],
      }],
      ["credential-bearing URL", {
        omittedUrls: ["https://user:pass@acme.test/blog/one"],
      }],
      ["fragment-bearing URL", {
        omittedUrls: ["https://acme.test/blog/one#details"],
      }],
      ["more than ten URLs", {
        omittedUrls: Array.from(
          { length: 11 },
          (_, index) => `https://acme.test/blog/${index}`,
        ),
      }],
    ])("rejects a %s", (_name, selection) => {
      expect(isAgentAuditSuccessEnvelope(withSelection(selection))).toBe(false);
    });
  });

  describe("the derived Search Performance region", () => {
    it("refuses an envelope that predates a required projection field", () => {
    // The nine fixtures this field forced open only prove the CALLERS were
    // made to fill it, which is a compile-time fact. This is the runtime
    // decision written down: an envelope produced by a build that predates
    // `landedTargetUrl` is refused, not read with the field undefined.
    //
    // It is also the deploy-window contract. Old client + new server is safe
    // (an old guard ignores an extra key). New client + old server is THIS
    // path, reachable only by rolling the projection back while a newer bundle
    // is still open in a tab -- so if that revert ever happens, the guard has
    // to be reverted with it, and this test is what says so.
    const malformed = structuredClone(success) as unknown as {
      data: { result: Record<string, unknown> };
    };
    delete malformed.data.result["landedTargetUrl"];

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("accepts the complete producer ledger including index coverage", () => {
      const abandoned = searchPerformanceRecords.find(
        (record) => record.id === "abandoned_url_impression_share",
      );
      const indexCoverage = searchPerformanceRecords.find(
        (record) => record.id === "sitemap_url_not_indexed",
      );

      expect(searchPerformanceRecords).toHaveLength(
        SEARCH_PERFORMANCE_RECORD_IDS.length + INDEX_COVERAGE_RECORD_IDS.length,
      );
      expect(abandoned).toMatchObject({
        state: "observed",
        affected: 1,
      });
      expect(abandoned?.observations).toHaveLength(2);
      expect(indexCoverage).toMatchObject({
        state: "observed",
        affected: 1,
      });
      expect(indexCoverage?.observations).toHaveLength(2);
      expect(isAgentAuditSuccessEnvelope(withSearchPerformance())).toBe(true);
    });

    it("accepts the live aggregate shape with 361 tested, 3 affected, and 4 rows", () => {
      const records = structuredClone(searchPerformanceRecords) as unknown as Array<{
        id: string;
        tested: number;
        affected: number;
        observations: Array<{
          url: string | null;
          values: Array<{ label: string; value: unknown }>;
        }>;
      }>;
      const abandoned = records.find(
        (record) => record.id === "abandoned_url_impression_share",
      );
      const aggregate = abandoned?.observations[0];
      const detail = abandoned?.observations[1];
      if (!abandoned || !aggregate || !detail) {
        throw new Error("missing abandoned impression fixture");
      }

      abandoned.tested = 361;
      abandoned.affected = 3;
      abandoned.observations = [
        aggregate,
        detail,
        { ...structuredClone(detail), url: "https://acme.test/retired-2" },
        { ...structuredClone(detail), url: "https://acme.test/retired-3" },
      ];

      expect(abandoned.observations).toHaveLength(4);
      expect(isAgentAuditSuccessEnvelope(withSearchPerformance(records))).toBe(true);
    });

    it("rejects a known aggregate that drops its summary and matches the generic invariant", () => {
      const records = structuredClone(searchPerformanceRecords) as unknown as Array<{
        id: string;
        affected: number;
        observations: unknown[];
      }>;
      const abandoned = records.find(
        (record) => record.id === "abandoned_url_impression_share",
      );
      if (!abandoned) throw new Error("missing abandoned impression fixture");
      abandoned.observations = abandoned.observations.slice(1);
      expect(abandoned.observations).toHaveLength(abandoned.affected);

      expect(isAgentAuditSuccessEnvelope(withSearchPerformance(records))).toBe(false);
    });

    it("rejects a region missing the index coverage record", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withSearchPerformance(
            searchPerformanceRecords.filter(
              (record) => record.id !== INDEX_COVERAGE_RECORD_IDS[0],
            ),
          ),
        ),
      ).toBe(false);
    });

    it("rejects an extra or stale Search Performance ledger", () => {
      expect(
        isAgentAuditSuccessEnvelope(
          withSearchPerformance([
            ...searchPerformanceRecords,
            searchPerformanceRecords[0],
          ]),
        ),
      ).toBe(false);
      expect(
        isAgentAuditSuccessEnvelope(
          withSearchPerformance(
            searchPerformanceRecords,
            "search_performance.agent.v1",
          ),
        ),
      ).toBe(false);
    });
  });

  describe("the derived SERP shape region", () => {
    const records = buildSerpShapeRecords(null, "source_not_configured");
    const current = { version: AGENT_SERP_SHAPE_VERSION, records };

    it("accepts the complete current producer region", () => {
      expect(isAgentAuditSuccessEnvelope(withSerpShape(current))).toBe(true);
    });

    it.each([
      ["stale version", { ...current, version: "serp_shape.agent.v0" }],
      ["incomplete ledger", { ...current, records: records.slice(0, -1) }],
      ["malformed region", { ...current, records: "not-an-array" }],
    ])("rejects a %s", (_case, region) => {
      expect(isAgentAuditSuccessEnvelope(withSerpShape(region))).toBe(false);
    });
  });

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
    // An older schema, which is what a cache entry written before a bump holds.
    // A version this reader was not built for must be refused, not read on the
    // assumption that the fields it knows are still there.
    malformed.data.run.source.schemaVersion = "seo_audit.sitewide.v5";

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });
});
