import { describe, expect, it } from "vitest";

import { buildDailyBriefing as buildFromPackageRoot } from "../index.ts";
import {
  BRIEFING_MATERIAL_CHANGE_RATIO,
  BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE,
  BRIEFING_MIN_ROW_IMPRESSIONS,
  BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS,
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
    expect(DAILY_BRIEFING_SCHEMA_VERSION).toBe("daily_search_briefing.v3");
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
      schemaVersion: "daily_search_briefing.v3",
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
    // The floor is only reachable once a click lane can be evaluated at all,
    // so the fixture carries a query with clicks in both windows.
    const clickCapable = {
      currentQueryEvidence: evidence(
        [queryRow("has clicks", 500, 10, 9)],
        [queryPageRow("has clicks", "https://example.com/c", 500, 10, 9)],
      ),
      previousQueryEvidence: evidence(
        [queryRow("has clicks", 500, 12, 9)],
        [queryPageRow("has clicks", "https://example.com/c", 500, 12, 9)],
      ),
    };
    const below = report({
      ...clickCapable,
      dateRows: completeDateRows([143, 143, 143, 143, 143, 143, 141]),
    });
    const boundary = report({
      ...clickCapable,
      dateRows: completeDateRows([143, 143, 143, 143, 143, 143, 142]),
    });

    expect(boundary.result.mode).toBe("change_detection");
    expect(below.result.weekly.current?.impressions).toBe(999);
    expect(below.result.cadence).toBe("weekly");
    expect(boundary.result.weekly.current?.impressions).toBe(1_000);
    expect(boundary.result.cadence).toBe("daily");
  });

  it("refuses a daily cadence when the query rows could not be read", () => {
    const result = report({
      dateRows: completeDateRows([143, 143, 143, 143, 143, 143, 142]),
      currentQueryEvidence: null,
      previousQueryEvidence: null,
    }).result;

    // The impressions clear the floor, but no lane was evaluated, so there is
    // nothing to promise a visitor who comes back tomorrow.
    expect(result.weekly.current?.impressions).toBe(1_000);
    expect(result.mode).toBe("unavailable");
    expect(result.cadence).toBe("weekly");
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
    // The CTR lane measured all six rows and found one worth reporting; the
    // five baseline rows were evaluated and rejected, not left untested.
    expect(result.rowAccounting).toMatchObject({
      evidence: "observed",
      observedRows: 6,
      notSelectedVisibleRows: 0,
    });
    expect(result.rowAccounting.byLane?.click_opportunity).toEqual({
      notEvaluated: 0,
      evaluatedNoSignal: 5,
      candidates: 1,
    });
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

    expect(result.changes).toMatchObject([
      { kind: "click_opportunity", query, page: null, pageEvidence: "unavailable" },
    ]);
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
    expect(result.changes).toMatchObject([
      { kind: "click_opportunity", query, page: null, pageEvidence: "unavailable" },
    ]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("query_page_coverage_below_floor");
  });

  it("ranks every lane on one actionability order instead of capping each category", () => {
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
    // Two strong opportunities of the same kind now outrank one weaker
    // candidate of another kind, which the per-category cap made impossible.
    expect(result.actions.map((action) => action.kind)).toEqual([
      "click_opportunity",
      "click_opportunity",
      "stable_position_click_decline",
    ]);
    expect(result.actions.map((action) => action.query)).toEqual([
      "a click gap",
      "b click gap",
      "a decline",
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
    // Unconfirmed brand terms leave the CTR lane with nothing to measure, so
    // every row is untested rather than tested and cleared.
    expect(result.rowAccounting.byLane?.click_opportunity).toEqual({
      notEvaluated: 6,
      evaluatedNoSignal: 0,
      candidates: 0,
    });
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

describe("property trend", () => {
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
    expect(result.propertyTrend).toEqual({
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
      noiseFloor: {
        basis: "clicks",
        observedChange: -35,
        minimumForAction: 2 * Math.sqrt(70),
        cleared: true,
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

    // Thresholds met, noise floor not cleared: the kind says observation, and
    // only a cleared floor may say "decline".
    expect(result.propertyTrend.change).toMatchObject({
      kind: "sitewide_click_observation",
      clickChange: -3,
      clickChangeRatio: -0.15,
      positionDelta: 0,
    });
    // The thresholds are met, but three clicks off a base of twenty is inside
    // the spread the count carries on its own, so no diagnosis is dispatched.
    expect(result.propertyTrend.noiseFloor).toEqual({
      basis: "clicks",
      observedChange: -3,
      minimumForAction: 2 * Math.sqrt(20),
      cleared: false,
    });
    expect(result.propertyTrend.action).toBeNull();
    expect(result.limitations).toContain("property_change_inside_noise_floor");
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

    expect(result.propertyTrend.change?.kind).toBe(
      "sitewide_click_decline",
    );
    expect(result.propertyTrend.action?.destination).toBe(
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

    expect(result.propertyTrend.change).toMatchObject({
      kind: "sitewide_visibility_decline",
      clickChange: -2,
      clickChangeRatio: -0.1,
      impressionChange: -300,
      impressionChangeRatio: -0.15,
      positionDelta: 1,
    });
    expect(result.propertyTrend.action).toEqual({
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

    expect(result.propertyTrend.change).toMatchObject({
      kind: "sitewide_click_observation",
      clickChange: 3,
      clickChangeRatio: 0.15,
      impressionChange: 0,
      impressionChangeRatio: 0,
      positionDelta: 0,
    });
    // Gains face the same floor as declines; three clicks off twenty is noise
    // in either direction.
    expect(result.propertyTrend.noiseFloor?.cleared).toBe(false);
    expect(result.propertyTrend.action).toBeNull();
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

    expect(result.propertyTrend.change).toMatchObject({
      kind: "sitewide_visibility_gain",
      clickChange: 0,
      clickChangeRatio: 0,
      impressionChange: 300,
      impressionChangeRatio: 0.15,
      positionDelta: -1,
    });
    expect(result.propertyTrend.action?.destination).toBe("seo-quick-wins");
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

    expect(result.propertyTrend.change).toMatchObject({
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
      expect(result.propertyTrend.change).toBeNull();
      expect(result.propertyTrend.action).toBeNull();
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
    expect(result.propertyTrend.change).toBeNull();
    expect(result.propertyTrend.action).toBeNull();
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

    expect(result.propertyTrend.change).toBeNull();
    expect(result.propertyTrend.action).toBeNull();
  });

  it("keeps the property trend alongside a selected query-page change", () => {
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
    // The site-wide fact belongs to the property, not to whatever the query
    // lanes happened to find. Gating one on the other deleted it.
    expect(result.propertyTrend.change).toMatchObject({
      kind: "sitewide_click_decline",
      clickChange: -35,
    });
    expect(result.propertyTrend.action).toEqual({
      kind: "sitewide_click_decline",
      destination: "traffic-drop-diagnosis",
    });
    expect(result.signalFunnel.propertyTrendShown).toBe(true);
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
      pageOneBandCandidates: 0,
      positionDeclineCandidates: 0,
      firstObservedCandidates: 0,
      provisionalMoveCandidates: 0,
      pageAttributionWithheld: 0,
      selectedQueryChanges: 1,
      propertyTrendShown: false,
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
      pageOneBandCandidates: 0,
      positionDeclineCandidates: 0,
      firstObservedCandidates: 0,
      provisionalMoveCandidates: 0,
      pageAttributionWithheld: 0,
      selectedQueryChanges: 0,
      propertyTrendShown: false,
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
      pageOneBandCandidates: null,
      positionDeclineCandidates: null,
      firstObservedCandidates: null,
      provisionalMoveCandidates: null,
      pageAttributionWithheld: null,
      selectedQueryChanges: 0,
      propertyTrendShown: false,
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
        pageOneBandCandidates: null,
        positionDeclineCandidates: null,
        firstObservedCandidates: null,
        provisionalMoveCandidates: null,
        pageAttributionWithheld: null,
        selectedQueryChanges: 0,
        propertyTrendShown: false,
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
      propertyTrendShown: true,
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

    // The query-level opportunity survives without its page; only the
    // pair-level first_observed signal dies with its attribution.
    expect(result.changes).toMatchObject([
      { kind: "click_opportunity", page: null, pageEvidence: "unavailable" },
    ]);
    expect(result.actions).toEqual([]);
    expect(result.signalFunnel).toMatchObject({
      clickOpportunityCandidates: 1,
      firstObservedCandidates: 0,
      provisionalMoveCandidates: 0,
      pageAttributionWithheld: 2,
      selectedQueryChanges: 1,
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
          kind: "sample_floor_reached",
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
      candidates: 3,
      withheldByBand: { page_one: 0, near_page_one: 0, mid: 0, far: 0 },
      withheldByKind: { sample_floor_reached: 0, sample_building: 0 },
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

  it("uses impressions and query as the final stable sort tie-breakers", () => {
    const currentRows = [
      queryRow("zeta tie", 200, 10, 30),
      queryRow("higher impressions", 300, 10, 30),
      queryRow("alpha tie", 200, 10, 30),
    ];
    const previousRows = currentRows.map((row) => ({ ...row, clicks: 5 }));
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
      "higher impressions",
      "alpha tie",
      "zeta tie",
    ]);
  });

  it("returns no observations when three strict changes consume every slot", () => {
    const ctrTarget = queryRow("ctr target", 1_000, 0, 9);
    const decline = queryRow("brand decline", 200, 10, 5.2);
    const firstObserved = queryRow("new pair", 200, 20, 13);
    const leftover = queryRow("leftover eligible", 150, 15, 30);
    const baselines = baselineRows("baseline");
    const currentRows = [
      ctrTarget,
      decline,
      firstObserved,
      leftover,
      ...baselines,
    ];
    const previousRows = [
      ctrTarget,
      queryRow(decline.query, 200, 20, 5),
      { ...leftover, clicks: 14 },
      ...baselines,
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
      brandTerms: [decline.query],
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes.map((change) => change.kind)).toEqual([
      "click_opportunity",
      "stable_position_click_decline",
      "first_observed",
    ]);
    expect(result.queryWatchlist).toMatchObject({
      evidence: "observed",
      items: [],
    });
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

    // Counts stay null rather than zero: the rows were never read, so there
    // is no number of withheld observations to report.
    for (const [state, watchlist] of [
      ["partial", partial],
      ["unavailable", unavailable],
      ["unavailable", mixed],
    ] as const) {
      expect(watchlist).toEqual({
        evidence: state,
        items: [],
        candidates: null,
        withheldByBand: null,
        withheldByKind: null,
      });
    }
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

    expect(result.propertyTrend).toMatchObject({
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
    expect(result.changes).toMatchObject([
      { kind: "click_opportunity", query, page: null, pageEvidence: "unavailable" },
    ]);
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
    expect(result.rowAccounting.byLane).toBeNull();
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
    // The query rows are internally consistent, so the query-level signal is
    // real. Only the attribution that crosses the two reads is invalid.
    expect(result.changes).toMatchObject([
      { kind: "click_opportunity", page: null, pageEvidence: "unavailable" },
    ]);
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
    expect(result.rowAccounting.byLane).toBeNull();
    expect(result.limitations).toContain("aggregation_basis_mismatch");
  });

  it("marks absent optional evidence unavailable without inventing counts", () => {
    const result = report().result;

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.rowAccounting).toEqual({
      evidence: "unavailable",
      observedRows: null,
      notSelectedVisibleRows: null,
      byLane: null,
    });
    expect(result.coverage.current.evidence).toBe("unavailable");
    expect(result.anonymization.current.evidence).toBe("unavailable");
    expect(result.limitations).toContain("query_evidence_unavailable");
  });
});

describe("average position lanes", () => {
  function positionCase(
    query: string,
    previousPosition: number,
    currentPosition: number,
    impressions = 200,
  ) {
    const current = [
      queryRow(query, impressions, 0, currentPosition),
      ...baselineRows("base"),
    ];
    const previous = [
      queryRow(query, impressions, 0, previousPosition),
      ...baselineRows("base"),
    ];
    const page = `https://example.com/${query.replaceAll(" ", "-")}`;
    return report({
      currentQueryEvidence: evidence(current, [
        queryPageRow(query, page, impressions, 0, currentPosition),
      ]),
      previousQueryEvidence: evidence(previous, [
        queryPageRow(query, page, impressions, 0, previousPosition),
      ]),
    }).result;
  }

  it("reports a crossing into the top band at the exact improvement floor", () => {
    const result = positionCase("striking distance", 11.5, 10);

    expect(result.changes).toMatchObject([
      {
        kind: "average_position_crossed_page_one_band",
        query: "striking distance",
        positionDelta: -1.5,
        pageEvidence: "observed",
      },
    ]);
    expect(result.actions).toMatchObject([
      {
        kind: "average_position_crossed_page_one_band",
        destination: "on-page-seo-check",
      },
    ]);
  });

  it("keeps a crossing below the improvement floor out of the briefing", () => {
    expect(positionCase("small drift", 11.4, 10).changes).toEqual([]);
  });

  it("refuses to call a move a crossing when the prior window was already in band", () => {
    expect(positionCase("already there", 10, 8).changes).toEqual([]);
  });

  it("refuses to call a move a crossing when the current window is outside the band", () => {
    expect(positionCase("still outside", 13, 10.1).changes).toEqual([]);
  });

  it("reports an actionable position decline at the exact band edge", () => {
    const result = positionCase("slipping", 28, 31);

    expect(result.changes).toMatchObject([
      {
        kind: "actionable_position_decline",
        query: "slipping",
        positionDelta: 3,
      },
    ]);
    expect(result.actions).toMatchObject([
      { destination: "traffic-drop-diagnosis" },
    ]);
  });

  it("keeps a far-position slide out of the action list", () => {
    // A four-and-a-half point slide from eighty-six is real and useless: no
    // edit made this week decides whether that query earns a click.
    const result = positionCase("backlinks monitor", 86.5, 91.3);

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    // The lane ran and found nothing, which is a different statement from the
    // lane having nothing it could measure.
    expect(result.laneCapability.lanes.actionable_position_decline).toBe(
      "evaluated",
    );
    expect(result.signalFunnel.positionDeclineCandidates).toBe(0);
  });

  it("keeps a shallow in-band slide out of the action list", () => {
    expect(positionCase("shallow", 25, 27.5).changes).toEqual([]);
  });

  it("evaluates position lanes without confirmed brand terms", () => {
    // The CTR lane needs a trustworthy brand split. The position lanes do not,
    // which is the whole reason a property with no clicks can still be told
    // something true.
    const result = positionCase("unconfirmed brand", 11.8, 9.7);

    expect(result.limitations).toContain("brand_terms_not_confirmed");
    expect(result.laneCapability.ctrLane.state).toBe("not_applicable");
    expect(result.changes).toMatchObject([
      { kind: "average_position_crossed_page_one_band" },
    ]);
  });
});

describe("lane capability and briefing mode", () => {
  it("falls back to a position-first weekly briefing when no click lane applies", () => {
    const query = "no clicks anywhere";
    const rows = [queryRow(query, 500, 0, 12)];
    const page = "https://example.com/no-clicks";
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 0,
        currentClicks: 0,
        previousImpressions: 3_000,
        currentImpressions: 3_000,
        previousPosition: 12,
        currentPosition: 12,
      }),
      currentQueryEvidence: evidence(rows, [
        queryPageRow(query, page, 500, 0, 12),
      ]),
      previousQueryEvidence: evidence(rows, [
        queryPageRow(query, page, 500, 0, 12),
      ]),
    }).result;

    // Both windows carry the sample, so the position lanes really were asked;
    // the click lanes had nothing to ask about.
    expect(result.mode).toBe("change_detection");
    expect(result.laneCapability.strictPairedPositionQueries).toBe(1);
    // Weekly impressions clear the daily floor, but only the click-driven
    // lanes move on a daily timescale, and neither could be evaluated.
    expect(result.weekly.current?.impressions).toBeGreaterThanOrEqual(
      DAILY_CADENCE_MIN_IMPRESSIONS,
    );
    expect(result.cadence).toBe("weekly");
    expect(result.laneCapability.clickDeclineCapableQueries).toBe(0);
    expect(result.laneCapability.ctrOpportunityCapableQueries).toBe(0);
    expect(result.laneCapability.lanes.stable_position_click_decline).toBe(
      "not_applicable",
    );
  });

  it("drops to position observation when only a small prior window exists", () => {
    const query = "one small prior window";
    // The prior window carries 70 impressions: enough to see the average
    // position move, never enough for the strict lanes to call it a change.
    const current = [queryRow(query, 180, 0, 9.7)];
    const previous = [queryRow(query, 70, 0, 11.8)];
    const withoutPages = (rows: readonly ReturnType<typeof queryRow>[]) => ({
      ...evidence(rows, []),
      queryPageRead: null,
    });
    const result = report({
      currentQueryEvidence: withoutPages(current),
      previousQueryEvidence: withoutPages(previous),
    }).result;

    expect(result.mode).toBe("position_observation");
    expect(result.laneCapability.strictPairedPositionQueries).toBe(0);
    expect(result.laneCapability.provisionalPairedPositionQueries).toBe(1);
    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.provisionalMoves.items).toMatchObject([
      { kind: "provisional_page_one_band_entry", query },
    ]);
  });

  it("drops to a current-window watchlist when nothing pairs at all", () => {
    const query = "no prior window";
    const withoutPages = (rows: readonly ReturnType<typeof queryRow>[]) => ({
      ...evidence(rows, []),
      queryPageRead: null,
    });
    const result = report({
      currentQueryEvidence: withoutPages([queryRow(query, 180, 0, 9.7)]),
      previousQueryEvidence: withoutPages([]),
    }).result;

    expect(result.mode).toBe("current_position_watchlist");
    expect(result.laneCapability.currentFloorOnlyQueries).toBe(1);
    expect(result.laneCapability.provisionalPairedPositionQueries).toBe(0);
    expect(result.provisionalMoves.items).toEqual([]);
    expect(result.queryWatchlist.items).toMatchObject([{ query }]);
  });

  it("claims change detection once one query carries clicks to lose", () => {
    const query = "has clicks";
    const current = [queryRow(query, 500, 10, 9), ...baselineRows("base")];
    const previous = [queryRow(query, 500, 12, 9), ...baselineRows("base")];
    const page = "https://example.com/has-clicks";
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 40,
        currentClicks: 40,
        previousImpressions: 3_000,
        currentImpressions: 3_000,
        previousPosition: 9,
        currentPosition: 9,
      }),
      currentQueryEvidence: evidence(current, [
        queryPageRow(query, page, 500, 10, 9),
      ]),
      previousQueryEvidence: evidence(previous, [
        queryPageRow(query, page, 500, 12, 9),
      ]),
    }).result;

    expect(result.laneCapability.clickDeclineCapableQueries).toBeGreaterThan(0);
    expect(result.mode).toBe("change_detection");
    expect(result.cadence).toBe("daily");
  });

  it("separates a lane it could not read from a lane that cannot apply", () => {
    const result = report({
      currentQueryEvidence: null,
      previousQueryEvidence: null,
    }).result;

    expect(result.mode).toBe("unavailable");
    expect(result.laneCapability.evidence).toBe("unavailable");
    expect(result.laneCapability.clickDeclineCapableQueries).toBeNull();
    expect(result.laneCapability.lanes.click_opportunity).toBe("unavailable");
  });

  it("names why the CTR lane could not run", () => {
    const query = "thin band";
    const rows = [queryRow(query, 120, 0, 9)];
    const page = "https://example.com/thin";
    const result = report({
      currentQueryEvidence: evidence(rows, [
        queryPageRow(query, page, 120, 0, 9),
      ]),
      previousQueryEvidence: evidence(rows, [
        queryPageRow(query, page, 120, 0, 9),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.laneCapability.ctrLane.state).toBe("not_applicable");
    expect(result.laneCapability.ctrLane.blockers).toContain(
      "insufficient_band_impressions",
    );
  });

  it("blames unconfirmed brand terms rather than the data", () => {
    const result = report({
      currentQueryEvidence: evidence(baselineRows("base"), []),
      previousQueryEvidence: evidence(baselineRows("base"), []),
    }).result;

    expect(result.laneCapability.ctrLane.blockers).toEqual([
      "brand_terms_not_confirmed",
    ]);
    expect(result.laneCapability.ctrLane.usableBaselineBands).toBeNull();
  });
});

describe("property trend noise floor", () => {
  it("dispatches a diagnosis once the move outruns counting noise", () => {
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 200,
        currentClicks: 160,
        previousImpressions: 8_000,
        currentImpressions: 8_000,
        previousPosition: 10,
        currentPosition: 10,
      }),
    }).result;

    expect(result.propertyTrend.noiseFloor).toEqual({
      basis: "clicks",
      observedChange: -40,
      minimumForAction: 2 * Math.sqrt(200),
      cleared: true,
    });
    expect(result.propertyTrend.action).toEqual({
      kind: "sitewide_click_decline",
      destination: "traffic-drop-diagnosis",
    });
    expect(result.limitations).not.toContain(
      "property_change_inside_noise_floor",
    );
  });
});

describe("observation bands", () => {
  it("puts a top-band observation above a far one carrying more impressions", () => {
    const near = queryRow("near band", 150, 0, 9.7);
    const far = queryRow("far band", 900, 0, 91.3);
    const currentRows = [far, near];
    const previousRows = [
      queryRow("far band", 900, 0, 91.3),
      queryRow("near band", 150, 0, 9.7),
    ];
    const pages = [
      queryPageRow("far band", "https://example.com/far", 900, 0, 91.3),
      queryPageRow("near band", "https://example.com/near", 150, 0, 9.7),
    ];
    const result = report({
      currentQueryEvidence: evidence(currentRows, pages),
      previousQueryEvidence: evidence(previousRows, pages),
    }).result;

    // Sorting on click delta collapses to impressions when nothing has clicks,
    // which is how a query at ninety-one ended up above one at nine.
    expect(result.queryWatchlist.items.map((item) => item.query)).toEqual([
      "near band",
      "far band",
    ]);
    expect(result.queryWatchlist.items.map((item) => item.band)).toEqual([
      "page_one",
      "far",
    ]);
  });

  it("labels each band from the current average position", () => {
    const rows = [
      queryRow("top", 150, 0, 10),
      queryRow("near", 150, 0, 20),
      queryRow("mid", 150, 0, 40),
      queryRow("distant", 150, 0, 40.1),
    ];
    const result = report({
      currentQueryEvidence: evidence(rows, []),
      previousQueryEvidence: evidence(rows, []),
    }).result;

    expect(
      Object.fromEntries(
        result.queryWatchlist.items.map((item) => [item.query, item.band]),
      ),
    ).toMatchObject({ top: "page_one", near: "near_page_one", mid: "mid" });
  });

  it("says the sample floor was reached without claiming a lane evaluated it", () => {
    const rows = [queryRow("floor only", 150, 0, 30)];
    const result = report({
      currentQueryEvidence: evidence(rows, []),
      previousQueryEvidence: evidence(rows, []),
    }).result;

    expect(result.queryWatchlist.items[0]).toMatchObject({
      kind: "sample_floor_reached",
      band: "mid",
      positionDelta: 0,
    });
    expect(result.laneCapability.ctrLane.state).not.toBe("evaluated");
  });
});

describe("provisional position moves", () => {
  function provisionalRun(
    previousImpressions: number,
    positions: readonly [number, number],
  ) {
    const query = "provisional query";
    const page = "https://example.com/provisional";
    const current = [queryRow(query, 180, 0, positions[1])];
    const previous = [queryRow(query, previousImpressions, 0, positions[0])];
    return report({
      currentQueryEvidence: evidence(current, [
        queryPageRow(query, page, 180, 0, positions[1]),
      ]),
      previousQueryEvidence: evidence(previous, [
        queryPageRow(query, page, previousImpressions, 0, positions[0]),
      ]),
    }).result;
  }

  it("never turns a provisional move into a change or an action", () => {
    const result = provisionalRun(70, [11.8, 9.7]);

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.provisionalMoves.items).toMatchObject([
      { kind: "provisional_page_one_band_entry", positionDelta: 9.7 - 11.8 },
    ]);
    // The same query must not also appear as a plain observation: it is
    // already on the page, naming a movement rather than a position.
    expect(result.queryWatchlist.items).toEqual([]);
  });

  it("collects an in-band slide against a small prior window", () => {
    const result = provisionalRun(60, [20, 24]);

    expect(result.provisionalMoves.items).toMatchObject([
      { kind: "provisional_actionable_position_decline", positionDelta: 4 },
    ]);
    expect(result.actions).toEqual([]);
  });

  it("keeps 49 below the provisional floor and 100 above it", () => {
    // 49 leaves the prior window too small even to observe against.
    expect(provisionalRun(49, [11.8, 9.7]).provisionalMoves.items).toEqual([]);
    expect(
      provisionalRun(49, [11.8, 9.7]).laneCapability.currentFloorOnlyQueries,
    ).toBe(1);

    // At 100 the strict lane owns the comparison and reports a real change.
    const strict = provisionalRun(100, [11.8, 9.7]);

    expect(strict.provisionalMoves.items).toEqual([]);
    expect(strict.changes).toMatchObject([
      { kind: "average_position_crossed_page_one_band" },
    ]);
  });

  it("offers a page to check without letting it become an action", () => {
    const result = provisionalRun(70, [11.8, 9.7]);

    expect(result.provisionalMoves.items[0]).toMatchObject({
      page: "https://example.com/provisional",
      pageEvidence: "observed",
    });
    expect(result.actions).toEqual([]);
    expect(result.signalFunnel.provisionalMoveCandidates).toBe(1);
    expect(result.signalFunnel.selectedQueryChanges).toBe(0);
  });

  it("reports the prior-window range that makes these provisional", () => {
    expect(
      provisionalRun(70, [11.8, 9.7]).provisionalMoves.priorWindowImpressionRange,
    ).toEqual([BRIEFING_OBSERVATION_MIN_ROW_IMPRESSIONS, 99]);
  });
});

describe("lane state stands on per-query evidence, not on an aggregate", () => {
  it("refuses to call the CTR lane evaluated when no query got a baseline", () => {
    // Five queries of exactly one hundred impressions in one band satisfy the
    // curve's bucket gates, and then every leave-one-out baseline fails
    // because removing any one of them drops the bucket below both gates. The
    // band is usable; not one query is. Reading the lane off the band let a
    // run report a daily cadence with zero evaluable rows.
    const rows = Array.from({ length: 5 }, (_, index) =>
      queryRow(`band query ${index}`, 100, 0, 9),
    );
    // No prior window and no page read, so the CTR lane is the only path that
    // could possibly have been evaluated this run.
    const withoutPages = (input: readonly ReturnType<typeof queryRow>[]) => ({
      ...evidence(input, []),
      queryPageRead: null,
    });
    const result = report({
      dateRows: propertyDateRows({
        previousClicks: 40,
        currentClicks: 40,
        previousImpressions: 3_000,
        currentImpressions: 3_000,
        previousPosition: 9,
        currentPosition: 9,
      }),
      currentQueryEvidence: withoutPages(rows),
      previousQueryEvidence: withoutPages([]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.laneCapability.ctrOpportunityCapableQueries).toBe(0);
    expect(result.rowAccounting.byLane?.click_opportunity).toEqual({
      notEvaluated: 5,
      evaluatedNoSignal: 0,
      candidates: 0,
    });
    expect(result.laneCapability.lanes.click_opportunity).toBe(
      "not_applicable",
    );
    expect(result.mode).not.toBe("change_detection");
    expect(result.cadence).toBe("weekly");
  });

  it("keeps a provisional row for a strict candidate that lost the budget", () => {
    // Filtering the provisional layer against strict *candidates* rather than
    // the selected changes dropped such a query out of both lists. It is not
    // reported as a change, so the provisional statement is the only one the
    // page can still make about it.
    const target = "budget loser";
    const url = (query: string) =>
      `https://example.com/${query.replaceAll(" ", "-")}`;
    // Four CTR opportunities; the target carries the smallest click gap and
    // sorts out of the three-row budget.
    const gaps = [
      { query: "gap a", impressions: 4_000 },
      { query: "gap b", impressions: 3_000 },
      { query: "gap c", impressions: 2_000 },
      { query: target, impressions: 1_000 },
    ];
    const current = [
      ...gaps.map((entry) => queryRow(entry.query, entry.impressions, 0, 9.7)),
      ...baselineRows("base"),
    ];
    const previous = [
      ...gaps
        .filter((entry) => entry.query !== target)
        .map((entry) => queryRow(entry.query, entry.impressions, 0, 9.7)),
      // Under the strict floor, over the provisional one, and crossing.
      queryRow(target, 70, 0, 11.8),
      ...baselineRows("base"),
    ];
    const pagesFor = (rows: readonly ReturnType<typeof queryRow>[]) =>
      rows.map((row) =>
        queryPageRow(
          row.query,
          url(row.query),
          row.impressions,
          row.clicks,
          row.position,
        ),
      );
    const result = report({
      currentQueryEvidence: evidence(current, pagesFor(current)),
      previousQueryEvidence: evidence(previous, pagesFor(previous)),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes).toHaveLength(3);
    expect(result.changes.map((change) => change.query)).not.toContain(target);
    // The three changes consume the whole row budget, so the provisional row
    // is disclosed as withheld rather than shown - but it is still counted,
    // which is what filtering against the candidate set destroyed.
    expect(result.provisionalMoves.candidates).toBe(1);
  });

  it("keeps a query the page reports as a change out of the provisional layer", () => {
    // The CTR lane needs only the current window, so a query whose prior
    // window sits at 50-99 can hold a strict change and an action while the
    // provisional note under it promises there is none.
    const target = "target query";
    const page = "https://example.com/target";
    const current = [
      queryRow(target, 1_000, 0, 9.7),
      ...baselineRows("base"),
    ];
    const previous = [queryRow(target, 70, 0, 11.8), ...baselineRows("base")];
    const result = report({
      currentQueryEvidence: evidence(current, [
        queryPageRow(target, page, 1_000, 0, 9.7),
      ]),
      previousQueryEvidence: evidence(previous, [
        queryPageRow(target, page, 70, 0, 11.8),
      ]),
      brandTermsConfirmed: true,
    }).result;

    expect(result.changes.map((change) => change.query)).toContain(target);
    expect(result.actions.map((action) => action.query)).toContain(target);
    expect(
      result.provisionalMoves.items.map((move) => move.query),
    ).not.toContain(target);
  });

  it("refuses a prior window below the observation floor as a comparison", () => {
    const query = "tiny prior window";
    const withoutPages = (rows: readonly ReturnType<typeof queryRow>[]) => ({
      ...evidence(rows, []),
      queryPageRead: null,
    });
    const result = report({
      currentQueryEvidence: withoutPages([queryRow(query, 180, 0, 9.7)]),
      previousQueryEvidence: withoutPages([queryRow(query, 49, 0, 11.8)]),
    }).result;

    expect(result.mode).toBe("current_position_watchlist");
    // Rendering "11.8 -> 9.7" off a 49-impression week is exactly the
    // low-sample claim the floors exist to refuse.
    expect(result.queryWatchlist.items[0]).toMatchObject({
      query,
      previous: null,
      positionDelta: null,
    });
  });
});

describe("the shape of the gengrowth.ai run of 2026-08-24", () => {
  // A reduced scenario built from the capability state the ruling recorded for
  // that run: brand terms confirmed, the CTR baseline blocked by band
  // impressions, and an empty strict change-input set. Six queries instead of
  // a hundred and seventy-seven, synthesised pages, and no paging or
  // anonymization remainder.
  //
  // Two earlier versions of this fixture were built backwards. The first gave
  // `manual seo service` two hundred impressions in both windows so the strict
  // crossing lane would fire. The second left the far-position queries paired
  // at the floor, which manufactures a strict lane the ruling says the run did
  // not have. The paired-far-band case is a real shape and is covered by its
  // own test below, under its own name.
  const BACKLINKS = "backlinks monitor";
  const MANUAL = "manual seo service";
  const BEST = "best all in one seo agency software";
  const FREE = "free seo company";
  const CHEAPEST = "cheapest seo tools";
  const AUDIT = "seo audit price";
  const url = (query: string) =>
    `https://gengrowth.ai/${query.replaceAll(" ", "-")}`;

  function reducedRun() {
    const currentRows = [
      queryRow(BACKLINKS, 400, 0, 91.3),
      queryRow(MANUAL, 180, 0, 9.7),
      queryRow(BEST, 150, 0, 78.3),
      queryRow(FREE, 80, 0, 10.7),
      queryRow(CHEAPEST, 70, 0, 15.2),
      queryRow(AUDIT, 55, 0, 33),
    ];
    // No query reaches the floor in both windows, which is the ruling's
    // recorded fact: the strict change-input set was empty.
    const previousRows = [
      queryRow(BACKLINKS, 80, 0, 90.7),
      queryRow(MANUAL, 70, 0, 11.8),
      queryRow(BEST, 60, 0, 77.3),
      queryRow(FREE, 40, 0, 25),
      queryRow(CHEAPEST, 45, 0, 14.2),
    ];
    // `cheapest seo tools` and `seo audit price` carry no page rows, which is
    // how the live run came to show one observation without page evidence.
    const currentPages = [
      queryPageRow(BACKLINKS, url(BACKLINKS), 400, 0, 91.3),
      queryPageRow(MANUAL, url(MANUAL), 180, 0, 9.7),
      queryPageRow(BEST, url(BEST), 150, 0, 78.3),
      queryPageRow(FREE, url(FREE), 80, 0, 10.7),
    ];
    const previousPages = [
      queryPageRow(BACKLINKS, url(BACKLINKS), 80, 0, 90.7),
      queryPageRow(MANUAL, url(MANUAL), 70, 0, 11.8),
      queryPageRow(BEST, url(BEST), 60, 0, 77.3),
    ];

    return report({
      dateRows: propertyDateRows({
        previousClicks: 21,
        currentClicks: 14,
        previousImpressions: 2_701,
        currentImpressions: 2_534,
        previousPosition: 25.3,
        currentPosition: 25.7,
      }),
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(previousRows, previousPages),
      // The run had a confirmed brand list; the CTR lane was blocked by the
      // band, not by the confirmation. A fixture that blocks it with
      // `brand_terms_not_confirmed` would pass even if band handling broke.
      brandTermsConfirmed: true,
    }).result;
  }

  it("reproduces the run's weekly KPI tuple", () => {
    const result = reducedRun();

    expect(result.weekly.current).toMatchObject({
      clicks: 14,
      impressions: 2_534,
    });
    expect(result.weekly.previous).toMatchObject({
      clicks: 21,
      impressions: 2_701,
    });
    expect(result.weekly.current?.position).toBeCloseTo(25.7, 5);
  });

  it("reports no change for the query whose prior window is under the floor", () => {
    const result = reducedRun();

    expect(result.changes).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.provisionalMoves.items).toMatchObject([
      {
        kind: "provisional_page_one_band_entry",
        query: MANUAL,
        positionDelta: 9.7 - 11.8,
        pageEvidence: "observed",
      },
    ]);
    expect(result.provisionalMoves.priorWindowImpressionRange).toEqual([50, 99]);
    // The observation may point at a page to check. It may never become an
    // entry in today's action list.
    expect(result.provisionalMoves.items[0]?.page).toBe(url(MANUAL));
  });

  it("runs as a position-observation briefing with no strict lane evaluated", () => {
    const result = reducedRun();

    expect(result.mode).toBe("position_observation");
    expect(result.cadence).toBe("weekly");
    expect(result.laneCapability).toMatchObject({
      clickDeclineCapableQueries: 0,
      strictPairedPositionQueries: 0,
      // Three queries can be compared provisionally; only one of them moved.
      // The mode names the capability, so the copy keyed on it must not
      // promise that a movement is listed.
      provisionalPairedPositionQueries: 3,
      currentFloorOnlyQueries: 0,
    });
    expect(result.provisionalMoves.items).toHaveLength(1);
    expect(result.laneCapability.lanes).toEqual({
      click_opportunity: "not_applicable",
      stable_position_click_decline: "not_applicable",
      average_position_crossed_page_one_band: "not_applicable",
      actionable_position_decline: "not_applicable",
      first_observed: "not_applicable",
    });
  });

  it("blocks the CTR lane on the band, not on brand confirmation", () => {
    const result = reducedRun();

    expect(result.laneCapability.ctrLane.blockers).not.toContain(
      "brand_terms_not_confirmed",
    );
    expect(result.laneCapability.ctrLane.blockers.length).toBeGreaterThan(0);
    expect(result.limitations).not.toContain("brand_terms_not_confirmed");
  });

  it("separates rows no lane tested from rows a lane cleared", () => {
    const result = reducedRun();

    // Written as literals per lane rather than a sum check: the three numbers
    // are produced by subtraction from each other, so asserting that they add
    // up proves only that subtraction works. These are hand-checkable against
    // the fixture above.
    expect(result.rowAccounting.observedRows).toBe(6);
    expect(result.rowAccounting.byLane).toEqual({
      // No band forms a usable leave-one-out baseline on six rows.
      click_opportunity: {
        notEvaluated: 6,
        evaluatedNoSignal: 0,
        candidates: 0,
      },
      // Nothing pairs at the floor, so nothing was asked.
      stable_position_click_decline: {
        notEvaluated: 6,
        evaluatedNoSignal: 0,
        candidates: 0,
      },
      average_position_crossed_page_one_band: {
        notEvaluated: 6,
        evaluatedNoSignal: 0,
        candidates: 0,
      },
      actionable_position_decline: {
        notEvaluated: 6,
        evaluatedNoSignal: 0,
        candidates: 0,
      },
      // Every current pair at the floor has a prior window under it, so the
      // novelty question could not be asked of any of them.
      first_observed: {
        notEvaluated: 6,
        evaluatedNoSignal: 0,
        candidates: 0,
      },
    });
    expect(result.rowAccounting.notSelectedVisibleRows).toBe(0);
    // Nothing was withheld: a missing comparison window is not thin page
    // evidence, and this run displays that query's landing page.
    expect(result.signalFunnel.pageAttributionWithheld).toBe(0);
    expect(result.limitations).not.toContain("query_page_coverage_below_floor");
  });

  it("discloses the observations the display budget left out", () => {
    const result = reducedRun();

    expect(result.queryWatchlist.items.map((item) => item.query)).toEqual([
      FREE,
      CHEAPEST,
    ]);
    expect(result.queryWatchlist.candidates).toBe(5);
    // Two of the withheld rows cleared the sample floor and simply lost the
    // cut. Calling them "below the threshold" was the lie this count removes.
    expect(result.queryWatchlist.withheldByBand).toEqual({
      page_one: 0,
      near_page_one: 0,
      mid: 1,
      far: 2,
    });
    expect(result.queryWatchlist.withheldByKind).toEqual({
      sample_floor_reached: 2,
      sample_building: 1,
    });
  });

  it("withholds page evidence for the observation that has none", () => {
    const result = reducedRun();

    expect(
      result.queryWatchlist.items.find((item) => item.query === CHEAPEST),
    ).toMatchObject({ page: null, pageEvidence: "unavailable" });
  });

  it("reports the site-wide move as an observation, not a decline", () => {
    const result = reducedRun();

    // Seven clicks off a base of twenty-one stays inside the spread the count
    // carries on its own, so the kind stops short of the word "decline".
    expect(result.propertyTrend.change).toMatchObject({
      kind: "sitewide_click_observation",
      clickChange: -7,
    });
    expect(result.propertyTrend.noiseFloor).toMatchObject({
      basis: "clicks",
      cleared: false,
    });
    expect(result.propertyTrend.action).toBeNull();
    expect(result.limitations).toContain("property_change_inside_noise_floor");
  });

  it("evaluates the crossing lane when far-position queries do pair at the floor", () => {
    // Not a replay of that run: its own shape, named as its own case. Whether
    // the two far queries paired at the floor is not knowable from the run,
    // and this pins what happens when they do.
    const current = [
      queryRow(BACKLINKS, 400, 0, 91.3),
      queryRow(BEST, 150, 0, 78.3),
    ];
    const previous = [
      queryRow(BACKLINKS, 380, 0, 90.7),
      queryRow(BEST, 140, 0, 77.3),
    ];
    const withoutPages = (rows: readonly ReturnType<typeof queryRow>[]) => ({
      ...evidence(rows, []),
      queryPageRead: null,
    });
    const result = report({
      currentQueryEvidence: withoutPages(current),
      previousQueryEvidence: withoutPages(previous),
    }).result;

    expect(result.mode).toBe("change_detection");
    expect(result.laneCapability.strictPairedPositionQueries).toBe(2);
    expect(result.laneCapability.lanes).toMatchObject({
      average_position_crossed_page_one_band: "evaluated",
      // Neither window is inside the top thirty, so this lane has no row.
      actionable_position_decline: "not_applicable",
    });
    expect(result.changes).toEqual([]);
    expect(result.rowAccounting.byLane?.average_position_crossed_page_one_band)
      .toEqual({ notEvaluated: 0, evaluatedNoSignal: 2, candidates: 0 });
  });
});

describe("evidence gates on the query rows, not their page attachment", () => {
  function crossingWithoutPages() {
    const query = "manual seo service";
    const current = [queryRow(query, 200, 0, 9.7)];
    const previous = [queryRow(query, 200, 0, 11.8)];
    const withoutPageRead = (
      rows: readonly ReturnType<typeof queryRow>[],
    ) => ({
      ...evidence(rows, []),
      queryPageRead: null,
    });

    return report({
      currentQueryEvidence: withoutPageRead(current),
      previousQueryEvidence: withoutPageRead(previous),
    }).result;
  }

  it("keeps a query-level signal when the query-page read soft-failed", () => {
    const result = crossingWithoutPages();

    // run.ts lets each of the six attachments fail on its own. Coupling the
    // gates meant one failed page read deleted every position signal the
    // query rows could still prove.
    expect(result.changes).toMatchObject([
      {
        kind: "average_position_crossed_page_one_band",
        query: "manual seo service",
        page: null,
        pageEvidence: "unavailable",
      },
    ]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("query_page_coverage_below_floor");
    expect(result.limitations).not.toContain("query_evidence_unavailable");
  });

  it("still measures lane capability and mode without a page read", () => {
    const result = crossingWithoutPages();

    expect(result.laneCapability.evidence).toBe("observed");
    expect(result.mode).toBe("change_detection");
    expect(result.laneCapability.lanes.average_position_crossed_page_one_band).toBe(
      "evaluated",
    );
    // The page attachment never arrived, so the lane that stands on it says
    // so instead of reporting a comparison it never made.
    expect(result.laneCapability.lanes.first_observed).toBe("unavailable");
    expect(result.cadence).toBe("weekly");
  });
});

describe("action budget", () => {
  it("gives up the weakest un-handoffable row for one that can hand off", () => {
    const splitPages = (query: string) =>
      Array.from({ length: 13 }, (_, index) =>
        queryPageRow(
          query,
          `https://example.com/${query}-${index}`,
          index === 12 ? 40 : 80,
          0,
          9,
        ),
      );
    const crossings = ["cross a", "cross b", "cross c"];
    const currentRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 9)),
      queryRow("decliner", 300, 0, 26),
    ];
    const previousRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 12)),
      queryRow("decliner", 300, 0, 22),
    ];
    const currentPages = [
      ...crossings.flatMap(splitPages),
      queryPageRow("decliner", "https://example.com/decliner", 300, 0, 26),
    ];
    const previousPages = [
      ...crossings.flatMap(splitPages),
      queryPageRow("decliner", "https://example.com/decliner", 300, 0, 22),
    ];
    const result = report({
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(previousRows, previousPages),
    }).result;

    // Three higher-ranked crossings have no attributable page. Letting them
    // take every slot leaves a briefing with no handoff at all while a real
    // one waits outside the cut.
    expect(result.changes).toHaveLength(DAILY_BRIEFING_ACTION_LIMIT);
    expect(result.changes.at(-1)).toMatchObject({
      kind: "actionable_position_decline",
      query: "decliner",
      pageEvidence: "observed",
    });
    expect(result.actions).toMatchObject([
      { query: "decliner", destination: "traffic-drop-diagnosis" },
    ]);
  });

  it("keeps all three rows when none of them can hand off", () => {
    const crossings = ["cross a", "cross b", "cross c"];
    const currentRows = crossings.map((query) => queryRow(query, 1_000, 0, 9));
    const previousRows = crossings.map((query) => queryRow(query, 1_000, 0, 12));
    const result = report({
      currentQueryEvidence: {
        ...evidence(currentRows, []),
        queryPageRead: null,
      },
      previousQueryEvidence: {
        ...evidence(previousRows, []),
        queryPageRead: null,
      },
    }).result;

    expect(result.changes).toHaveLength(DAILY_BRIEFING_ACTION_LIMIT);
    expect(result.actions).toEqual([]);
  });
});

