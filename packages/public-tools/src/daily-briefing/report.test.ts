import { describe, expect, it } from "vitest";

import { buildDailyBriefing as buildFromPackageRoot } from "../index.ts";
import {
  BRIEFING_MATERIAL_CHANGE_RATIO,
  BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE,
  BRIEFING_MIN_ROW_IMPRESSIONS,
  BRIEFING_PROPERTY_MIN_ABSOLUTE_IMPRESSION_CHANGE,
  BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS,
  BRIEFING_PROPERTY_POSITION_DELTA,
  BRIEFING_STABLE_POSITION_DELTA,
  BRIEFING_WINDOW_DAYS,
  DAILY_BRIEFING_ACTION_LIMIT,
  DAILY_BRIEFING_SCHEMA_VERSION,
  DAILY_CADENCE_MIN_IMPRESSIONS,
  buildDailyBriefing,
} from "./report.ts";

const NOW = new Date("2026-08-24T20:00:00.000Z");
const PREVIOUS_DATES = [
  "2026-08-08",
  "2026-08-09",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
] as const;
const CURRENT_DATES = [
  "2026-08-15",
  "2026-08-16",
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
] as const;

function completeDateRows(
  currentImpressions: readonly number[] = Array(7).fill(200),
  previousImpressions: readonly number[] = Array(7).fill(200),
) {
  return [
    ...PREVIOUS_DATES.map((date, index) => ({
      date,
      clicks: Math.min(10, previousImpressions[index] ?? 0),
      impressions: previousImpressions[index] ?? 0,
      position: 8,
    })),
    ...CURRENT_DATES.map((date, index) => ({
      date,
      clicks: Math.min(10, currentImpressions[index] ?? 0),
      impressions: currentImpressions[index] ?? 0,
      position: 7,
    })),
  ];
}

function distributedTotal(total: number, index: number): number {
  return Math.floor(total / 7) + (index < total % 7 ? 1 : 0);
}

function propertyDateRows({
  currentClicks,
  currentImpressions,
  currentPosition,
  previousClicks,
  previousImpressions,
  previousPosition,
}: {
  readonly currentClicks: number;
  readonly currentImpressions: number;
  readonly currentPosition: number;
  readonly previousClicks: number;
  readonly previousImpressions: number;
  readonly previousPosition: number;
}) {
  return [
    ...PREVIOUS_DATES.map((date, index) => ({
      date,
      clicks: distributedTotal(previousClicks, index),
      impressions: distributedTotal(previousImpressions, index),
      position: previousPosition,
    })),
    ...CURRENT_DATES.map((date, index) => ({
      date,
      clicks: distributedTotal(currentClicks, index),
      impressions: distributedTotal(currentImpressions, index),
      position: currentPosition,
    })),
  ];
}

function queryRow(
  query: string,
  impressions: number,
  clicks: number,
  position = 9,
) {
  return { query, impressions, clicks, position };
}

function queryPageRow(
  query: string,
  page: string,
  impressions: number,
  clicks: number,
  position = 9,
) {
  return { query, page, impressions, clicks, position };
}

function evidence(
  rows: readonly ReturnType<typeof queryRow>[],
  queryPages: readonly ReturnType<typeof queryPageRow>[],
  options: {
    readonly queryTruncated?: boolean;
    readonly queryPageTruncated?: boolean;
    readonly queryAggregation?: string | null;
    readonly queryPageAggregation?: string | null;
    readonly totalAggregation?: string | null;
    readonly totals?: { readonly impressions: number; readonly clicks: number } | null;
  } = {},
) {
  const totals = options.totals === undefined
    ? {
        impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
        clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      }
    : options.totals;

  return {
    queryRead: {
      rows,
      paging: {
        pagesFetched: 1,
        truncated: options.queryTruncated ?? false,
      },
      responseAggregationType: options.queryAggregation ?? "byPage",
    },
    queryPageRead: {
      rows: queryPages,
      paging: {
        pagesFetched: 1,
        truncated: options.queryPageTruncated ?? false,
      },
      responseAggregationType: options.queryPageAggregation ?? "byPage",
    },
    propertyTotals: totals === null
      ? null
      : {
          ...totals,
          responseAggregationType: options.totalAggregation ?? "byPage",
        },
  };
}

function baselineRows(prefix: string, position = 9) {
  return Array.from({ length: 5 }, (_, index) =>
    queryRow(`${prefix} baseline ${index}`, 100, 10, position),
  );
}

function report(overrides: Record<string, unknown> = {}) {
  return buildDailyBriefing({
    now: NOW,
    dateRows: completeDateRows(),
    currentQueryEvidence: null,
    previousQueryEvidence: null,
    brandTerms: [],
    brandTermsConfirmed: false,
    ...overrides,
  });
}

describe("daily briefing contract and windows", () => {
  it("exports the frozen v1 constants and public non-persistent envelope", () => {
    expect(DAILY_BRIEFING_SCHEMA_VERSION).toBe("daily_search_briefing.v1");
    expect(BRIEFING_WINDOW_DAYS).toBe(7);
    expect(DAILY_CADENCE_MIN_IMPRESSIONS).toBe(1_000);
    expect(BRIEFING_MIN_ROW_IMPRESSIONS).toBe(100);
    expect(BRIEFING_MATERIAL_CHANGE_RATIO).toBe(0.15);
    expect(BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE).toBe(3);
    expect(BRIEFING_STABLE_POSITION_DELTA).toBe(0.5);
    expect(DAILY_BRIEFING_ACTION_LIMIT).toBe(3);
    expect(BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS).toBe(1_000);
    expect(BRIEFING_PROPERTY_MIN_ABSOLUTE_IMPRESSION_CHANGE).toBe(100);
    expect(BRIEFING_PROPERTY_POSITION_DELTA).toBe(1);

    expect(report().run).toEqual({
      tool: "daily_search_briefing",
      schemaVersion: "daily_search_briefing.v1",
      mode: "public_preview",
      scope: "property",
      persistence: "none",
      completedAt: NOW.toISOString(),
    });
    expect(buildFromPackageRoot).toBe(buildDailyBriefing);
  });

  it("builds non-overlapping Pacific day and seven-day windows across DST", () => {
    const result = buildDailyBriefing({
      now: new Date("2026-03-12T20:00:00.000Z"),
      dateRows: [],
      currentQueryEvidence: null,
      previousQueryEvidence: null,
      brandTerms: [],
      brandTermsConfirmed: false,
    }).result;

    expect(result.windows).toEqual({
      latestDay: { startDate: "2026-03-09", endDate: "2026-03-09" },
      previousDay: { startDate: "2026-03-08", endDate: "2026-03-08" },
      current7Days: { startDate: "2026-03-03", endDate: "2026-03-09" },
      previous7Days: { startDate: "2026-02-24", endDate: "2026-03-02" },
      readRange: { startDate: "2026-02-24", endDate: "2026-03-09" },
    });
  });
});

