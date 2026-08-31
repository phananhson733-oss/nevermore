import { beforeEach, describe, expect, it, vi } from "vitest";

import { GSC_ROW_LIMIT } from "../gsc-analytics/reader.ts";
import type {
  GscQueryClient,
  GscQueryRequest,
  GscQueryResponse,
  GscRawRow,
} from "../gsc-analytics/types.ts";
import { shiftDate } from "../gsc-analytics/window.ts";
import { runDailyBriefing } from "./run.ts";
import type { DailyBriefingEnvelope } from "./types.ts";
import { verifyDailyBriefing } from "./verification.ts";

// The verifier's exact-filter I/O has its own suite. Here it is a terminal
// seam so these tests can count and inspect the bounded candidate read plan.
vi.mock("./verification.ts", () => ({
  verifyDailyBriefing: vi.fn(async (envelope: DailyBriefingEnvelope) => envelope),
}));

const NOW = new Date("2026-08-24T20:00:00.000Z");
const DATES = Array.from({ length: 14 }, (_, index) => {
  const day = 8 + index;
  return `2026-08-${String(day).padStart(2, "0")}`;
});

function dateRows(): readonly GscRawRow[] {
  return DATES.map((date) => ({
    keys: [date],
    clicks: 10,
    impressions: 200,
    position: 8,
  }));
}

function queryRows(): readonly GscRawRow[] {
  return Array.from({ length: 5 }, (_, index) => ({
    keys: [`baseline ${index}`],
    clicks: 10,
    impressions: 100,
    position: 9,
  }));
}

function queryPageRows(): readonly GscRawRow[] {
  return Array.from({ length: 5 }, (_, index) => ({
    keys: [`baseline ${index}`, `https://example.com/${index}`],
    clicks: 10,
    impressions: 100,
    position: 9,
  }));
}

/** The page whose decline exists only in the page dimension. */
const PAGE_UNDER_TEST = "https://example.com/page-under-test";

/**
 * Distinct per window, and distinct from the query-page fixture.
 *
 * Identical fixtures would let this suite pass with `pageRead` wired to the
 * `[query,page]` result, with the two windows swapped, or with one window's
 * result used for both — every one of which still issues the same call count.
 */
function pageRows(window: "current" | "previous"): readonly GscRawRow[] {
  return [
    {
      keys: [PAGE_UNDER_TEST],
      clicks: window === "current" ? 8 : 20,
      impressions: window === "current" ? 380 : 400,
      position: window === "current" ? 9.4 : 9.1,
    },
  ];
}

function responseFor(
  request: GscQueryRequest,
  rows: {
    readonly dates?: readonly GscRawRow[];
    readonly queries?: readonly GscRawRow[];
    readonly queryPages?: readonly GscRawRow[];
    readonly pages?: readonly GscRawRow[];
  } = {},
): GscQueryResponse {
  if (request.dimensions.length === 0) {
    return {
      rows: [{ keys: [], clicks: 50, impressions: 500, position: 9 }],
      responseAggregationType: "byPage",
    };
  }
  if (request.dimensions[0] === "date") {
    return {
      rows: rows.dates ?? dateRows().filter((row) =>
        row.keys[0]! >= request.startDate && row.keys[0]! <= request.endDate),
      responseAggregationType: "byProperty",
    };
  }
  if (request.dimensions[0] === "hour") {
    return {
      rows: [{ keys: ["2026-08-24T03:00:00-07:00"], clicks: 2, impressions: 20, position: 8 }],
      responseAggregationType: "byProperty",
    };
  }
  if (request.dimensions.length === 2) {
    return {
      rows: rows.queryPages ?? queryPageRows(),
      responseAggregationType: "byPage",
    };
  }
  if (request.dimensions[0] === "page") {
    return {
      rows:
        rows.pages ??
        pageRows(request.startDate === "2026-08-15" ? "current" : "previous"),
      responseAggregationType: "byPage",
    };
  }
  return {
    rows: rows.queries ?? queryRows(),
    responseAggregationType: request.aggregationType ?? "byProperty",
  };
}