describe("page attribution refuses a partial page prefix", () => {
  function truncatedPageRead(positionNow: number, positionBefore: number) {
    const query = "crossing query";
    const page = "https://example.com/crossing";
    const current = [queryRow(query, 400, 0, positionNow)];
    const previous = [queryRow(query, 400, 0, positionBefore)];
    return report({
      currentQueryEvidence: evidence(
        current,
        [queryPageRow(query, page, 400, 0, positionNow)],
        { queryPageTruncated: true },
      ),
      previousQueryEvidence: evidence(
        previous,
        [queryPageRow(query, page, 400, 0, positionBefore)],
        { queryPageTruncated: true },
      ),
    }).result;
  }

  it("keeps the query signal but withholds the page and its handoff", () => {
    const result = truncatedPageRead(9, 12);

    // A truncated page read is a prefix of the pages a query has, so its
    // "dominant" page may just be the first one Search Console returned.
    expect(result.changes).toMatchObject([
      {
        kind: "average_position_crossed_page_one_band",
        page: null,
        pageEvidence: "unavailable",
      },
    ]);
    expect(result.actions).toEqual([]);
    expect(result.limitations).toContain("query_page_coverage_below_floor");
  });

  it("withholds first_observed entirely on a partial page prefix", () => {
    const query = "pair query";
    const current = [queryRow(query, 400, 0, 12)];
    const result = report({
      currentQueryEvidence: evidence(
        current,
        [queryPageRow(query, "https://example.com/new", 400, 0, 12)],
        { queryPageTruncated: true },
      ),
      previousQueryEvidence: evidence([queryRow(query, 400, 0, 12)], []),
    }).result;

    expect(
      result.changes.filter((change) => change.kind === "first_observed"),
    ).toEqual([]);
    expect(result.signalFunnel.firstObservedCandidates).toBe(0);
  });

  it("never lets a partial page prefix become the handoff slot given up for it", () => {
    const crossings = ["cross a", "cross b", "cross c"];
    const currentRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 9)),
      queryRow("decliner", 300, 0, 26),
    ];
    const previousRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 12)),
      queryRow("decliner", 300, 0, 22),
    ];
    const pages = (rows: readonly ReturnType<typeof queryRow>[]) =>
      rows.map((row) =>
        queryPageRow(
          row.query,
          `https://example.com/${row.query}`,
          row.impressions,
          row.clicks,
          row.position,
        ),
      );
    const result = report({
      currentQueryEvidence: evidence(currentRows, pages(currentRows), {
        queryPageTruncated: true,
      }),
      previousQueryEvidence: evidence(previousRows, pages(previousRows), {
        queryPageTruncated: true,
      }),
    }).result;

    expect(result.actions).toEqual([]);
    expect(
      result.changes.every((change) => change.pageEvidence === "unavailable"),
    ).toBe(true);
  });
});