describe("daily and weekly KPI comparisons", () => {
  it("switches to weekly only below the complete seven-day impression floor", () => {
    const below = report({
      dateRows: completeDateRows([143, 143, 143, 143, 143, 143, 141]),
    });
    const boundary = report({
      dateRows: completeDateRows([143, 143, 143, 143, 143, 143, 142]),
    });

    expect(below.result.weekly.current?.impressions).toBe(999);
    expect(below.result.cadence).toBe("weekly");
    expect(boundary.result.weekly.current?.impressions).toBe(1_000);
    expect(boundary.result.cadence).toBe("daily");
  });

  it("keeps a missing day unavailable instead of filling it with zero", () => {
    const dateRows = completeDateRows().filter((row) => row.date !== "2026-08-20");
    const result = report({ dateRows }).result;

    expect(result.day.evidence).toBe("unavailable");
    expect(result.day.previous).toBeNull();
    expect(result.day.delta.clicks).toBeNull();
    expect(result.weekly.evidence).toBe("unavailable");
    expect(result.weekly.current).toBeNull();
    expect(result.cadence).toBe("weekly");
    expect(result.limitations).toContain("daily_data_incomplete");
  });

  it("weights weekly position by impressions", () => {
    const dateRows = completeDateRows(
      [600, 100, 100, 100, 100, 100, 100],
    ).map((row) => ({
      ...row,
      position: row.date === "2026-08-15" ? 1 : row.date >= "2026-08-16" ? 9 : row.position,
    }));

    expect(report({ dateRows }).result.weekly.current?.position).toBeCloseTo(5);
  });

  it("leaves ratios and rates null when their denominator is zero", () => {
    const dateRows = completeDateRows().map((row) =>
      row.date === "2026-08-20"
        ? { ...row, clicks: 0, impressions: 0, position: 3 }
        : row,
    );
    const result = report({ dateRows }).result;

    expect(result.day.previous).toEqual({
      clicks: 0,
      impressions: 0,
      ctr: null,
      position: null,
    });
    expect(result.day.delta.clicksRatio).toBeNull();
    expect(result.day.delta.impressionsRatio).toBeNull();
    expect(result.day.delta.ctr).toBeNull();
    expect(result.day.delta.position).toBeNull();
  });
});

