import { describe, expect, expectTypeOf, it } from "vitest";

import {
  buildCompetitorKeywordGapReport,
  type CompetitorKeywordGapDataForSeoResult,
  type CompetitorKeywordGapGscRead,
  type CompetitorKeywordGapProviderRow,
} from "./report.ts";
import {
  COMPETITOR_KEYWORD_GAP_ERROR_CODES,
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
  type CompetitorKeywordGapEnvelope,
  type CompetitorKeywordGapResultV3,
  type CompetitorKeywordGapSampleRule,
} from "./types.ts";

const BASE = {
  completedAt: "2026-08-24T12:00:00.000Z",
  siteDomain: "acme.com",
  marketCode: "US",
  languageCode: "en",
  competitorDomains: ["one.example", "two.example", "three.example"],
  sampleRule: {
    maxCompetitorRank: 20,
    perCompetitorLimit: 300,
    serpSnapshotRequested: true,
  },
} as const;

const GSC_AVAILABLE_EMPTY: CompetitorKeywordGapGscRead = {
  status: "available",
  queryRows: [],
  queryPageRows: [],
  queryTruncated: false,
  queryPageTruncated: false,
};

/** One provider row with every paid-for v3 field silent unless the case says otherwise. */
function row(
  overrides: Partial<CompetitorKeywordGapProviderRow> & {
    readonly keyword: string;
    readonly firstDomainRank: number;
  },
): CompetitorKeywordGapProviderRow {
  return {
    searchVolume: 1_000,
    cpc: 1,
    keywordDifficulty: 20,
    providerIntent: "commercial",
    secondDomainRank: null,
    firstDomainUrl: null,
    firstDomainTitle: null,
    firstDomainEtv: null,
    coreKeyword: null,
    searchVolumeTrend: null,
    serpItemTypes: null,
    serpUpdatedAt: null,
    ...overrides,
  };
}

function providerResult(
  domain: string,
  overrides: Partial<CompetitorKeywordGapDataForSeoResult> = {},
): CompetitorKeywordGapDataForSeoResult {
  return {
    domain,
    status: "complete",
    rows: [],
    totalCount: 0,
    costUsd: 0.011,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...overrides,
  };
}

function reportFor(options?: {
  readonly competitors?: readonly CompetitorKeywordGapDataForSeoResult[];
  readonly gsc?: CompetitorKeywordGapGscRead | null;
  readonly competitorDomains?: readonly string[];
  readonly sampleRule?: CompetitorKeywordGapSampleRule;
}) {
  return buildCompetitorKeywordGapReport({
    ...BASE,
    sampleRule: options?.sampleRule ?? BASE.sampleRule,
    competitorDomains:
      options?.competitorDomains ?? ["one.example", "two.example"],
    competitors:
      options?.competitors ??
      [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "best crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 3,
            }),
          ],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [
            row({
              keyword: "best crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 7,
            }),
          ],
          totalCount: 1,
        }),
        providerResult("three.example"),
      ],
    gsc: options?.gsc ?? null,
  });
}