describe("action budget boundaries", () => {
  function budgetCase(handoffableCrossings: number) {
    const crossings = ["cross a", "cross b", "cross c"];
    const currentRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 9)),
      queryRow("decliner", 300, 0, 26),
    ];
    const previousRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 12)),
      queryRow("decliner", 300, 0, 22),
    ];
    const splitPages = (query: string) =>
      Array.from({ length: 13 }, (_, index) =>
        queryPageRow(
          query,
          `https://example.com/${query}-${index}`,
          index === 12 ? 40 : 80,
          0,
          9,
        ),
      );
    const pagesFor = (
      rows: readonly ReturnType<typeof queryRow>[],
      position: number,
    ) => [
      ...crossings.flatMap((query, index) =>
        index < handoffableCrossings
          ? [
              queryPageRow(
                query,
                `https://example.com/${query}`,
                1_000,
                0,
                position,
              ),
            ]
          : splitPages(query),
      ),
      queryPageRow(
        "decliner",
        "https://example.com/decliner",
        300,
        0,
        rows === currentRows ? 26 : 22,
      ),
    ];
    return report({
      currentQueryEvidence: evidence(currentRows, pagesFor(currentRows, 9)),
      previousQueryEvidence: evidence(previousRows, pagesFor(previousRows, 12)),
    }).result;
  }

  it("keeps every top-ranked row when one of them can already hand off", () => {
    const result = budgetCase(1);

    // The seat is given up only when the whole budget went to rows that
    // cannot hand off. One that can is enough to keep the ranking intact.
    expect(result.changes.map((change) => change.query)).toEqual([
      "cross a",
      "cross b",
      "cross c",
    ]);
    expect(result.actions).toMatchObject([{ query: "cross a" }]);
  });

  it("gives the seat up for the best handoffable row when none can", () => {
    const result = budgetCase(0);

    expect(result.changes.at(-1)).toMatchObject({ query: "decliner" });
    expect(result.actions).toMatchObject([{ query: "decliner" }]);
  });
});