describe("query changes and actions", () => {
  it("uses a leave-one-out site CTR curve for a click opportunity", () => {
    const candidate = queryRow("pricing automation", 1_000, 0, 9);
    const currentRows = [candidate, ...baselineRows("base")];
    const previousRows = [candidate, ...baselineRows("base")];
    const page = "https://example.com/pricing";
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(candidate.query, page, 1_000, 0, 9),
      ]),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(candidate.query, page, 1_000, 0, 9),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: "click_opportunity",
      evidence: "observed",
      query: candidate.query,
      page,
      baselineCtr: 0.1,
      clickGap: 100,
    });
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: "click_opportunity",
        destination: "seo-quick-wins",
        query: candidate.query,
        page,
      }),
    ]);
    expect(result.filteredObservedRows).toBe(5);
    expect(result.countComplete).toBe(true);
  });

  it("detects a material click decline only while average position is stable", () => {
    const query = "workflow templates";
    const page = "https://example.com/templates";
    const currentRows = [queryRow(query, 200, 10, 5.2), ...baselineRows("base", 5.2).map((row) => ({ ...row, clicks: 5 }))];
    const previousRows = [queryRow(query, 200, 20, 5), ...baselineRows("base", 5).map((row) => ({ ...row, clicks: 5 }))];
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, page, 200, 10, 5.2),
      ]),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, page, 200, 20, 5),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes[0]).toMatchObject({
      kind: "stable_position_click_decline",
      evidence: "observed",
      query,
      page,
      clickChange: -10,
      clickChangeRatio: -0.5,
      positionDelta: expect.closeTo(0.2),
    });
    expect(result.actions[0]?.destination).toBe("traffic-drop-diagnosis");
  });

  it("represents an absent prior row as not observed and previous null", () => {
    const query = "content workflow guide";
    const page = "https://example.com/guide";
    const currentRows = [queryRow(query, 200, 20, 9), ...baselineRows("base")];
    const previousRows = baselineRows("base");
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, page, 200, 20, 9),
      ]),
      previousQueryEvidence: evidence(previousRows, []),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes[0]).toMatchObject({
      kind: "first_observed",
      evidence: "not_observed",
      query,
      page,
      previous: null,
    });
    expect(result.actions[0]?.destination).toBe("on-page-seo-check");
  });

  it("treats a newly observed query-page pair as first observed", () => {
    const query = "workflow examples";
    const pageA = "https://example.com/examples-a";
    const pageB = "https://example.com/examples-b";
    const currentRows = [
      queryRow(query, 1_000, 100, 13),
      ...baselineRows("base", 13),
    ];
    const previousRows = [
      queryRow(query, 1_000, 100, 13),
      ...baselineRows("base", 13),
    ];
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, pageA, 800, 80, 13),
        queryPageRow(query, pageB, 200, 20, 13),
      ]),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, pageA, 1_000, 100, 13),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([
      expect.objectContaining({
        kind: "first_observed",
        evidence: "not_observed",
        query,
        page: pageB,
        current: {
          query,
          clicks: 20,
          impressions: 200,
          position: 13,
        },
        previous: null,
      }),
    ]);
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: "first_observed",
        destination: "on-page-seo-check",
        query,
        page: pageB,
      }),
    ]);
  });

  it("withholds pair absence when the prior query-page split is below 0.8 coverage", () => {
    const query = "workflow examples";
    const pageA = "https://example.com/examples-a";
    const pageB = "https://example.com/examples-b";
    const rows = [
      queryRow(query, 1_000, 100, 13),
      ...baselineRows("base", 13),
    ];
    const result = report({
      currentQueryEvidence: evidence(rows, [
        queryPageRow(query, pageB, 1_000, 100, 13),
      ]),
      previousQueryEvidence: evidence(rows, [
        queryPageRow(query, pageA, 799, 80, 13),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("query_page_coverage_below_floor");
  });

  it("does not route a first-observed query that is not near page one", () => {
    const query = "distant new query";
    const currentRows = [queryRow(query, 500, 10, 35), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, "https://example.com/distant", 500, 10, 35),
      ]),
      previousQueryEvidence: evidence(baselineRows("base"), []),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
  });

  it("withholds a page and action below query-page coverage 0.8", () => {
    const query = "pricing automation";
    const rows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const previousRows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(rows, [
        queryPageRow(query, "https://example.com/pricing", 799, 0, 9),
      ]),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, "https://example.com/pricing", 1_000, 0, 9),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("query_page_coverage_below_floor");
  });

  it("withholds an action when no observed page row clears 100 impressions", () => {
    const query = "small page split";
    const rows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const previousRows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const pageRows = Array.from({ length: 13 }, (_, index) =>
      queryPageRow(
        query,
        `https://example.com/split-${index}`,
        index === 12 ? 40 : 80,
        0,
        9,
      ),
    );
    const result = report({
      currentQueryEvidence: evidence(rows, pageRows),
      previousQueryEvidence: evidence(previousRows, pageRows),
      brandTermsConfirmed: true,
    }).result;

    expect(result.coverage.current.coveredQueries).toBe(1);
    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("query_page_coverage_below_floor");
  });

  it("emits at most one action per category in fixed order with stable tie breaks", () => {
    const base = baselineRows("base");
    const currentRows = [
      queryRow("b click gap", 800, 0, 9),
      queryRow("a click gap", 1_000, 0, 9),
      queryRow("b decline", 300, 10, 5),
      queryRow("a decline", 300, 10, 5),
      queryRow("z first", 400, 20, 13),
      queryRow("a first", 400, 20, 13),
      ...base,
    ];
    const previousRows = [
      queryRow("b click gap", 800, 0, 9),
      queryRow("a click gap", 1_000, 0, 9),
      queryRow("b decline", 300, 30, 5.1),
      queryRow("a decline", 300, 30, 5.1),
      ...baselineRows("base"),
    ];
    const currentPages = currentRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${encodeURIComponent(row.query)}`, row.impressions, row.clicks, row.position),
    );
    const previousPages = previousRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${encodeURIComponent(row.query)}`, row.impressions, row.clicks, row.position),
    );
    const result = report({
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(previousRows, previousPages),
      brandTermsConfirmed: true,
    }).result;

    expect(result.actions).toHaveLength(DAILY_BRIEFING_ACTION_LIMIT);
    expect(result.actions.map((action) => action.kind)).toEqual([
      "click_opportunity",
      "stable_position_click_decline",
      "first_observed",
    ]);
    expect(result.actions.map((action) => action.query)).toEqual([
      "a click gap",
      "a decline",
      "a first",
    ]);
  });

  it("does not pad the action list when only one category is observed", () => {
    const query = "only first row";
    const currentRows = [queryRow(query, 200, 10, 13), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, "https://example.com/only", 200, 10, 13),
      ]),
      previousQueryEvidence: evidence(baselineRows("base"), []),
      brandTermsConfirmed: true,
    }).result;

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.kind).toBe("first_observed");
  });

  it("excludes confirmed brand rows before building opportunities", () => {
    const query = "acme pricing";
    const currentRows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const previousRows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, "https://example.com/pricing", 1_000, 0, 9),
      ]),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, "https://example.com/pricing", 1_000, 0, 9),
      ]),
      brandTerms: ["acme"],
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
  });

  it("withholds CTR-baseline opportunities until brand terms are confirmed", () => {
    const query = "acme pricing";
    const page = "https://example.com/pricing";
    const rows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(rows, [
        queryPageRow(query, page, 1_000, 0, 9),
      ]),
      previousQueryEvidence: evidence(rows, [
        queryPageRow(query, page, 1_000, 0, 9),
      ]),
      brandTerms: ["acme"],
      brandTermsConfirmed: false,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.filteredObservedRows).toBe(0);
    expect(result.countComplete).toBe(false);
    expect(result.limitations).toContain("brand_terms_not_confirmed");
  });

  it("keeps neutral click-decline actions without brand confirmation", () => {
    const query = "acme workflow";
    const page = "https://example.com/workflow";
    const currentRows = [
      queryRow(query, 200, 10, 5.2),
      ...baselineRows("base", 5.2).map((row) => ({ ...row, clicks: 5 })),
    ];
    const previousRows = [
      queryRow(query, 200, 20, 5),
      ...baselineRows("base", 5).map((row) => ({ ...row, clicks: 5 })),
    ];
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, page, 200, 10, 5.2),
      ]),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, page, 200, 20, 5),
      ]),
      brandTerms: ["acme"],
      brandTermsConfirmed: false,
    }).result;

    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: "stable_position_click_decline",
        destination: "traffic-drop-diagnosis",
        query,
        page,
      }),
    ]);
    expect(result.limitations).toContain("brand_terms_not_confirmed");
  });
});

