import { describe, expect, expectTypeOf, it } from "vitest";

import {
  buildCompetitorKeywordGapReport,
  type CompetitorKeywordGapDataForSeoResult,
  type CompetitorKeywordGapGscRead,
} from "./report.ts";
import {
  COMPETITOR_KEYWORD_GAP_ERROR_CODES,
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
  type CompetitorKeywordGapEnvelope,
  type CompetitorKeywordGapResultV2,
} from "./types.ts";

const BASE = {
  completedAt: "2026-08-24T12:00:00.000Z",
  siteDomain: "acme.com",
  marketCode: "US",
  languageCode: "en",
  competitorDomains: ["one.example", "two.example", "three.example"],
} as const;

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
}) {
  return buildCompetitorKeywordGapReport({
    ...BASE,
    competitorDomains:
      options?.competitorDomains ?? ["one.example", "two.example"],
    competitors:
      options?.competitors ??
      [
        providerResult("one.example", {
          rows: [
            {
              keyword: "best crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 3,
              secondDomainRank: null,
            },
          ],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [
            {
              keyword: "best crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 7,
              secondDomainRank: null,
            },
          ],
          totalCount: 1,
        }),
        providerResult("three.example"),
      ],
    gsc: options?.gsc ?? null,
  });
}

describe("buildCompetitorKeywordGapReport", () => {
  it("publishes the v2 schema version", () => {
    const report = reportFor();

    expect(report.run.status).toBe("complete");
    expect(report.run.schemaVersion).toBe("competitor_keyword_gap.v2");
    expect(report.run.schemaVersion).toBe(COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION);
    expectTypeOf<CompetitorKeywordGapEnvelope["result"]>().toEqualTypeOf<
      CompetitorKeywordGapResultV2
    >();
    expectTypeOf<
      CompetitorKeywordGapEnvelope["run"]["schemaVersion"]
    >().toEqualTypeOf<typeof COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION>();
  });

  it("freezes the envelope and nested public result paths", () => {
    const report = reportFor({
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            {
              keyword: "frozen term",
              searchVolume: 100,
              cpc: 2,
              keywordDifficulty: 8,
              providerIntent: "commercial",
              firstDomainRank: 4,
              secondDomainRank: null,
            },
          ],
          totalCount: 1,
        }),
      ],
    });

    const row = report.result.rows[0];
    const coverage = report.result.competitors[0];
    expect(row).toBeDefined();
    expect(coverage).toBeDefined();
    for (const value of [
      report,
      report.run,
      report.result,
      report.result.rows,
      report.result.competitors,
      row,
      row?.competitorRanks,
      row?.gsc,
      coverage,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("keeps provider null metrics distinct from explicit zero values", () => {
    const report = reportFor({
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            {
              keyword: "zero volume",
              searchVolume: 0,
              cpc: 0,
              keywordDifficulty: 14,
              providerIntent: "informational",
              firstDomainRank: 4,
              secondDomainRank: null,
            },
          ],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [
            {
              keyword: "unknown volume",
              searchVolume: null,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 9,
              secondDomainRank: null,
            },
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
            {
              keyword: "Best CRM",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 3,
              secondDomainRank: null,
            },
          ],
          totalCount: 1,
        }),
        providerResult("two.example", {
          rows: [
            {
              keyword: "best   crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 7,
              secondDomainRank: null,
            },
          ],
          totalCount: 1,
        }),
        providerResult("three.example", {
          rows: [
            {
              keyword: "BEST CRM",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 11,
              secondDomainRank: null,
            },
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
            {
              keyword: "stable term",
              searchVolume: 20,
              cpc: 2,
              keywordDifficulty: 22,
              providerIntent: "commercial",
              firstDomainRank: 5,
              secondDomainRank: null,
            },
          ],
          totalCount: 1,
        }),
        providerResult("one.example", {
          rows: [
            {
              keyword: "Stable Term",
              searchVolume: 10,
              cpc: 1,
              keywordDifficulty: 11,
              providerIntent: "informational",
              firstDomainRank: 5,
              secondDomainRank: null,
            },
            {
              keyword: "stable  term",
              searchVolume: 10,
              cpc: 1,
              keywordDifficulty: 11,
              providerIntent: "informational",
              firstDomainRank: 3,
              secondDomainRank: null,
            },
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
            {
              keyword: "shared term",
              searchVolume: 120,
              cpc: 2.1,
              keywordDifficulty: 9,
              providerIntent: "commercial",
              firstDomainRank: 6,
              secondDomainRank: null,
            },
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
            {
              keyword: "best crm",
              searchVolume: 1_900,
              cpc: 4.4,
              keywordDifficulty: 32,
              providerIntent: "commercial",
              firstDomainRank: 3,
              secondDomainRank: null,
            },
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
            {
              keyword: "brand crm",
              searchVolume: 500,
              cpc: 2.2,
              keywordDifficulty: 20,
              providerIntent: "navigational",
              firstDomainRank: 2,
              secondDomainRank: null,
            },
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
            {
              keyword: "low sample",
              searchVolume: 90,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 3,
              secondDomainRank: null,
            },
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
            {
              keyword: "weak crm",
              searchVolume: 110,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
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
              {
                keyword: "coverage boundary",
                searchVolume: 110,
                cpc: 1.2,
                keywordDifficulty: 18,
                providerIntent: "informational",
                firstDomainRank: 8,
                secondDomainRank: null,
              },
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
            {
              keyword: "multi page coverage",
              searchVolume: 110,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
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
            {
              keyword: "contradictory coverage",
              searchVolume: 110,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
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
            {
              keyword: "truncated page term",
              searchVolume: 500,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
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
            {
              keyword: "page only term",
              searchVolume: 500,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
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
              {
                keyword: "query without page",
                searchVolume: 500,
                cpc: 1.2,
                keywordDifficulty: 18,
                providerIntent: "informational",
                firstDomainRank: 8,
                secondDomainRank: null,
              },
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
            {
              keyword: "weighted term",
              searchVolume: 100,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 2,
              secondDomainRank: null,
            },
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
            {
              keyword: "missing term",
              searchVolume: 90,
              cpc: 1,
              keywordDifficulty: 8,
              providerIntent: "informational",
              firstDomainRank: 10,
              secondDomainRank: null,
            },
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
            {
              keyword: "unverified term",
              searchVolume: 90,
              cpc: 1,
              keywordDifficulty: 8,
              providerIntent: "informational",
              firstDomainRank: 10,
              secondDomainRank: null,
            },
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
            {
              keyword: "truncated miss",
              searchVolume: 90,
              cpc: 1,
              keywordDifficulty: 8,
              providerIntent: "informational",
              firstDomainRank: 10,
              secondDomainRank: null,
            },
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
        {
          keyword: "unread evidence",
          searchVolume: 90,
          cpc: 1,
          keywordDifficulty: 8,
          providerIntent: "informational",
          firstDomainRank: 10,
          secondDomainRank: null,
        },
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
            {
              keyword: "unsafe page term",
              searchVolume: 500,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
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
            {
              keyword: "review content gap",
              searchVolume: 200,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
            {
              keyword: "review existing weak higher impressions",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 10,
              secondDomainRank: null,
            },
            {
              keyword: "review existing weak lower impressions",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 11,
              secondDomainRank: null,
            },
            {
              keyword: "review existing strong",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 9,
              secondDomainRank: null,
            },
            {
              keyword: "optimize existing",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "commercial",
              firstDomainRank: 7,
              secondDomainRank: null,
            },
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
            {
              keyword: "lower page impressions",
              searchVolume: 1_000,
              cpc: 2,
              keywordDifficulty: 30,
              providerIntent: "commercial",
              firstDomainRank: 1,
              secondDomainRank: null,
            },
            {
              keyword: "higher page impressions",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "informational",
              firstDomainRank: 10,
              secondDomainRank: null,
            },
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
            {
              keyword: "verify own coverage",
              searchVolume: 1_000,
              cpc: 2,
              keywordDifficulty: 30,
              providerIntent: "commercial",
              firstDomainRank: 1,
              secondDomainRank: null,
            },
            {
              keyword: "review existing query",
              searchVolume: 100,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "informational",
              firstDomainRank: 9,
              secondDomainRank: null,
            },
            {
              keyword: "optimize existing query",
              searchVolume: 80,
              cpc: 1,
              keywordDifficulty: 10,
              providerIntent: "informational",
              firstDomainRank: 10,
              secondDomainRank: null,
            },
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
            {
              keyword: "zulu",
              searchVolume: 500,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 4,
              secondDomainRank: null,
            },
            {
              keyword: "null volume",
              searchVolume: null,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 5,
              secondDomainRank: null,
            },
            {
              keyword: "alpha",
              searchVolume: 100,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 5,
              secondDomainRank: null,
            },
          ],
          totalCount: 3,
        }),
        providerResult("two.example", {
          rows: [
            {
              keyword: "zulu",
              searchVolume: 500,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 9,
              secondDomainRank: null,
            },
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