describe("buildCompetitorKeywordGapReport", () => {
  it("publishes the v3 schema version and the sample rule", () => {
    const report = reportFor();

    expect(report.run.status).toBe("complete");
    expect(report.run.schemaVersion).toBe("competitor_keyword_gap.v3");
    expect(report.run.schemaVersion).toBe(COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION);
    expect(report.result.sampleRule).toEqual({
      maxCompetitorRank: 20,
      perCompetitorLimit: 300,
      serpSnapshotRequested: true,
    });
    expectTypeOf<CompetitorKeywordGapEnvelope["result"]>().toEqualTypeOf<
      CompetitorKeywordGapResultV3
    >();
    expectTypeOf<
      CompetitorKeywordGapEnvelope["run"]["schemaVersion"]
    >().toEqualTypeOf<typeof COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION>();

    const narrower = reportFor({
      sampleRule: {
        maxCompetitorRank: 10,
        perCompetitorLimit: 50,
        serpSnapshotRequested: false,
      },
    });
    expect(narrower.result.sampleRule).toEqual({
      maxCompetitorRank: 10,
      perCompetitorLimit: 50,
      serpSnapshotRequested: false,
    });
  });

  it("freezes the envelope and nested public result paths", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "frozen term",
              searchVolume: 100,
              cpc: 2,
              keywordDifficulty: 8,
              providerIntent: "commercial",
              firstDomainRank: 4,
              firstDomainUrl: "https://one.example/frozen",
              firstDomainTitle: "Frozen",
              firstDomainEtv: 12,
              serpItemTypes: ["organic"],
              serpUpdatedAt: "2026-05-14T18:17:21.000Z",
            }),
          ],
          totalCount: 1,
        }),
      ],
    });

    const gapRow = report.result.rows[0];
    const coverage = report.result.competitors[0];
    expect(gapRow).toBeDefined();
    expect(coverage).toBeDefined();
    expect(gapRow?.serpSnapshot).not.toBeNull();
    for (const value of [
      report,
      report.run,
      report.result,
      report.result.rows,
      report.result.competitors,
      report.result.sampleRule,
      gapRow,
      gapRow?.competitorRanks,
      gapRow?.competitorPages,
      gapRow?.competitorPages["one.example"],
      gapRow?.serpSnapshot,
      gapRow?.serpSnapshot?.itemTypes,
      gapRow?.preScreen,
      gapRow?.gsc,
      coverage,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("keeps each competitor's best-rank page", () => {
    const report = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "crm software",
              firstDomainRank: 9,
              firstDomainUrl: "https://one.example/blog/crm-software",
              firstDomainTitle: "CRM software explained",
              firstDomainEtv: 40,
            }),
            row({
              keyword: "crm software",
              firstDomainRank: 3,
              firstDomainUrl: "https://one.example/crm",
              firstDomainTitle: "CRM software",
              firstDomainEtv: 900,
            }),
          ],
          totalCount: 2,
        }),
        providerResult("two.example", {
          rows: [row({ keyword: "crm software", firstDomainRank: 5 })],
          totalCount: 1,
        }),
      ],
    });

    const gapRow = report.result.rows[0];
    expect(gapRow?.competitorPages).toEqual({
      "one.example": {
        url: "https://one.example/crm",
        title: "CRM software",
        etv: 900,
      },
      "two.example": { url: null, title: null, etv: null },
    });
    expect(Object.keys(gapRow?.competitorPages ?? {})).toEqual(
      Object.keys(gapRow?.competitorRanks ?? {}),
    );
  });

  it("takes core keyword, trend and serp snapshot from the best evidence that has them", () => {
    const trend = { monthly: 5, quarterly: -10, yearly: 20 };
    const report = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [row({ keyword: "crm tools", firstDomainRank: 2 })],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [
            row({
              keyword: "crm tools",
              firstDomainRank: 5,
              coreKeyword: "crm",
              searchVolumeTrend: trend,
              serpItemTypes: ["organic", "ai_overview"],
              serpUpdatedAt: "2026-05-14T18:17:21.000Z",
            }),
          ],
          totalCount: 1,
        }),
      ],
    });

    expect(report.result.rows[0]).toMatchObject({
      keyword: "crm tools",
      bestCompetitorRank: 2,
      coreKeyword: "crm",
      searchVolumeTrend: trend,
      serpSnapshot: {
        itemTypes: ["organic", "ai_overview"],
        updatedAt: "2026-05-14T18:17:21.000Z",
      },
    });
  });

  it("keeps provider silence on the serp snapshot distinct from an empty snapshot", () => {
    const silent = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [row({ keyword: "silent serp", firstDomainRank: 2 })],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [row({ keyword: "silent serp", firstDomainRank: 6 })],
          totalCount: 1,
        }),
      ],
    });
    const empty = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "empty serp",
              firstDomainRank: 2,
              serpItemTypes: [],
              serpUpdatedAt: "2026-05-14T18:17:21.000Z",
            }),
          ],
          totalCount: 1,
        }),
      ],
    });

    expect(silent.result.rows[0]).toMatchObject({
      coreKeyword: null,
      searchVolumeTrend: null,
      serpSnapshot: null,
    });
    expect(empty.result.rows[0]?.serpSnapshot).toEqual({
      itemTypes: [],
      updatedAt: "2026-05-14T18:17:21.000Z",
    });
  });

  it("attaches a pre-screen to every row and never lets it change the GSC lane", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "vendor login",
              firstDomainRank: 2,
              providerIntent: "navigational",
            }),
            row({ keyword: "crm tools", firstDomainRank: 2 }),
          ],
          totalCount: 2,
        }),
      ],
      gsc: {
        ...GSC_AVAILABLE_EMPTY,
        queryRows: [{ query: "vendor login", impressions: 40, position: 4.2 }],
      },
    });

    const navigational = report.result.rows.find(
      (gapRow) => gapRow.keyword === "vendor login",
    );
    const gap = report.result.rows.find(
      (gapRow) => gapRow.keyword === "crm tools",
    );
    expect(navigational).toMatchObject({
      gsc: { queryStatus: "observed_strong", nextStep: "review_existing_query" },
      preScreen: {
        band: "defer_brand_navigational",
        basis: "dfs_estimate",
        reason: "provider_navigational_intent",
      },
    });
    expect(gap).toMatchObject({
      gsc: { nextStep: "review_content_gap" },
      preScreen: {
        band: "prioritize_serp_check",
        basis: "dfs_estimate",
        reason: "kd_low_rank_top10",
      },
    });
  });

  it("orders bands inside a lane before the DFS tie-breaks", () => {
    // Every DFS tie-break (rank, volume, alphabetical key) favours the reverse
    // of the band order, so the band must be what decides.
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "alpha brand",
              firstDomainRank: 1,
              searchVolume: 5_000,
              keywordDifficulty: 10,
              providerIntent: "navigational",
            }),
            row({
              keyword: "bravo head",
              firstDomainRank: 2,
              searchVolume: 4_000,
              keywordDifficulty: 70,
            }),
            row({
              keyword: "charlie unbanded",
              firstDomainRank: 3,
              searchVolume: 3_000,
              keywordDifficulty: null,
            }),
            row({
              keyword: "delta stretch",
              firstDomainRank: 4,
              searchVolume: 2_000,
              keywordDifficulty: 45,
            }),
            row({
              keyword: "echo prioritize",
              firstDomainRank: 5,
              searchVolume: 1_000,
              keywordDifficulty: 10,
            }),
          ],
          totalCount: 5,
        }),
      ],
      gsc: GSC_AVAILABLE_EMPTY,
    });

    expect(new Set(report.result.rows.map((gapRow) => gapRow.gsc.nextStep))).toEqual(
      new Set(["review_content_gap"]),
    );
    expect(report.result.rows.map((gapRow) => gapRow.keyword)).toEqual([
      "echo prioritize",
      "delta stretch",
      "charlie unbanded",
      "bravo head",
      "alpha brand",
    ]);
    expect(report.result.rows.map((gapRow) => gapRow.preScreen.band)).toEqual([
      "prioritize_serp_check",
      "stretch",
      "unbanded",
      "defer_head_term",
      "defer_brand_navigational",
    ]);

    const sameBand = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "solo crm",
              firstDomainRank: 1,
              searchVolume: 9_000,
              keywordDifficulty: 10,
            }),
            row({
              keyword: "shared crm",
              firstDomainRank: 8,
              searchVolume: 100,
              keywordDifficulty: 10,
            }),
          ],
          totalCount: 2,
        }),
        providerResult("two.example", {
          rows: [
            row({
              keyword: "shared crm",
              firstDomainRank: 9,
              searchVolume: 100,
              keywordDifficulty: 10,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: GSC_AVAILABLE_EMPTY,
    });

    expect(sameBand.result.rows.map((gapRow) => gapRow.preScreen.band)).toEqual([
      "prioritize_serp_check",
      "prioritize_serp_check",
    ]);
    expect(sameBand.result.rows.map((gapRow) => gapRow.keyword)).toEqual([
      "shared crm",
      "solo crm",
    ]);
  });

  it("reports GSC row counts", () => {
    const competitor = providerResult("one.example", {
      rows: [row({ keyword: "counted term", firstDomainRank: 3 })],
      totalCount: 1,
    });
    const available = reportFor({
      competitorDomains: ["one.example"],
      competitors: [competitor],
      gsc: {
        ...GSC_AVAILABLE_EMPTY,
        queryRows: [
          { query: "counted term", impressions: 10, position: 3 },
          { query: "zero impressions", impressions: 0, position: 0 },
          { query: "other term", impressions: 4, position: 20 },
        ],
        queryPageRows: [
          {
            query: "counted term",
            page: "https://acme.com/counted",
            impressions: 8,
            position: 3,
          },
          {
            query: "other term",
            page: "https://acme.com/other",
            impressions: 4,
            position: 20,
          },
        ],
      },
    });
    const notRequested = reportFor({
      competitorDomains: ["one.example"],
      competitors: [competitor],
      gsc: null,
    });
    const unavailable = reportFor({
      competitorDomains: ["one.example"],
      competitors: [competitor],
      gsc: { ...GSC_AVAILABLE_EMPTY, status: "unavailable" },
    });

    expect(available.result.gscQueryRowCount).toBe(3);
    expect(available.result.gscQueryPageRowCount).toBe(2);
    expect(notRequested.result.gscQueryRowCount).toBeNull();
    expect(notRequested.result.gscQueryPageRowCount).toBeNull();
    expect(unavailable.result.gscQueryRowCount).toBeNull();
    expect(unavailable.result.gscQueryPageRowCount).toBeNull();
  });

  it("keeps provider null metrics distinct from explicit zero values", () => {
    const report = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "zero volume",
              searchVolume: 0,
              cpc: 0,
              keywordDifficulty: 14,
              providerIntent: "informational",
              firstDomainRank: 4,
            }),
          ],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [
            row({
              keyword: "unknown volume",
              searchVolume: null,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 9,
            }),
          ],
          totalCount: 1,
        }),
      ],
    });

    expect(report.result.rows).toEqual([
      expect.objectContaining({
        keyword: "zero volume",
        searchVolume: { availability: "explicit_zero", value: 0 },
        cpc: { availability: "explicit_zero", value: 0 },
      }),
      expect.objectContaining({
        keyword: "unknown volume",
        searchVolume: { availability: "provider_no_data", value: null },
        cpc: { availability: "provider_no_data", value: null },
        keywordDifficulty: { availability: "provider_no_data", value: null },
      }),
    ]);
  });

  it("merges normalized keywords across competitors and keeps every domain rank", () => {
    const report = reportFor({
      competitorDomains: ["one.example", "two.example", "three.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "Best CRM",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 3,
            }),
          ],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [
            row({
              keyword: "best   crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 7,
            }),
          ],
          totalCount: 1,
        }),
        providerResult("three.example", {
          rows: [
            row({
              keyword: "BEST CRM",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 11,
            }),
          ],
          totalCount: 1,
        }),
      ],
    });

    expect(report.result.rows).toEqual([
      expect.objectContaining({
        keyword: "Best CRM",
        competitorCount: 3,
        bestCompetitorRank: 3,
        competitorRanks: {
          "one.example": 3,
          "two.example": 7,
          "three.example": 11,
        },
        searchVolume: { availability: "available", value: 1_900 },
      }),
    ]);
  });

  it("keeps the best repeated rank for one domain and selects metrics deterministically", () => {
    const report = reportFor({
      competitorDomains: ["two.example", "one.example"],
      competitors: [
        providerResult("two.example", {
          rows: [
            row({
              keyword: "stable term",
              searchVolume: 20,
              cpc: 2,
              keywordDifficulty: 22,
              providerIntent: "commercial",
              firstDomainRank: 5,
            }),
          ],
          totalCount: 1,
        }),
        providerResult("one.example", {
          rows: [
            row({
              keyword: "Stable Term",
              searchVolume: 10,
              cpc: 1,
              keywordDifficulty: 11,
              providerIntent: "informational",
              firstDomainRank: 5,
            }),
            row({
              keyword: "stable  term",
              searchVolume: 10,
              cpc: 1,
              keywordDifficulty: 11,
              providerIntent: "informational",
              firstDomainRank: 3,
            }),
          ],
          totalCount: 2,
        }),
      ],
    });

    expect(report.result.rows).toEqual([
      expect.objectContaining({
        keyword: "Stable Term",
        competitorRanks: {
          "one.example": 3,
          "two.example": 5,
        },
        bestCompetitorRank: 3,
        searchVolume: { availability: "available", value: 10 },
        cpc: { availability: "available", value: 1 },
        keywordDifficulty: { availability: "available", value: 11 },
        providerIntent: "informational",
      }),
    ]);
  });

  it("marks one unavailable competitor as a partial run and carries the failure on coverage only", () => {
    const report = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "shared term",
              searchVolume: 120,
              cpc: 2.1,
              keywordDifficulty: 9,
              providerIntent: "commercial",
              firstDomainRank: 6,
            }),
          ],
          totalCount: 4,
        }),
        {
          domain: "two.example",
          status: "unavailable",
          rows: [],
          totalCount: null,
          costUsd: null,
          providerStatusCode: null,
          taskStatusCode: null,
          failureCode: "keyword_source_unavailable",
        },
      ],
    });

    expect(report.run.status).toBe("partial");
    expect(report.result.requestedCompetitors).toBe(2);
    expect(report.result.completedCompetitors).toBe(1);
    expect(report.result.unavailableCompetitors).toBe(1);
    expect(report.result.resultTruncated).toBe(true);
    expect(report.result.competitors).toEqual([
      expect.objectContaining({
        domain: "one.example",
        status: "complete",
        returnedRows: 1,
        totalCount: 4,
        truncated: true,
      }),
      expect.objectContaining({
        domain: "two.example",
        status: "unavailable",
        returnedRows: 0,
        totalCount: null,
        failureCode: "keyword_source_unavailable",
      }),
    ]);
  });

  it("marks all unavailable competitors as unavailable rather than an empty success", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        {
          domain: "one.example",
          status: "unavailable",
          rows: [],
          totalCount: null,
          costUsd: null,
          providerStatusCode: null,
          taskStatusCode: null,
          failureCode: "keyword_source_unavailable",
        },
      ],
    });

    expect(report.run.status).toBe("unavailable");
    expect(report.result.rows).toEqual([]);
  });

  it("keeps a successful zero-row response complete rather than unavailable", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [providerResult("one.example")],
    });

    expect(report.run.status).toBe("complete");
    expect(report.result.rows).toEqual([]);
    expect(report.result.resultTruncated).toBe(false);
  });

  it("marks an otherwise complete DFS run partial when requested GSC is unavailable", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [providerResult("one.example")],
      gsc: {
        status: "unavailable",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.overlayStatus).toBe("unavailable");
    expect(report.run.status).toBe("partial");
  });

  it("marks an otherwise complete DFS run partial when requested GSC is truncated", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [providerResult("one.example")],
      gsc: {
        status: "available",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: true,
        queryPageTruncated: false,
      },
    });

    expect(report.result.overlayStatus).toBe("partial");
    expect(report.run.status).toBe("partial");
  });

  it.each([
    ["not requested", null],
    [
      "available",
      {
        status: "available" as const,
        queryRows: [],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    ],
  ])("keeps all-success DFS complete when GSC is %s", (_label, gsc) => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [providerResult("one.example")],
      gsc,
    });

    expect(report.run.status).toBe("complete");
  });

  it("keeps zero DFS successes unavailable even when GSC is available", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        {
          domain: "one.example",
          status: "unavailable",
          rows: [],
          totalCount: null,
          costUsd: null,
          providerStatusCode: null,
          taskStatusCode: null,
          failureCode: "keyword_source_unavailable",
        },
      ],
      gsc: {
        status: "available",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.overlayStatus).toBe("available");
    expect(report.run.status).toBe("unavailable");
  });

  it("routes a weak observed query with sufficient page coverage to optimize_existing", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "best crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 3,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [{ query: "best crm", impressions: 40, position: 12.5 }],
        queryPageRows: [
          {
            query: "best crm",
            page: "https://acme.com/crm",
            impressions: 36,
            position: 12.1,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]).toMatchObject({
      keyword: "best crm",
      gsc: {
        queryStatus: "observed_weak",
        evidenceBasis: "query",
        queryImpressions: 40,
        queryPosition: 12.5,
        pageStatus: "observed_sufficient",
        pageUrl: "https://acme.com/crm",
        pageImpressions: 36,
        pagePosition: 12.1,
        queryPageCoverage: 0.9,
        nextStep: "optimize_existing",
      },
    });
  });

  it("routes a strong query observation to review_existing_query even with a sufficient page", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "brand crm",
              searchVolume: 500,
              cpc: 2.2,
              keywordDifficulty: 20,
              providerIntent: "navigational",
              firstDomainRank: 2,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [{ query: "brand crm", impressions: 40, position: 4.2 }],
        queryPageRows: [
          {
            query: "brand crm",
            page: "https://acme.com/brand",
            impressions: 35,
            position: 4.1,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]).toMatchObject({
      gsc: {
        queryStatus: "observed_strong",
        nextStep: "review_existing_query",
      },
    });
  });

  it("requires ten query impressions before an otherwise top-ten observation is strong", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "low sample",
              searchVolume: 90,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 3,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [{ query: "low sample", impressions: 9, position: 1 }],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]?.gsc).toMatchObject({
      queryStatus: "observed_weak",
      queryImpressions: 9,
      queryPosition: 1,
      nextStep: "review_existing_query",
    });
  });

  it("routes a weak query with only partial page coverage to review_existing_query", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "weak crm",
              searchVolume: 110,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [{ query: "weak crm", impressions: 25, position: 13.1 }],
        queryPageRows: [
          {
            query: "weak crm",
            page: "https://acme.com/weak",
            impressions: 10,
            position: 12.8,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]).toMatchObject({
      gsc: {
        pageStatus: "observed_partial",
        pageImpressions: 10,
        queryPageCoverage: 0.4,
        nextStep: "review_existing_query",
      },
    });
  });

  it("requires at least eighty percent query-page coverage for sufficient attribution", () => {
    const makeReport = (pageImpressions: number) =>
      reportFor({
        competitorDomains: ["one.example"],
        competitors: [
          providerResult("one.example", {
            rows: [
              row({
                keyword: "coverage boundary",
                searchVolume: 110,
                cpc: 1.2,
                keywordDifficulty: 18,
                providerIntent: "informational",
                firstDomainRank: 8,
              }),
            ],
            totalCount: 1,
          }),
        ],
        gsc: {
          status: "available",
          queryRows: [
            { query: "coverage boundary", impressions: 100, position: 13 },
          ],
          queryPageRows: [
            {
              query: "coverage boundary",
              page: "https://acme.com/boundary",
              impressions: pageImpressions,
              position: 12.5,
            },
          ],
          queryTruncated: false,
          queryPageTruncated: false,
        },
      });

    expect(makeReport(79).result.rows[0]?.gsc).toMatchObject({
      pageStatus: "observed_partial",
      queryPageCoverage: 0.79,
      nextStep: "review_existing_query",
    });
    expect(makeReport(80).result.rows[0]?.gsc).toMatchObject({
      pageStatus: "observed_sufficient",
      queryPageCoverage: 0.8,
      nextStep: "optimize_existing",
    });
  });

  it("sums every visible safe page when measuring query-page coverage", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "multi page coverage",
              searchVolume: 110,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [
          { query: "multi page coverage", impressions: 100, position: 13 },
        ],
        queryPageRows: [
          {
            query: "multi page coverage",
            page: "https://acme.com/primary",
            impressions: 45,
            position: 12,
          },
          {
            query: "multi page coverage",
            page: "https://acme.com/secondary",
            impressions: 40,
            position: 14,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]?.gsc).toMatchObject({
      queryStatus: "observed_weak",
      pageStatus: "observed_sufficient",
      pageUrl: "https://acme.com/primary",
      pageImpressions: 45,
      pagePosition: 12,
      queryPageCoverage: 0.85,
      nextStep: "optimize_existing",
    });
  });

  it("reports contradictory above-one page coverage as unavailable instead of clamping it", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "contradictory coverage",
              searchVolume: 110,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [
          { query: "contradictory coverage", impressions: 100, position: 13 },
        ],
        queryPageRows: [
          {
            query: "contradictory coverage",
            page: "https://acme.com/contradictory",
            impressions: 101,
            position: 12.5,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]?.gsc).toMatchObject({
      pageStatus: "observed_partial",
      pageImpressions: 101,
      queryPageCoverage: null,
      nextStep: "review_existing_query",
    });
  });

  it("preserves positive page evidence as partial when the query-page read was truncated", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "truncated page term",
              searchVolume: 500,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [{ query: "truncated page term", impressions: 20, position: 18 }],
        queryPageRows: [
          {
            query: "truncated page term",
            page: "https://acme.com/truncated",
            impressions: 19,
            position: 17,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: true,
      },
    });

    expect(report.result.overlayStatus).toBe("partial");
    expect(report.result.gscQueryTruncated).toBe(false);
    expect(report.result.gscQueryPageTruncated).toBe(true);
    expect(report.result.rows[0]).toMatchObject({
      gsc: {
        pageStatus: "observed_partial",
        pageUrl: "https://acme.com/truncated",
        pageImpressions: 19,
        pagePosition: 17,
        queryPageCoverage: 0.95,
        nextStep: "review_existing_query",
      },
    });
  });

  it("upgrades query-page-only positive evidence into a positive query observation with query_page basis", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "page only term",
              searchVolume: 500,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [],
        queryPageRows: [
          {
            query: "page only term",
            page: "https://acme.com/page-only",
            impressions: 12,
            position: 9,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]).toMatchObject({
      gsc: {
        queryStatus: "observed_weak",
        evidenceBasis: "query_page",
        queryImpressions: null,
        queryPosition: null,
        pageStatus: "observed_partial",
        pageUrl: "https://acme.com/page-only",
        pageImpressions: 12,
        pagePosition: 9,
        queryPageCoverage: null,
        nextStep: "review_existing_query",
      },
    });
  });

  it("keeps an observed query positive when no page was observed or the page read was incomplete", () => {
    const makeReport = (queryPageTruncated: boolean) =>
      reportFor({
        competitorDomains: ["one.example"],
        competitors: [
          providerResult("one.example", {
            rows: [
              row({
                keyword: "query without page",
                searchVolume: 500,
                cpc: 1.2,
                keywordDifficulty: 18,
                providerIntent: "informational",
                firstDomainRank: 8,
              }),
            ],
            totalCount: 1,
          }),
        ],
        gsc: {
          status: "available",
          queryRows: [
            { query: "query without page", impressions: 25, position: 13.1 },
          ],
          queryPageRows: [],
          queryTruncated: false,
          queryPageTruncated,
        },
      });

    expect(makeReport(false).result.rows[0]?.gsc).toMatchObject({
      queryStatus: "observed_weak",
      evidenceBasis: "query",
      pageStatus: "not_observed_in_gsc_query_page_sample",
      pageUrl: null,
      pageImpressions: null,
      pagePosition: null,
      queryPageCoverage: null,
      nextStep: "review_existing_query",
    });
    expect(makeReport(true).result.rows[0]?.gsc).toMatchObject({
      queryStatus: "observed_weak",
      evidenceBasis: "query",
      pageStatus: "gsc_query_page_sample_not_read",
      pageUrl: null,
      pageImpressions: null,
      pagePosition: null,
      queryPageCoverage: null,
      nextStep: "review_existing_query",
    });
  });

  it("impression-weights normalized query and selected-page rows without inventing totals", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "weighted term",
              searchVolume: 100,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 2,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [
          { query: "Weighted  Term", impressions: 10, position: 2 },
          { query: "weighted term", impressions: 30, position: 12 },
        ],
        queryPageRows: [
          {
            query: "weighted term",
            page: "https://acme.com/weighted",
            impressions: 10,
            position: 3,
          },
          {
            query: "Weighted Term",
            page: " https://acme.com/weighted ",
            impressions: 20,
            position: 9,
          },
          {
            query: "weighted term",
            page: "https://acme.com/other",
            impressions: 6,
            position: 11,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]?.gsc).toEqual({
      queryStatus: "observed_strong",
      evidenceBasis: "query",
      queryImpressions: 40,
      queryPosition: 9.5,
      pageStatus: "observed_sufficient",
      pageUrl: "https://acme.com/weighted",
      pageImpressions: 30,
      pagePosition: 7,
      queryPageCoverage: 0.9,
      nextStep: "review_existing_query",
    });
  });

  it("routes a complete untruncated miss to review_content_gap", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "missing term",
              searchVolume: 90,
              cpc: 1,
              keywordDifficulty: 8,
              providerIntent: "informational",
              firstDomainRank: 10,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]).toMatchObject({
      gsc: {
        queryStatus: "not_observed_in_gsc_query_sample",
        pageStatus: "not_observed_in_gsc_query_page_sample",
        nextStep: "review_content_gap",
      },
    });
  });

  it("routes unavailable or truncated misses to verify_own_coverage", () => {
    const unavailable = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "unverified term",
              searchVolume: 90,
              cpc: 1,
              keywordDifficulty: 8,
              providerIntent: "informational",
              firstDomainRank: 10,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "unavailable",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });
    const truncated = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "truncated miss",
              searchVolume: 90,
              cpc: 1,
              keywordDifficulty: 8,
              providerIntent: "informational",
              firstDomainRank: 10,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: true,
        queryPageTruncated: true,
      },
    });

    expect(unavailable.result.rows[0]).toMatchObject({
      gsc: {
        queryStatus: "gsc_query_sample_not_read",
        pageStatus: "gsc_query_page_sample_not_read",
        nextStep: "verify_own_coverage",
      },
    });
    expect(truncated.result.rows[0]).toMatchObject({
      gsc: {
        queryStatus: "gsc_query_sample_not_read",
        pageStatus: "gsc_query_page_sample_not_read",
        nextStep: "verify_own_coverage",
      },
    });
    expect(truncated.result.gscQueryTruncated).toBe(true);
    expect(truncated.result.gscQueryPageTruncated).toBe(true);
  });

  it("keeps all GSC metrics null when the overlay was not requested or unavailable", () => {
    const competitor = providerResult("one.example", {
      rows: [
        row({
          keyword: "unread evidence",
          searchVolume: 90,
          cpc: 1,
          keywordDifficulty: 8,
          providerIntent: "informational",
          firstDomainRank: 10,
        }),
      ],
      totalCount: 1,
    });
    const notRequested = reportFor({
      competitorDomains: ["one.example"],
      competitors: [competitor],
    });
    const unavailable = reportFor({
      competitorDomains: ["one.example"],
      competitors: [competitor],
      gsc: {
        status: "unavailable",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });
    const expected = {
      queryStatus: "gsc_query_sample_not_read",
      evidenceBasis: null,
      queryImpressions: null,
      queryPosition: null,
      pageStatus: "gsc_query_page_sample_not_read",
      pageUrl: null,
      pageImpressions: null,
      pagePosition: null,
      queryPageCoverage: null,
      nextStep: "verify_own_coverage",
    };

    expect(notRequested.result.rows[0]?.gsc).toEqual(expected);
    expect(unavailable.result.rows[0]?.gsc).toEqual(expected);
  });

  it("withholds an unsafe URL and does not invent page attribution from it", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "unsafe page term",
              searchVolume: 500,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [{ query: "unsafe page term", impressions: 20, position: 18 }],
        queryPageRows: [
          {
            query: "unsafe page term",
            page: "javascript:alert(1)",
            impressions: 19,
            position: 17,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows[0]).toMatchObject({
      gsc: {
        pageStatus: "not_observed_in_gsc_query_page_sample",
        pageUrl: null,
        pageImpressions: null,
        pagePosition: null,
        queryPageCoverage: null,
        nextStep: "review_existing_query",
      },
    });
  });

  it("orders rows by next-step lanes, weaker observations first, then impressions and DFS ties", () => {
    const report = reportFor({
      competitorDomains: ["one.example", "two.example", "three.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "review content gap",
              searchVolume: 200,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 8,
            }),
            row({
              keyword: "review existing weak higher impressions",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 10,
            }),
            row({
              keyword: "review existing weak lower impressions",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 11,
            }),
            row({
              keyword: "review existing strong",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 9,
            }),
            row({
              keyword: "optimize existing",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 7,
            }),
          ],
          totalCount: 5,
        }),
        providerResult("two.example"),
        providerResult("three.example"),
      ],
      gsc: {
        status: "available",
        queryRows: [
          { query: "review existing weak higher impressions", impressions: 30, position: 14 },
          { query: "review existing weak lower impressions", impressions: 20, position: 15 },
          { query: "review existing strong", impressions: 40, position: 5 },
          { query: "optimize existing", impressions: 20, position: 12 },
        ],
        queryPageRows: [
          {
            query: "optimize existing",
            page: "https://acme.com/optimize",
            impressions: 18,
            position: 12,
          },
          {
            query: "review existing weak higher impressions",
            page: "https://acme.com/review-a",
            impressions: 10,
            position: 14,
          },
          {
            query: "review existing weak lower impressions",
            page: "https://acme.com/review-b",
            impressions: 5,
            position: 15,
          },
          {
            query: "review existing strong",
            page: "https://acme.com/review-strong",
            impressions: 35,
            position: 5,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows.map((row) => row.keyword)).toEqual([
      "optimize existing",
      "review existing weak higher impressions",
      "review existing weak lower impressions",
      "review existing strong",
      "review content gap",
    ]);
    expect(report.result.rows.map((row) => row.gsc.nextStep)).toEqual([
      "optimize_existing",
      "review_existing_query",
      "review_existing_query",
      "review_existing_query",
      "review_content_gap",
    ]);
  });

  it("uses real page impressions to order query-page-only observations without inventing query totals", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "lower page impressions",
              searchVolume: 1_000,
              cpc: 2,
              keywordDifficulty: 30,
              providerIntent: "commercial",
              firstDomainRank: 1,
            }),
            row({
              keyword: "higher page impressions",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "informational",
              firstDomainRank: 10,
            }),
          ],
          totalCount: 2,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [],
        queryPageRows: [
          {
            query: "lower page impressions",
            page: "https://acme.com/lower",
            impressions: 10,
            position: 12,
          },
          {
            query: "higher page impressions",
            page: "https://acme.com/higher",
            impressions: 30,
            position: 15,
          },
        ],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows.map((row) => row.keyword)).toEqual([
      "higher page impressions",
      "lower page impressions",
    ]);
    expect(
      report.result.rows.map((row) => ({
        evidenceBasis: row.gsc.evidenceBasis,
        queryImpressions: row.gsc.queryImpressions,
        pageImpressions: row.gsc.pageImpressions,
      })),
    ).toEqual([
      {
        evidenceBasis: "query_page",
        queryImpressions: null,
        pageImpressions: 30,
      },
      {
        evidenceBasis: "query_page",
        queryImpressions: null,
        pageImpressions: 10,
      },
    ]);
  });

  it("orders evidence-needed rows after positive observed lanes when the query read is truncated", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "verify own coverage",
              searchVolume: 1_000,
              cpc: 2,
              keywordDifficulty: 30,
              providerIntent: "commercial",
              firstDomainRank: 1,
            }),
            row({
              keyword: "review existing query",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "informational",
              firstDomainRank: 9,
            }),
            row({
              keyword: "optimize existing query",
              searchVolume: 80,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "informational",
              firstDomainRank: 10,
            }),
          ],
          totalCount: 3,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [
          {
            query: "review existing query",
            impressions: 30,
            position: 14,
          },
          {
            query: "optimize existing query",
            impressions: 20,
            position: 12,
          },
        ],
        queryPageRows: [
          {
            query: "optimize existing query",
            page: "https://acme.com/optimize-existing",
            impressions: 18,
            position: 12,
          },
        ],
        queryTruncated: true,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows.map((row) => row.gsc.nextStep)).toEqual([
      "optimize_existing",
      "review_existing_query",
      "verify_own_coverage",
    ]);
    expect(report.result.rows.map((row) => row.keyword)).toEqual([
      "optimize existing query",
      "review existing query",
      "verify own coverage",
    ]);
  });

  it("uses the existing DFS tie-breakers after lane and GSC evidence are equal", () => {
    const report = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({
              keyword: "zulu",
              searchVolume: 500,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 4,
            }),
            row({
              keyword: "null volume",
              searchVolume: null,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 5,
            }),
            row({
              keyword: "alpha",
              searchVolume: 100,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 5,
            }),
          ],
          totalCount: 3,
        }),
        providerResult("two.example", {
          rows: [
            row({
              keyword: "zulu",
              searchVolume: 500,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 9,
            }),
          ],
          totalCount: 1,
        }),
      ],
      gsc: null,
    });

    expect(report.result.rows.map((row) => row.keyword)).toEqual([
      "zulu",
      "alpha",
      "null volume",
    ]);
    expect(new Set(report.result.rows.map((row) => row.gsc.nextStep))).toEqual(
      new Set(["verify_own_coverage"]),
    );
  });

  it("enforces the echoed sample rule on provider rows it did not filter", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            row({ keyword: "in rule", firstDomainRank: 20 }),
            row({ keyword: "past the rank ceiling", firstDomainRank: 21 }),
            row({ keyword: "past the cap", firstDomainRank: 3 }),
          ],
          totalCount: 3,
        }),
      ],
      sampleRule: {
        maxCompetitorRank: 20,
        perCompetitorLimit: 2,
        serpSnapshotRequested: false,
      },
      gsc: null,
    });

    expect(report.result.rows.map((entry) => entry.keyword)).toEqual([
      "in rule",
    ]);
    expect(report.result.competitors[0]?.returnedRows).toBe(3);
  });

  it("keeps every localized public error code covered", () => {
    expect(COMPETITOR_KEYWORD_GAP_ERROR_CODES).toEqual([
      "invalid_input",
      "invalid_request",
      "payload_too_large",
      "unsupported_media_type",
      "auth_required",
      "auth_unavailable",
      "search_in_progress",
      "keyword_source_unavailable",
    ]);
  });
});