describe("property fallback", () => {
  it("falls back to an observed property click decline when query signals are empty", () => {
    const currentRows = Array.from({ length: 4 }, (_, index) =>
      queryRow(`astrology current ${index}`, 98, index === 0 ? 1 : 0, 12),
    );
    const previousRows = Array.from({ length: 4 }, (_, index) =>
      queryRow(`astrology previous ${index}`, 98, index === 0 ? 1 : 0, 10),
    );
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 70,
        currentClicks: 35,
        previousImpressions: 7_000,
        currentImpressions: 4_900,
        previousPosition: 10,
        currentPosition: 12,
      }),
      currentQueryEvidence: evidence(
        currentRows,
        currentRows.map((row, index) =>
          queryPageRow(
            row.query,
            `https://astrologywiki.com/current-${index}`,
            row.impressions,
            row.clicks,
            row.position,
          ),
        ),
      ),
      previousQueryEvidence: evidence(
        previousRows,
        previousRows.map((row, index) =>
          queryPageRow(
            row.query,
            `https://astrologywiki.com/previous-${index}`,
            row.impressions,
            row.clicks,
            row.position,
          ),
        ),
      ),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.propertyFallback).toEqual({
      change: {
        kind: "sitewide_click_decline",
        evidence: "observed",
        query: null,
        page: null,
        current: {
          clicks: 35,
          impressions: 4_900,
          ctr: 35 / 4_900,
          position: 12,
        },
        previous: {
          clicks: 70,
          impressions: 7_000,
          ctr: 70 / 7_000,
          position: 10,
        },
        clickChange: -35,
        clickChangeRatio: -0.5,
        impressionChange: -2_100,
        impressionChangeRatio: -0.3,
        positionDelta: 2,
      },
      action: {
        kind: "sitewide_click_decline",
        destination: "traffic-drop-diagnosis",
      },
    });
  });

  it("includes the exact click-decline and weekly impression floor boundaries", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 20,
        currentClicks: 17,
        previousImpressions: 1_000,
        currentImpressions: 1_000,
        previousPosition: 10,
        currentPosition: 10,
      }),
    }).result;

    expect(result.propertyFallback?.change).toMatchObject({
      kind: "sitewide_click_decline",
      clickChange: -3,
      clickChangeRatio: -0.15,
      positionDelta: 0,
    });
    expect(result.propertyFallback?.action).toEqual({
      kind: "sitewide_click_decline",
      destination: "traffic-drop-diagnosis",
    });
  });

  it("prioritizes click decline when click and visibility declines both qualify", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 20,
        currentClicks: 10,
        previousImpressions: 2_000,
        currentImpressions: 1_600,
        previousPosition: 10,
        currentPosition: 11,
      }),
    }).result;

    expect(result.propertyFallback?.change.kind).toBe(
      "sitewide_click_decline",
    );
    expect(result.propertyFallback?.action.destination).toBe(
      "traffic-drop-diagnosis",
    );
  });

  it("falls through to visibility decline at the exact ratio and position boundaries", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 20,
        currentClicks: 18,
        previousImpressions: 2_000,
        currentImpressions: 1_700,
        previousPosition: 10,
        currentPosition: 11,
      }),
    }).result;

    expect(result.propertyFallback?.change).toMatchObject({
      kind: "sitewide_visibility_decline",
      clickChange: -2,
      clickChangeRatio: -0.1,
      impressionChange: -300,
      impressionChangeRatio: -0.15,
      positionDelta: 1,
    });
    expect(result.propertyFallback?.action).toEqual({
      kind: "sitewide_visibility_decline",
      destination: "traffic-drop-diagnosis",
    });
  });

  it("emits a visibility gain from an exact-boundary click gain", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 20,
        currentClicks: 23,
        previousImpressions: 2_000,
        currentImpressions: 2_000,
        previousPosition: 10,
        currentPosition: 10,
      }),
    }).result;

    expect(result.propertyFallback?.change).toMatchObject({
      kind: "sitewide_visibility_gain",
      clickChange: 3,
      clickChangeRatio: 0.15,
      impressionChange: 0,
      impressionChangeRatio: 0,
      positionDelta: 0,
    });
    expect(result.propertyFallback?.action).toEqual({
      kind: "sitewide_visibility_gain",
      destination: "seo-quick-wins",
    });
  });

  it("emits a visibility gain from impression growth plus position improvement", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 20,
        currentClicks: 20,
        previousImpressions: 2_000,
        currentImpressions: 2_300,
        previousPosition: 10,
        currentPosition: 9,
      }),
    }).result;

    expect(result.propertyFallback?.change).toMatchObject({
      kind: "sitewide_visibility_gain",
      clickChange: 0,
      clickChangeRatio: 0,
      impressionChange: 300,
      impressionChangeRatio: 0.15,
      positionDelta: -1,
    });
    expect(result.propertyFallback?.action.destination).toBe("seo-quick-wins");
  });

  it("preserves a missing click denominator while selecting visibility decline", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 0,
        currentClicks: 0,
        previousImpressions: 2_000,
        currentImpressions: 1_700,
        previousPosition: 10,
        currentPosition: 11,
      }),
    }).result;

    expect(result.propertyFallback?.change).toMatchObject({
      kind: "sitewide_visibility_decline",
      clickChange: 0,
      clickChangeRatio: null,
      impressionChangeRatio: -0.15,
      positionDelta: 1,
    });
  });

  it.each([
    { currentImpressions: 999, previousImpressions: 1_000 },
    { currentImpressions: 1_000, previousImpressions: 999 },
  ])(
    "returns null when either weekly window is below the property floor (%o)",
    ({ currentImpressions, previousImpressions }) => {
      const result = report({
        dateRows: propertyDateRows({
          previousClicks: 20,
          currentClicks: 10,
          previousImpressions,
          currentImpressions,
          previousPosition: 10,
          currentPosition: 12,
        }),
      }).result;

      expect(result.weekly.evidence).toBe("observed");
      expect(result.propertyFallback).toBeNull();
    },
  );

  it("returns null when the weekly comparison is unavailable", () => {
    const dateRows = propertyDateRows({
      previousClicks: 70,
      currentClicks: 35,
      previousImpressions: 7_000,
      currentImpressions: 4_900,
      previousPosition: 10,
      currentPosition: 12,
    }).filter((row) => row.date !== "2026-08-20");
    const result = report({ dateRows }).result;

    expect(result.weekly.evidence).toBe("unavailable");
    expect(result.propertyFallback).toBeNull();
  });

  it("returns null for a stable property", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 20,
        currentClicks: 20,
        previousImpressions: 2_000,
        currentImpressions: 2_000,
        previousPosition: 10,
        currentPosition: 10,
      }),
    }).result;

    expect(result.propertyFallback).toBeNull();
  });

  it("suppresses the property fallback when a query-page change is selected", () => {
    const query = "workflow templates";
    const page = "https://example.com/templates";
    const currentRows = [queryRow(query, 200, 10, 5.2)];
    const previousRows = [queryRow(query, 200, 20, 5)];
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 70,
        currentClicks: 35,
        previousImpressions: 7_000,
        currentImpressions: 4_900,
        previousPosition: 10,
        currentPosition: 12,
      }),
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow(query, page, 200, 10, 5.2),
      ]),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, page, 200, 20, 5),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([
      expect.objectContaining({
        kind: "stable_position_click_decline",
        query,
        page,
      }),
    ]);
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: "stable_position_click_decline",
        destination: "traffic-drop-diagnosis",
        query,
        page,
      }),
    ]);
    expect(result.propertyFallback).toBeNull();
  });
});

