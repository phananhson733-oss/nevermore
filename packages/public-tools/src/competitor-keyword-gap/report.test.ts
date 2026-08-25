import { describe, expect, it } from "vitest";

import {
  buildCompetitorKeywordGapReport,
  type CompetitorKeywordGapDataForSeoResult,
  type CompetitorKeywordGapGscRead,
} from "./report.ts";
import {
  COMPETITOR_KEYWORD_GAP_ERROR_CODES,
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
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

describe("buildCompetitorKeywordGapReport", () => {
  it("merges the same normalized keyword across competitors and keeps every domain rank", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
      gsc: null,
    });

    expect(report.run.status).toBe("complete");
    expect(report.run.schemaVersion).toBe("competitor_keyword_gap.v1");
    expect(report.run.schemaVersion).toBe(
      COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
    );
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

  it("freezes the envelope and nested public result paths", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
      gsc: null,
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

  it("keeps provider null volume distinct from an explicit zero", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
      competitorDomains: ["one.example", "two.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            {
              keyword: "zero volume",
              searchVolume: 0,
              cpc: 1.2,
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
      gsc: null,
    });

    expect(report.result.rows).toEqual([
      expect.objectContaining({
        keyword: "zero volume",
        searchVolume: { availability: "explicit_zero", value: 0 },
      }),
      expect.objectContaining({
        keyword: "unknown volume",
        searchVolume: { availability: "provider_no_data", value: null },
      }),
    ]);
  });

  it("keeps the best repeated rank for one domain and selects metrics deterministically", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
      gsc: null,
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
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
      gsc: null,
    });

    expect(report.run.status).toBe("partial");
    expect(report.result.requestedCompetitors).toBe(2);
    expect(report.result.completedCompetitors).toBe(1);
    expect(report.result.unavailableCompetitors).toBe(1);
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
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
      gsc: null,
    });

    expect(report.run.status).toBe("unavailable");
    expect(report.result.rows).toEqual([]);
  });

  it("keeps a successful zero-row response complete rather than unavailable", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
      competitorDomains: ["one.example"],
      competitors: [providerResult("one.example")],
      gsc: null,
    });

    expect(report.run.status).toBe("complete");
    expect(report.result.rows).toEqual([]);
    expect(report.result.resultTruncated).toBe(false);
  });

  it("marks an otherwise complete DFS run partial when requested GSC is unavailable", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
      competitorDomains: ["one.example"],
      competitors: [providerResult("one.example")],
      gsc,
    });

    expect(report.run.status).toBe("complete");
  });

  it("keeps zero DFS successes unavailable even when GSC is available", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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

  it("overlays exact GSC observations and exposes the supporting page only when the page split was sufficiently read", () => {
    const gsc: CompetitorKeywordGapGscRead = {
      status: "available",
      queryRows: [
        { query: "best crm", impressions: 40, position: 4.2 },
        { query: "weak crm", impressions: 25, position: 13.1 },
      ],
      queryPageRows: [
        {
          query: "best crm",
          page: "https://acme.com/crm",
          impressions: 36,
          position: 4.0,
        },
      ],
      queryTruncated: false,
      queryPageTruncated: false,
    };

    const report = buildCompetitorKeywordGapReport({
      ...BASE,
      competitorDomains: ["one.example", "two.example"],
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
            {
              keyword: "weak crm",
              searchVolume: 110,
              cpc: 1.2,
              keywordDifficulty: 18,
              providerIntent: "informational",
              firstDomainRank: 8,
              secondDomainRank: null,
            },
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
          totalCount: 3,
        }),
        providerResult("two.example"),
      ],
      gsc,
    });

    expect(report.result.overlayStatus).toBe("available");
    expect(report.result.rows).toEqual([
      expect.objectContaining({
        keyword: "best crm",
        gsc: {
          queryStatus: "observed_strong",
          queryImpressions: 40,
          queryPosition: 4.2,
          pageUrl: "https://acme.com/crm",
          nextStep: "optimize_existing",
        },
      }),
      expect.objectContaining({
        keyword: "weak crm",
        gsc: {
          queryStatus: "observed_weak",
          queryImpressions: 25,
          queryPosition: 13.1,
          pageUrl: null,
          nextStep: "review_content_gap",
        },
      }),
      expect.objectContaining({
        keyword: "missing term",
        gsc: {
          queryStatus: "not_observed_in_gsc_query_sample",
          queryImpressions: null,
          queryPosition: null,
          pageUrl: null,
          nextStep: "review_content_gap",
        },
      }),
    ]);
  });

  it("marks every row as unread when the GSC overlay could not be collected", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
        status: "unavailable",
        queryRows: [],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.overlayStatus).toBe("unavailable");
    expect(report.result.rows[0]?.gsc).toEqual({
      queryStatus: "gsc_query_sample_not_read",
      queryImpressions: null,
      queryPosition: null,
      pageUrl: null,
      nextStep: "review_content_gap",
    });
  });

  it("impression-weights exact GSC rows and requires ten impressions for a strong observation", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
          totalCount: 2,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [
          { query: "Weighted  Term", impressions: 10, position: 2 },
          { query: "weighted term", impressions: 30, position: 12 },
          { query: "low sample", impressions: 8, position: 1 },
        ],
        queryPageRows: [],
        queryTruncated: false,
        queryPageTruncated: false,
      },
    });

    expect(report.result.rows).toEqual([
      expect.objectContaining({
        keyword: "weighted term",
        gsc: expect.objectContaining({
          queryStatus: "observed_strong",
          queryImpressions: 40,
          queryPosition: 9.5,
        }),
      }),
      expect.objectContaining({
        keyword: "low sample",
        gsc: expect.objectContaining({
          queryStatus: "observed_weak",
          queryImpressions: 8,
          queryPosition: 1,
        }),
      }),
    ]);
  });

  it("keeps truncated GSC silence unread and exposes both GSC and provider truncation", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
      competitorDomains: ["one.example"],
      competitors: [
        providerResult("one.example", {
          rows: [
            {
              keyword: "missing tail",
              searchVolume: null,
              cpc: null,
              keywordDifficulty: null,
              providerIntent: null,
              firstDomainRank: 8,
              secondDomainRank: null,
            },
          ],
          totalCount: 4,
        }),
      ],
      gsc: {
        status: "available",
        queryRows: [],
        queryPageRows: [
          {
            query: "missing tail",
            page: "https://acme.com/missing-tail",
            impressions: 12,
            position: 7,
          },
        ],
        queryTruncated: true,
        queryPageTruncated: true,
      },
    });

    expect(report.result.overlayStatus).toBe("partial");
    expect(report.result.gscQueryTruncated).toBe(true);
    expect(report.result.gscQueryPageTruncated).toBe(true);
    expect(report.result.resultTruncated).toBe(true);
    expect(report.result.rows[0]?.gsc).toEqual({
      queryStatus: "gsc_query_sample_not_read",
      queryImpressions: null,
      queryPosition: null,
      pageUrl: null,
      nextStep: "review_content_gap",
    });
  });

  it("sorts by competitor count, best rank, volume with null last, then keyword", () => {
    const report = buildCompetitorKeywordGapReport({
      ...BASE,
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
  });

  it("exports the bounded public error-code allowlist", () => {
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