describe("observation band boundaries", () => {
  it("puts a query past the mid band edge in the far band", () => {
    const rows = [queryRow("just past mid", 150, 0, 40.1)];
    const result = report({
      currentQueryEvidence: evidence(rows, []),
      previousQueryEvidence: evidence(rows, []),
    }).result;

    expect(result.queryWatchlist.items[0]).toMatchObject({
      query: "just past mid",
      band: "far",
    });
  });
});

describe("handoff seat decisions", () => {
  it("lets a first-observed pair take the seat given up for a handoff", () => {
    const crossings = ["cross a", "cross b", "cross c"];
    const splitPages = (query: string) =>
      Array.from({ length: 13 }, (_, index) =>
        queryPageRow(
          query,
          `https://example.com/${query}-${index}`,
          index === 12 ? 40 : 80,
          0,
          9,
        ),
      );
    const newPair = "newly observed";
    const currentRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 9)),
      queryRow(newPair, 400, 0, 12),
    ];
    const previousRows = [
      ...crossings.map((query) => queryRow(query, 1_000, 0, 12)),
      queryRow(newPair, 400, 0, 12),
    ];
    const currentPages = [
      ...crossings.flatMap(splitPages),
      queryPageRow(newPair, "https://example.com/new-pair", 400, 0, 12),
    ];
    const previousPages = [
      ...crossings.flatMap(splitPages),
      queryPageRow(newPair, "https://example.com/old-pair", 400, 0, 12),
    ];
    const result = report({
      currentQueryEvidence: evidence(currentRows, currentPages),
      previousQueryEvidence: evidence(previousRows, previousPages),
    }).result;

    // first_observed is the weakest claim in the ranking, but it is a claim
    // about a query and a page together, so it can carry the one handoff a
    // briefing of otherwise un-attributable rows is able to offer.
    expect(result.changes.at(-1)).toMatchObject({
      kind: "first_observed",
      query: newPair,
      pageEvidence: "observed",
    });
    expect(result.actions).toMatchObject([
      { kind: "first_observed", destination: "on-page-seo-check" },
    ]);
  });
});