describe("signal funnel", () => {
  function ctrFunnelRows() {
    return [
      queryRow("ctr target", 100, 0, 9),
      queryRow("below observation floor", 49, 4, 9),
      queryRow("observation boundary", 50, 5, 9),
      queryRow("observation ceiling", 99, 10, 9),
      queryRow("eligible peer a", 190, 19, 9),
      queryRow("eligible peer b", 190, 19, 9),
    ];
  }

  it("reports complete mixed row floors and independent candidate lanes", () => {
    const rows = ctrFunnelRows();
    const page = "https://example.com/ctr-target";
    const pages = [queryPageRow("ctr target", page, 100, 0, 9)];
    const result = report({
      currentQueryEvidence: evidence(rows, pages),
      previousQueryEvidence: evidence(rows, pages),
      brandTermsConfirmed: true,
    }).result;

    expect(result.signalFunnel).toEqual({
      evidence: "observed",
      observedQueryRows: 6,
      observationCandidates: 2,
      actionEligibleQueries: 3,
      ctrBaselineRows: 1,
      clickOpportunityCandidates: 1,
      stableDeclineCandidates: 0,
      firstObservedCandidates: 0,
      pageAttributionWithheld: 0,
      selectedQueryChanges: 1,
      propertyFallbackShown: false,
    });
  });

  it("keeps 50 and 99 observation-only while 100 is action-eligible", () => {
    const rows = [
      queryRow("below", 49, 0, 30),
      queryRow("fifty", 50, 0, 30),
      queryRow("ninety nine", 99, 0, 30),
      queryRow("one hundred", 100, 0, 30),
    ];
    const result = report({
      currentQueryEvidence: evidence(rows, []),
      previousQueryEvidence: evidence(rows, []),
      brandTermsConfirmed: true,
    }).result;

    expect(result.signalFunnel).toMatchObject({
      evidence: "observed",
      observedQueryRows: 4,
      observationCandidates: 2,
      actionEligibleQueries: 1,
    });
  });

  it("leaves CTR lanes unevaluated until brand terms are confirmed", () => {
    const rows = ctrFunnelRows();
    const page = "https://example.com/ctr-target";
    const pages = [queryPageRow("ctr target", page, 100, 0, 9)];
    const result = report({
      currentQueryEvidence: evidence(rows, pages),
      previousQueryEvidence: evidence(rows, pages),
      brandTermsConfirmed: false,
    }).result;

    expect(result.signalFunnel).toEqual({
      evidence: "observed",
      observedQueryRows: 6,
      observationCandidates: 2,
      actionEligibleQueries: 3,
      ctrBaselineRows: null,
      clickOpportunityCandidates: null,
      stableDeclineCandidates: 0,
      firstObservedCandidates: 0,
      pageAttributionWithheld: 0,
      selectedQueryChanges: 0,
      propertyFallbackShown: false,
    });
  });

  it("reports only the valid current prefix length for partial evidence", () => {
    const rows = [
      queryRow("valid prefix", 100, 10, 9),
      queryRow("observation prefix", 50, 1, 9),
      queryRow("invalid prefix", -1, -1, 9),
    ];
    const result = report({
      currentQueryEvidence: evidence(rows, [], { queryTruncated: true }),
      previousQueryEvidence: evidence(rows.slice(0, 2), []),
      brandTermsConfirmed: true,
    }).result;

    expect(result.signalFunnel).toEqual({
      evidence: "partial",
      observedQueryRows: 2,
      observationCandidates: null,
      actionEligibleQueries: null,
      ctrBaselineRows: null,
      clickOpportunityCandidates: null,
      stableDeclineCandidates: null,
      firstObservedCandidates: null,
      pageAttributionWithheld: null,
      selectedQueryChanges: 0,
      propertyFallbackShown: false,
    });
  });

  it("uses null counts for missing and mixed aggregation evidence", () => {
    const rows = [queryRow("mixed basis", 100, 10, 9)];
    const missing = report().result.signalFunnel;
    const mixed = report({
      currentQueryEvidence: evidence(rows, [], {
        queryAggregation: "byProperty",
        queryPageAggregation: "byProperty",
        totalAggregation: "byProperty",
      }),
      previousQueryEvidence: evidence(rows, [], {
        queryAggregation: "byPage",
        queryPageAggregation: "byPage",
        totalAggregation: "byPage",
      }),
      brandTermsConfirmed: true,
    }).result.signalFunnel;

    for (const funnel of [missing, mixed]) {
      expect(funnel).toEqual({
        evidence: "unavailable",
        observedQueryRows: null,
        observationCandidates: null,
        actionEligibleQueries: null,
        ctrBaselineRows: null,
        clickOpportunityCandidates: null,
        stableDeclineCandidates: null,
        firstObservedCandidates: null,
        pageAttributionWithheld: null,
        selectedQueryChanges: 0,
        propertyFallbackShown: false,
      });
    }
  });

  it("reports a property fallback separately from selected query changes", () => {
    const currentRows = Array.from({ length: 4 }, (_, index) =>
      queryRow(`current observation ${index}`, 98, 1, 12),
    );
    const previousRows = Array.from({ length: 4 }, (_, index) =>
      queryRow(`previous observation ${index}`, 98, 1, 10),
    );
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 70,
        currentClicks: 35,
        previousImpressions: 7_000,
        currentImpressions: 4_900,
        previousPosition: 10,
        currentPosition: 12,
      }),
      currentQueryEvidence: evidence(currentRows, []),
      previousQueryEvidence: evidence(previousRows, []),
      brandTermsConfirmed: true,
    }).result;

    expect(result.signalFunnel).toMatchObject({
      evidence: "observed",
      observedQueryRows: 4,
      observationCandidates: 4,
      actionEligibleQueries: 0,
      selectedQueryChanges: 0,
      propertyFallbackShown: true,
    });
  });

  it("counts first-observed and selected-query page attribution rejects", () => {
    const rows = ctrFunnelRows();
    const firstObserved = queryRow("new uncovered pair", 200, 20, 13);
    const currentRows = [...rows, firstObserved];
    const targetPage = "https://example.com/ctr-target";
    const currentPages = [
      queryPageRow("ctr target", targetPage, 80, 0, 9),
      queryPageRow(
        firstObserved.query,
        "https://example.com/new-uncovered",
        159,
        16,
        13,
      ),
    ];
    const previousPages = [queryPageRow("ctr target", targetPage, 80, 0, 9)];
    const result = report({
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(rows, previousPages),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.signalFunnel).toMatchObject({
      clickOpportunityCandidates: 1,
      firstObservedCandidates: 0,
      pageAttributionWithheld: 2,
      selectedQueryChanges: 0,
    });
  });
});