describe("runDailyBriefing read plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([false, true])("returns the verifier's envelope and forwards its budget when supplied: %s", async (withBudget) => {
    const client: GscQueryClient = async (request) => responseFor(request);
    const budget = { isExpired: () => false };
    let verified: DailyBriefingEnvelope | null = null;
    vi.mocked(verifyDailyBriefing).mockImplementationOnce(async (envelope) => {
      verified = { ...envelope };
      return verified;
    });

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
      ...(withBudget ? { budget } : {}),
    });

    expect(verifyDailyBriefing).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ result: expect.objectContaining({
        windows: expect.objectContaining({ latestDay: { startDate: "2026-08-21", endDate: "2026-08-21" } }),
      }) }),
      client,
      withBudget ? { budget } : {},
    );
    expect(envelope).toBe(verified);
  });

  it("reuses one fresh 90-day read and freezes separate query and page aggregation reads", async () => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return responseFor(request);
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    // The same date response drives the analysis window and daily trend.
    // Query facts and page-coverage totals have independent aggregation reads.
    expect(calls).toHaveLength(13);
    expect(calls.filter((call) => call.dimensions[0] === "date")).toEqual([
      {
        dimensions: ["date"],
        startDate: "2026-05-27",
        endDate: "2026-08-24",
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
        dataState: "all",
        aggregationType: "byProperty",
      },
      {
        dimensions: ["date"],
        startDate: "2026-05-24",
        endDate: "2026-05-26",
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
        dataState: "all",
        aggregationType: "byProperty",
      },
    ]);
    expect(
      calls.find((call) => String(call.dimensions[0]) === "hour"),
    ).toEqual({
      dimensions: ["hour"],
      startDate: "2026-08-15",
      endDate: "2026-08-24",
      rowLimit: GSC_ROW_LIMIT,
      startRow: 0,
      dataState: "hourly_all",
      aggregationType: "byProperty",
    });
    expect(envelope.result.trend).toMatchObject({
      daily: { evidence: "observed" },
      hourly: { evidence: "partial" },
    });
    const queryReads = calls.filter((call) => call.dimensions.length === 1 && call.dimensions[0] === "query");
    expect(queryReads).toHaveLength(4);
    expect(queryReads).toEqual(
      expect.arrayContaining(["byProperty", "byPage"].flatMap((aggregationType) => [
        expect.objectContaining({
          startDate: "2026-08-15",
          endDate: "2026-08-21",
          rowLimit: GSC_ROW_LIMIT,
          startRow: 0,
          aggregationType,
          dataState: "all",
        }),
        expect.objectContaining({
          startDate: "2026-08-08",
          endDate: "2026-08-14",
          rowLimit: GSC_ROW_LIMIT,
          startRow: 0,
          aggregationType,
          dataState: "all",
        }),
      ])),
    );
    expect(calls.filter((call) => call.dimensions.length === 2)).toEqual([
      expect.objectContaining({ aggregationType: "auto" }),
      expect.objectContaining({ aggregationType: "auto" }),
    ]);
    expect(calls.filter((call) => call.dimensions.length === 0)).toEqual([
      expect.objectContaining({ aggregationType: "byPage" }),
      expect.objectContaining({ aggregationType: "byPage" }),
    ]);
    // The page dimension on its own, one window each, with the basis stated
    // in the request rather than inherited — the report rejects a response
    // that comes back on any other one.
    expect(
      calls.filter(
        (call) => call.dimensions.length === 1 && call.dimensions[0] === "page",
      ),
    ).toEqual([
      {
        dimensions: ["page"],
        startDate: "2026-08-15",
        endDate: "2026-08-21",
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
        aggregationType: "byPage",
        dataState: "all",
      },
      {
        dimensions: ["page"],
        startDate: "2026-08-08",
        endDate: "2026-08-14",
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
        aggregationType: "byPage",
        dataState: "all",
      },
    ]);
    expect(calls.filter((call) => call.dimensions[0] !== "hour").every((call) => call.dataState === "all")).toBe(true);
    expect(envelope.result.trend.daily.points).toHaveLength(DATES.length);
    expect(envelope.result.limitations).not.toContain(
      "page_evidence_unavailable",
    );
    // The point of the two extra calls: a decline that exists only in the page
    // dimension reaches the report. The query rows in this fixture carry no
    // decline at all, so nothing but the standalone page read can produce it.
    expect(envelope.result.pageChanges).toMatchObject([
      {
        kind: "page_click_decline",
        page: PAGE_UNDER_TEST,
        clickChange: -12,
      },
    ]);
    expect(envelope.result.changes).toEqual([]);
    expect(envelope.result.weekly.evidence).toBe("observed");
    expect(envelope.result.limitations).not.toContain("query_evidence_unavailable");
  });

  it("starts all optional attachments concurrently after the required read", async () => {
    const optionalStarted: GscQueryRequest[] = [];
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client: GscQueryClient = async (request) => {
      if (request.dimensions[0] === "date" && request.endDate === "2026-08-24") {
        return responseFor(request);
      }
      optionalStarted.push(request);
      await blocked;
      return responseFor(request);
    };

    const pending = runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    await vi.waitFor(() => expect(optionalStarted).toHaveLength(12));
    release();
    await expect(pending).resolves.toBeDefined();
  });

  it("uses the latest valid observed date for every analysis attachment", async () => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return responseFor(request, {
        dates: [
          { keys: ["2026-08-23"], clicks: 7, impressions: 40, position: 3 },
          ...dateRows(),
          { keys: ["2026-08-22"], clicks: 2, impressions: 20, position: 4 },
        ],
      });
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    const attachments = calls.filter((call) => !["date", "hour"].includes(call.dimensions[0] ?? ""));
    expect(attachments).toHaveLength(10);
    expect(attachments.every((call) =>
      (call.startDate === "2026-08-17" && call.endDate === "2026-08-23") ||
      (call.startDate === "2026-08-10" && call.endDate === "2026-08-16")
    )).toBe(true);
    expect(envelope.result.windows?.latestDay.endDate).toBe("2026-08-23");
    expect(envelope.result.day.current).toMatchObject({ clicks: 7, impressions: 40 });
  });

  it.each([
    { latest: "2026-08-22", start: "2026-05-25" },
    { latest: "2026-08-21", start: "2026-05-24" },
  ])("backfills only the missing prefix for a 90-day trend ending $latest", async ({ latest, start }) => {
    const calls: GscQueryRequest[] = [];
    const observations = Array.from({ length: 90 }, (_, index) => ({
      keys: [shiftDate(start, index)],
      clicks: index + 1,
      impressions: (index + 1) * 10,
      position: 8,
    }));
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return responseFor(request, { dates: observations.filter((row) =>
        row.keys[0]! >= request.startDate && row.keys[0]! <= request.endDate) });
    };

    const envelope = await runDailyBriefing({
      client, now: NOW, brandTerms: [], brandTermsConfirmed: true,
    });

    expect(calls.filter((call) => call.dimensions[0] === "date")).toEqual([
      expect.objectContaining({ startDate: "2026-05-27", endDate: "2026-08-24" }),
      {
        dimensions: ["date"], startDate: start, endDate: "2026-05-26",
        rowLimit: GSC_ROW_LIMIT, startRow: 0, dataState: "all", aggregationType: "byProperty",
      },
    ]);
    expect(envelope.result.windows?.latestDay.endDate).toBe(latest);
    expect(envelope.result.trend.daily.evidence).toBe("observed");
    expect(envelope.result.trend.daily.points).toHaveLength(90);
    expect(envelope.result.trend.daily.points[0]?.key).toBe(start);
    expect(envelope.result.trend.daily.points.at(-1)?.key).toBe(latest);
    expect(envelope.result.trend.daily.points.reduce((sum, row) => sum + row.clicks, 0)).toBe(4_095);
    expect(envelope.result.trend.daily.points.reduce((sum, row) => sum + row.impressions, 0)).toBe(40_950);
  });

  it("does not backfill when the initial read already ends on the latest observed date", async () => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return responseFor(request, { dates: [
        ...dateRows(), { keys: ["2026-08-24"], clicks: 3, impressions: 30, position: 8 },
      ] });
    };

    await runDailyBriefing({ client, now: NOW, brandTerms: [], brandTermsConfirmed: true });

    expect(calls.filter((call) => call.dimensions[0] === "date")).toHaveLength(1);
    expect(calls).toHaveLength(12);
  });

  it.each(["failure", "byPage", null])("withholds the daily trend when its required prefix is unreadable: %s", async (failure) => {
    const client: GscQueryClient = async (request) => {
      if (request.dimensions[0] === "date" && request.endDate === "2026-05-26") {
        if (failure === "failure") throw new Error("prefix unavailable");
        return { ...responseFor(request), responseAggregationType: failure };
      }
      return responseFor(request);
    };

    const envelope = await runDailyBriefing({
      client, now: NOW, brandTerms: [], brandTermsConfirmed: true,
    });

    expect(envelope.result.trend.daily.evidence).toBe("unavailable");
    expect(envelope.result.trend.daily.points).toEqual([]);
    expect(envelope.result.trend.hourly.evidence).toBe("partial");
    expect(envelope.result.weekly.evidence).toBe("observed");
    expect(envelope.result.weekly.current?.clicks).toBe(70);
  });

  it("never lets out-of-range prefix rows change the frozen analysis or latest available date", async () => {
    const client: GscQueryClient = async (request) => responseFor(request,
      request.dimensions[0] === "date" && request.endDate === "2026-05-26"
        ? { dates: [{ keys: ["2026-08-24"], clicks: 999, impressions: 999, position: 1 }] }
        : {});

    const envelope = await runDailyBriefing({
      client, now: NOW, brandTerms: [], brandTermsConfirmed: true,
    });

    expect(envelope.result.windows?.latestDay.endDate).toBe("2026-08-21");
    expect(envelope.result.freshness.latestAvailableDate).toBe("2026-08-21");
    expect(envelope.result.trend.daily.evidence).toBe("unavailable");
    expect(envelope.result.weekly.current?.clicks).toBe(70);
  });

  it.each(["2026-05-25", "invalid-boundary"])("preserves an earlier or invalid prefix completeness boundary: %s", async (boundary) => {
    const client: GscQueryClient = async (request) => ({
      ...responseFor(request),
      ...(request.dimensions[0] === "date" ? { metadata: {
        firstIncompleteDate: request.endDate === "2026-05-26" ? boundary : "2026-08-21",
        firstIncompleteHour: null,
      } } : {}),
    });

    const envelope = await runDailyBriefing({
      client, now: NOW, brandTerms: [], brandTermsConfirmed: true,
    });

    expect(envelope.result.trend.daily.firstIncompleteDate).toBe(boundary);
    expect(envelope.result.trend.daily.evidence).toBe("partial");
    expect(envelope.result.freshness.firstIncompleteDate).toBe(boundary);
    expect(envelope.result.freshness.comparisonEligible).toBe(false);
  });

  it.each([
    { keys: ["2026-08-25"], clicks: 1, impressions: 10, position: 3 },
    { keys: ["2026-02-30"], clicks: 1, impressions: 10, position: 3 },
    { keys: ["2026-08-24"], clicks: -1, impressions: 10, position: 3 },
    { keys: ["2026-08-24"], clicks: 11, impressions: 10, position: 3 },
    { keys: ["2026-08-24"], clicks: Number.NaN, impressions: 10, position: 3 },
    { keys: ["2026-08-24"], clicks: 1, impressions: Number.POSITIVE_INFINITY, position: 3 },
    { keys: ["2026-08-24"], clicks: 1, impressions: -1, position: 3 },
    { keys: ["2026-08-24"], clicks: 1, impressions: 10, position: Number.NaN },
    { keys: ["2026-08-24"], clicks: 1, impressions: 10, position: -1 },
  ])("does not let an invalid or future row select the analysis window: %j", async (invalid) => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return responseFor(request, { dates: [...dateRows(), invalid] });
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    const queries = calls.filter((call) => call.dimensions[0] === "query");
    expect(queries.every((call) => ["2026-08-21", "2026-08-14"].includes(call.endDate))).toBe(true);
    expect(envelope.result.windows?.latestDay.endDate).toBe("2026-08-21");
  });

  it("does not invent an analysis window or issue attachments when no valid dates are available", async () => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return responseFor(request, { dates: [] });
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(calls.map((call) => call.dimensions)).toEqual([["date"], ["hour"]]);
    expect(envelope.result.windows).toBeNull();
    expect(envelope.result.day.evidence).toBe("unavailable");
    expect(envelope.result.weekly.evidence).toBe("unavailable");
    expect(envelope.result.actions).toEqual([]);
    expect(envelope.result.pageActions).toEqual([]);
    expect(envelope.result.trend.hourly.evidence).toBe("partial");
  });

  it("carries the initial read's incomplete boundary into analysis and the daily trend", async () => {
    const client: GscQueryClient = async (request) => ({
      ...responseFor(request),
      ...(request.dimensions[0] === "date" ? {
        metadata: { firstIncompleteDate: "2026-08-21", firstIncompleteHour: null },
      } : {}),
    });

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(envelope.result.trend.daily.firstIncompleteDate).toBe("2026-08-21");
    expect(envelope.result.trend.daily.evidence).toBe("partial");
    expect(envelope.result.limitations).toContain("daily_data_incomplete");
    expect(envelope.result.pageActions).toEqual([]);
    expect(envelope.result.actions).toEqual([]);
  });

  it("uses the separate page-aggregated query totals for page coverage", async () => {
    const client: GscQueryClient = async (request) => responseFor(request, {
      queries: request.aggregationType === "byProperty"
        ? queryRows().map((row) => ({ ...row, impressions: 50 }))
        : queryRows(),
    });

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(envelope.result.coverage.current.evidence).toBe("observed");
    expect(envelope.result.coverage.previous.evidence).toBe("observed");
    expect(envelope.result.limitations).not.toContain("aggregation_basis_mismatch");
  });

  it("rejects when the required date read fails and does not start attachments", async () => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      throw new Error("date unavailable");
    };

    await expect(
      runDailyBriefing({
        client,
        now: NOW,
        brandTerms: [],
        brandTermsConfirmed: true,
      }),
    ).rejects.toThrow("date unavailable");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.dimensions).toEqual(["date"]);
  });

  it.each(["byPage", null])("rejects a required date response with incompatible or unknown aggregation: %s", async (responseAggregationType) => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return { ...responseFor(request), responseAggregationType };
    };

    await expect(runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    })).rejects.toMatchObject({ name: "SourceError", code: "UNAVAILABLE" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.dimensions).toEqual(["date"]);
    expect(verifyDailyBriefing).not.toHaveBeenCalled();
  });

  it("soft-fails any optional attachment while preserving the KPI envelope", async () => {
    const client: GscQueryClient = async (request) => {
      if (
        request.dimensions.length === 2 &&
        request.startDate === "2026-08-15"
      ) {
        throw new Error("query-page unavailable");
      }
      return responseFor(request);
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(envelope.result.weekly.evidence).toBe("observed");
    expect(envelope.result.weekly.current?.clicks).toBe(70);
    expect(envelope.result.changes).toEqual([]);
    expect(envelope.result.coverage.current.evidence).toBe("unavailable");
    // Each attachment soft-fails on its own, so a lost page read
    // costs page attribution and the handoff, not the query lanes.
    expect(envelope.result.limitations).toContain(
      "query_page_coverage_below_floor",
    );
  });

  it("keeps daily analysis when the independently optional hourly read fails", async () => {
    const client: GscQueryClient = async (request) => {
      if (request.dimensions[0] === "hour") {
        throw new Error("hourly trend unavailable");
      }
      return responseFor(request);
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(envelope.result.weekly.evidence).toBe("observed");
    expect(envelope.result.trend.daily.evidence).toBe("observed");
    expect(envelope.result.trend.daily.points).toHaveLength(DATES.length);
    expect(envelope.result.trend.hourly).toEqual({
        evidence: "unavailable",
        points: [],
        firstIncompleteDate: null,
        firstIncompleteHour: null,
    });
  });

  it.each(["byPage", null])("omits hourly data with incompatible or unknown aggregation while keeping daily analysis: %s", async (responseAggregationType) => {
    const client: GscQueryClient = async (request) => ({
      ...responseFor(request),
      ...(request.dimensions[0] === "hour" ? { responseAggregationType } : {}),
    });

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(envelope.result.weekly.evidence).toBe("observed");
    expect(envelope.result.weekly.current?.clicks).toBe(70);
    expect(envelope.result.trend.daily.evidence).toBe("observed");
    expect(envelope.result.trend.hourly).toEqual({
      evidence: "unavailable",
      points: [],
      firstIncompleteDate: null,
      firstIncompleteHour: null,
    });
  });

  it("keeps query evidence when only the query-page reads fail", async () => {
    const client: GscQueryClient = async (request) => {
      if (request.dimensions.length === 2) {
        throw new Error("query-page read failed");
      }
      return responseFor(request);
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(envelope.result.weekly.evidence).toBe("observed");
    expect(envelope.result.coverage.current.evidence).toBe("unavailable");
    expect(envelope.result.laneCapability.evidence).toBe("observed");
    expect(envelope.result.limitations).not.toContain(
      "query_evidence_unavailable",
    );
    expect(envelope.result.limitations).toContain(
      "query_page_coverage_below_floor",
    );
  });

  it("does not cancel delayed query evidence when only property totals fail", async () => {
    const calls: GscQueryRequest[] = [];
    let releaseQueryReads = (): void => undefined;
    const queryReadsReleased = new Promise<void>((resolve) => {
      releaseQueryReads = resolve;
    });
    const opportunityRows: readonly GscRawRow[] = [
      { keys: ["pricing automation"], clicks: 0, impressions: 1_000, position: 9 },
      // Four hundred each, so the position band holds the two thousand
      // impressions the CTR anomaly lane requires once the measured row is
      // taken out. The 10% rate is unchanged.
      ...Array.from({ length: 5 }, (_, index) => ({
        keys: [`baseline ${index}`],
        clicks: 40,
        impressions: 400,
        position: 9,
      })),
    ];
    const opportunityPages: readonly GscRawRow[] = [
      {
        keys: ["pricing automation", "https://example.com/pricing"],
        clicks: 0,
        impressions: 1_000,
        position: 9,
      },
    ];
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      if (request.dimensions[0] === "date") return responseFor(request);
      if (request.dimensions.length === 0) {
        if (request.startDate === "2026-08-15") {
          throw new Error("current totals unavailable");
        }
        return {
          rows: [{ keys: [], clicks: 50, impressions: 1_500, position: 9 }],
          responseAggregationType: "byPage",
        };
      }
      await queryReadsReleased;
      return {
        rows:
          request.dimensions.length === 2
            ? opportunityPages
            : opportunityRows,
        responseAggregationType: request.aggregationType === "byProperty" ? "byProperty" : "byPage",
      };
    };

    const pending = runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    await vi.waitFor(() => expect(calls).toHaveLength(13));
    releaseQueryReads();
    const envelope = await pending;

    expect(envelope.result.changes[0]).toMatchObject({
      kind: "click_opportunity",
      query: "pricing automation",
      metricScope: "query",
      page: null,
    });
    expect(envelope.result.actions).toEqual([]);
    expect(envelope.result.anonymization.current.evidence).toBe("unavailable");
    expect(envelope.result.limitations).toContain("property_totals_unavailable");
    expect(envelope.result.limitations).not.toContain("query_evidence_unavailable");
  });

  it("bounds full query and query-page reads to one page even after budget expiry", async () => {
    const calls: GscQueryRequest[] = [];
    const fullQueries = Array.from({ length: GSC_ROW_LIMIT }, (_, index) => ({
      keys: [`query ${index}`],
      clicks: 1,
      impressions: 100,
      position: 9,
    }));
    const fullQueryPages = Array.from({ length: GSC_ROW_LIMIT }, (_, index) => ({
      keys: [`query ${index}`, `https://example.com/${index}`],
      clicks: 1,
      impressions: 100,
      position: 9,
    }));
    const client: GscQueryClient = async (request) => {
      calls.push(request);
      return responseFor(request, {
        queries: request.startDate === "2026-08-15" ? fullQueries : queryRows(),
        queryPages:
          request.startDate === "2026-08-15" ? fullQueryPages : queryPageRows(),
      });
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
      budget: { isExpired: () => true },
    });

    expect(
      calls.filter(
        (call) =>
          call.startDate === "2026-08-15" &&
          (call.dimensions[0] === "query" || call.dimensions.length === 2),
      ),
    ).toHaveLength(3);
    expect(calls.some((call) => call.startRow === GSC_ROW_LIMIT)).toBe(false);
    expect(envelope.result.rowAccounting.byLane).toBeNull();
    expect(envelope.result.limitations).toContain("query_evidence_partial");
  });

  it("omits malformed date keys without turning them into zero days", async () => {
    const client: GscQueryClient = async (request) => {
      if (request.dimensions[0] === "date") {
        return responseFor(request, {
          dates: [
            ...dateRows(),
            { keys: [], clicks: 999, impressions: 999, position: 1 },
            { keys: ["2026-99-99"], clicks: 999, impressions: 999, position: 1 },
          ],
        });
      }
      return responseFor(request);
    };

    const envelope = await runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    expect(envelope.result.weekly.current).toMatchObject({
      clicks: 70,
      impressions: 1_400,
    });
    expect(envelope.result.weekly.evidence).toBe("observed");
  });
});