describe("query observation watchlist", () => {
  it("keeps 49 below the watchlist and classifies the 50, 99, and 100 boundaries", () => {
    const currentRows = [
      queryRow("below floor", 49, 4, 30),
      queryRow("sample fifty", 50, 5, 30),
      queryRow("sample ninety nine", 99, 9, 30),
      queryRow("eligible hundred", 100, 10, 30),
    ];
    const previousRows = currentRows.map((row) => ({ ...row, clicks: 0 }));
    const currentPages = currentRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${row.query.replaceAll(" ", "-")}`, row.impressions, row.clicks, row.position),
    );
    const previousPages = previousRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${row.query.replaceAll(" ", "-")}`, row.impressions, row.clicks, row.position),
    );
    const result = report({
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(previousRows, previousPages),
      brandTermsConfirmed: false,
    }).result;

    expect(result.queryWatchlist).toEqual({
      evidence: "observed",
      items: [
        expect.objectContaining({
          kind: "evaluation_eligible",
          query: "eligible hundred",
          page: "https://example.com/eligible-hundred",
          pageEvidence: "observed",
        }),
        expect.objectContaining({
          kind: "sample_building",
          query: "sample ninety nine",
          page: "https://example.com/sample-ninety-nine",
          pageEvidence: "observed",
        }),
        expect.objectContaining({
          kind: "sample_building",
          query: "sample fifty",
          page: "https://example.com/sample-fifty",
          pageEvidence: "observed",
        }),
      ],
    });
    expect(result.queryWatchlist.items.map((item) => item.query)).not.toContain(
      "below floor",
    );
  });

  it("excludes strict changes and fills only the unused three-row slots", () => {
    const strict = queryRow("strict decline", 200, 10, 5.2);
    const observers = [
      queryRow("observer a", 180, 12, 30),
      queryRow("observer b", 170, 11, 30),
      queryRow("observer c", 160, 10, 30),
    ];
    const currentRows = [strict, ...observers];
    const previousRows = [
      queryRow(strict.query, 200, 20, 5),
      ...observers.map((row) => ({ ...row, clicks: row.clicks - 1 })),
    ];
    const currentPages = currentRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${row.query.replaceAll(" ", "-")}`, row.impressions, row.clicks, row.position),
    );
    const previousPages = previousRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${row.query.replaceAll(" ", "-")}`, row.impressions, row.clicks, row.position),
    );
    const result = report({
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(previousRows, previousPages),
      brandTermsConfirmed: false,
    }).result;

    expect(result.changes).toEqual([
      expect.objectContaining({ query: strict.query }),
    ]);
    expect(result.queryWatchlist.items).toHaveLength(2);
    expect(result.queryWatchlist.items.map((item) => item.query)).not.toContain(
      strict.query,
    );
    expect(result.changes.length + result.queryWatchlist.items.length).toBe(3);
  });

  it("sorts observed comparisons before a missing previous row within a tier", () => {
    const currentRows = [
      queryRow("missing previous", 500, 30, 30),
      queryRow("smaller delta", 200, 15, 30),
      queryRow("larger delta", 150, 20, 30),
    ];
    const previousRows = [
      queryRow("smaller delta", 200, 10, 30),
      queryRow("larger delta", 150, 5, 30),
    ];
    const pages = currentRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${row.query.replaceAll(" ", "-")}`, row.impressions, row.clicks, row.position),
    );
    const previousPages = previousRows.map((row) =>
      queryPageRow(row.query, `https://example.com/${row.query.replaceAll(" ", "-")}`, row.impressions, row.clicks, row.position),
    );
    const result = report({
      currentQueryEvidence: evidence(currentRows, pages),
      previousQueryEvidence: evidence(previousRows, previousPages),
      brandTermsConfirmed: false,
    }).result;

    expect(result.queryWatchlist.items.map((item) => item.query)).toEqual([
      "larger delta",
      "smaller delta",
      "missing previous",
    ]);
    expect(result.queryWatchlist.items[2]?.previous).toBeNull();
  });

  it("attributes only pages at the tier floor with at least 80 percent coverage", () => {
    const currentRows = [
      queryRow("coverage below", 1_000, 10, 30),
      queryRow("coverage boundary", 1_000, 10, 30),
    ];
    const previousRows = currentRows.map((row) => ({ ...row, clicks: 9 }));
    const currentPages = [
      queryPageRow("coverage below", "https://example.com/coverage-below", 799, 8, 30),
      queryPageRow("coverage boundary", "https://example.com/coverage-boundary", 800, 8, 30),
    ];
    const previousPages = previousRows.map((row) =>
      queryPageRow(row.query, `https://example.com/previous-${row.query.replaceAll(" ", "-")}`, row.impressions, row.clicks, row.position),
    );
    const result = report({
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(previousRows, previousPages),
      brandTermsConfirmed: false,
    }).result;
    const byQuery = new Map(
      result.queryWatchlist.items.map((item) => [item.query, item]),
    );

    expect(byQuery.get("coverage below")).toMatchObject({
      page: null,
      pageEvidence: "unavailable",
    });
    expect(byQuery.get("coverage boundary")).toMatchObject({
      page: "https://example.com/coverage-boundary",
      pageEvidence: "observed",
    });
  });

  it("requires 50 page impressions for a sample-building attribution", () => {
    const currentRows = [
      queryRow("sample page below", 50, 5, 30),
      queryRow("sample page boundary", 50, 5, 30),
    ];
    const previousRows = currentRows.map((row) => ({ ...row, clicks: 4 }));
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow("sample page below", "https://example.com/sample-below", 49, 5, 30),
        queryPageRow("sample page boundary", "https://example.com/sample-boundary", 50, 5, 30),
      ]),
      previousQueryEvidence: evidence(previousRows, []),
      brandTermsConfirmed: false,
    }).result;
    const byQuery = new Map(
      result.queryWatchlist.items.map((item) => [item.query, item]),
    );

    expect(byQuery.get("sample page below")).toMatchObject({
      page: null,
      pageEvidence: "unavailable",
    });
    expect(byQuery.get("sample page boundary")).toMatchObject({
      page: "https://example.com/sample-boundary",
      pageEvidence: "observed",
    });
  });

  it("requires 100 page impressions for an evaluation-eligible attribution", () => {
    const currentRows = [
      queryRow("eligible page below", 100, 10, 30),
      queryRow("eligible page boundary", 100, 10, 30),
    ];
    const previousRows = currentRows.map((row) => ({ ...row, clicks: 9 }));
    const result = report({
      currentQueryEvidence: evidence(currentRows, [
        queryPageRow("eligible page below", "https://example.com/eligible-below", 99, 10, 30),
        queryPageRow("eligible page boundary", "https://example.com/eligible-boundary", 100, 10, 30),
      ]),
      previousQueryEvidence: evidence(previousRows, []),
      brandTermsConfirmed: false,
    }).result;
    const byQuery = new Map(
      result.queryWatchlist.items.map((item) => [item.query, item]),
    );

    expect(byQuery.get("eligible page below")).toMatchObject({
      page: null,
      pageEvidence: "unavailable",
    });
    expect(byQuery.get("eligible page boundary")).toMatchObject({
      page: "https://example.com/eligible-boundary",
      pageEvidence: "observed",
    });
  });

  it("keeps partial and unavailable watchlists distinct without ranked items", () => {
    const rows = [queryRow("eligible", 100, 10, 30)];
    const partial = report({
      currentQueryEvidence: evidence(rows, [], { queryTruncated: true }),
      previousQueryEvidence: evidence(rows, []),
      brandTermsConfirmed: false,
    }).result.queryWatchlist;
    const unavailable = report().result.queryWatchlist;
    const mixed = report({
      currentQueryEvidence: evidence(rows, [], {
        queryAggregation: "byProperty",
        queryPageAggregation: "byProperty",
        totalAggregation: "byProperty",
      }),
      previousQueryEvidence: evidence(rows, [], {
        queryAggregation: "byPage",
        queryPageAggregation: "byPage",
        totalAggregation: "byPage",
      }),
      brandTermsConfirmed: false,
    }).result.queryWatchlist;

    expect(partial).toEqual({ evidence: "partial", items: [] });
    expect(unavailable).toEqual({ evidence: "unavailable", items: [] });
    expect(mixed).toEqual({ evidence: "unavailable", items: [] });
  });

  it("keeps the property fallback independent from observation rows", () => {
    const currentRows = [
      queryRow("sample a", 99, 2, 30),
      queryRow("sample b", 98, 2, 30),
    ];
    const previousRows = currentRows.map((row) => ({ ...row, clicks: 1 }));
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 70,
        currentClicks: 35,
        previousImpressions: 7_000,
        currentImpressions: 4_900,
        previousPosition: 10,
        currentPosition: 12,
      }),
      currentQueryEvidence: evidence(currentRows, []),
      previousQueryEvidence: evidence(previousRows, []),
      brandTermsConfirmed: false,
    }).result;

    expect(result.propertyFallback).toMatchObject({
      change: { kind: "sitewide_click_decline", query: null, page: null },
    });
    expect(result.queryWatchlist.items.map((item) => item.query)).toEqual([
      "sample a",
      "sample b",
    ]);
  });
});

describe("query evidence boundaries", () => {
  it("filters negative query and query-page metrics before coverage", () => {
    const query = "pricing automation";
    const page = "https://example.com/pricing";
    const candidate = queryRow(query, 1_000, 0, 9);
    const currentRows = [
      candidate,
      ...baselineRows("base"),
      queryRow("invalid query", -100, -1, 9),
    ];
    const previousRows = [candidate, ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(
        currentRows,
        [
          queryPageRow(query, page, 800, 0, 9),
          queryPageRow(query, "https://example.com/invalid", -100, -1, 9),
        ],
        { totals: { impressions: 1_500, clicks: 50 } },
      ),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, page, 1_000, 0, 9),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.coverage.current.queryRows).toBe(6);
    expect(result.coverage.current.queryPageRows).toBe(1);
    expect(result.actions[0]).toMatchObject({
      kind: "click_opportunity",
      query,
      page,
    });
  });

  it("refuses non-finite query-page metrics before dominant-page selection", () => {
    const query = "pricing automation";
    const validPage = "https://example.com/z-valid";
    const candidate = queryRow(query, 1_000, 0, 9);
    const currentRows = [
      candidate,
      ...baselineRows("base"),
      queryRow("invalid query", 100, Number.NaN, Number.POSITIVE_INFINITY),
    ];
    const previousRows = [candidate, ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(
        currentRows,
        [
          queryPageRow(query, validPage, 200, 0, 9),
          queryPageRow(
            query,
            "https://example.com/a-invalid",
            800,
            Number.NaN,
            Number.POSITIVE_INFINITY,
          ),
        ],
        { totals: { impressions: 1_500, clicks: 50 } },
      ),
      previousQueryEvidence: evidence(previousRows, [
        queryPageRow(query, validPage, 1_000, 0, 9),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.coverage.current.queryRows).toBe(6);
    expect(result.coverage.current.queryPageRows).toBe(1);
    expect(result.coverage.current.coveredQueries).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("query_page_coverage_below_floor");
  });

  it("withholds inference and marks observed-row count incomplete on truncation", () => {
    const query = "pricing automation";
    const rows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(
        rows,
        [queryPageRow(query, "https://example.com/pricing", 1_000, 0, 9)],
        { queryTruncated: true },
      ),
      previousQueryEvidence: evidence(rows, [
        queryPageRow(query, "https://example.com/pricing", 1_000, 0, 9),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.countComplete).toBe(false);
    expect(result.coverage.current.evidence).toBe("partial");
    expect(result.limitations).toContain("query_evidence_partial");
  });

  it("keeps anonymization unavailable when aggregation bases disagree", () => {
    const rows = baselineRows("q");
    const result = report({
      currentQueryEvidence: evidence(rows, [], {
        queryAggregation: "byPage",
        totalAggregation: "byProperty",
      }),
      previousQueryEvidence: evidence(rows, []),
      brandTermsConfirmed: true,
    }).result;

    expect(result.anonymization.current).toMatchObject({
      evidence: "unavailable",
      missingImpressionShare: null,
      missingClickShare: null,
    });
    expect(result.limitations).toContain("aggregation_basis_mismatch");
  });

  it("withholds page actions when query and query-page aggregation bases differ", () => {
    const query = "pricing automation";
    const page = "https://example.com/pricing";
    const rows = [queryRow(query, 1_000, 0, 9), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(
        rows,
        [queryPageRow(query, page, 1_000, 0, 9)],
        {
          queryAggregation: "byProperty",
          queryPageAggregation: "byPage",
          totalAggregation: "byProperty",
        },
      ),
      previousQueryEvidence: evidence(
        rows,
        [queryPageRow(query, page, 1_000, 0, 9)],
        {
          queryAggregation: "byProperty",
          queryPageAggregation: "byPage",
          totalAggregation: "byProperty",
        },
      ),
      brandTermsConfirmed: true,
    }).result;

    expect(result.coverage.current.evidence).toBe("unavailable");
    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("aggregation_basis_mismatch");
  });

  it("keeps query actions available when only property totals are unavailable", () => {
    const candidate = queryRow("pricing automation", 1_000, 0, 9);
    const rows = [candidate, ...baselineRows("base")];
    const page = "https://example.com/pricing";
    const result = report({
      currentQueryEvidence: evidence(
        rows,
        [queryPageRow(candidate.query, page, 1_000, 0, 9)],
        { totals: null },
      ),
      previousQueryEvidence: evidence(rows, [
        queryPageRow(candidate.query, page, 1_000, 0, 9),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.actions[0]).toMatchObject({
      kind: "click_opportunity",
      query: candidate.query,
      page,
    });
    expect(result.coverage.current.evidence).toBe("observed");
    expect(result.anonymization.current.evidence).toBe("unavailable");
    expect(result.limitations).toContain("property_totals_unavailable");
    expect(result.limitations).not.toContain("query_evidence_unavailable");
  });

  it("withholds cross-window changes when query aggregation bases differ", () => {
    const query = "workflow templates";
    const page = "https://example.com/templates";
    const currentRows = [
      queryRow(query, 200, 10, 5.2),
      ...baselineRows("base", 5.2).map((row) => ({ ...row, clicks: 5 })),
    ];
    const previousRows = [
      queryRow(query, 200, 20, 5),
      ...baselineRows("base", 5).map((row) => ({ ...row, clicks: 5 })),
    ];
    const result = report({
      currentQueryEvidence: evidence(
        currentRows,
        [queryPageRow(query, page, 200, 10, 5.2)],
        { queryAggregation: "byProperty", totalAggregation: "byProperty" },
      ),
      previousQueryEvidence: evidence(
        previousRows,
        [queryPageRow(query, page, 200, 20, 5)],
        { queryAggregation: "byPage", totalAggregation: "byPage" },
      ),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.countComplete).toBe(false);
    expect(result.limitations).toContain("aggregation_basis_mismatch");
  });

  it("marks absent optional evidence unavailable without inventing counts", () => {
    const result = report().result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.filteredObservedRows).toBe(0);
    expect(result.countComplete).toBe(false);
    expect(result.coverage.current.evidence).toBe("unavailable");
    expect(result.anonymization.current.evidence).toBe("unavailable");
    expect(result.limitations).toContain("query_evidence_unavailable");
  });
});
