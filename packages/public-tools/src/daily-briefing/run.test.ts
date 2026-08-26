import { describe, expect, it, vi } from "vitest";

import { GSC_ROW_LIMIT } from "../gsc-analytics/reader.ts";
import type {
  GscQueryClient,
  GscQueryRequest,
  GscQueryResponse,
  GscRawRow,
} from "../gsc-analytics/types.ts";
import { runDailyBriefing } from "./run.ts";

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
 * result used for both — every one of which still issues nine calls.
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
      rows: rows.dates ?? dateRows(),
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
    responseAggregationType: "byPage",
  };
}

describe("runDailyBriefing read plan", () => {
  it("keeps the final 14-day read strict and adds daily and hourly trend reads", async () => {
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

    // One finalised 14-day report read still drives the action logic. The two
    // trend reads are additive UI evidence: fresh daily data for 7/28/90 days
    // and a separate provisional hour series for the default 24h chart.
    expect(calls).toHaveLength(11);
    expect(calls.filter((call) => call.dimensions[0] === "date")).toEqual([
      {
        dimensions: ["date"],
        startDate: "2026-08-08",
        endDate: "2026-08-21",
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
      },
      {
        dimensions: ["date"],
        startDate: "2026-05-27",
        endDate: "2026-08-24",
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
        dataState: "all",
      },
    ]);
    expect(
      calls.find((call) => String(call.dimensions[0]) === "hour"),
    ).toEqual({
      dimensions: ["hour"],
      startDate: "2026-08-23",
      endDate: "2026-08-24",
      rowLimit: GSC_ROW_LIMIT,
      startRow: 0,
      dataState: "hourly_all",
    });
    expect(envelope.result.trend).toMatchObject({
      daily: { evidence: "observed" },
      hourly: { evidence: "partial" },
    });
    expect(calls.filter((call) => call.dimensions.length === 1 && call.dimensions[0] === "query")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startDate: "2026-08-15",
          endDate: "2026-08-21",
          rowLimit: GSC_ROW_LIMIT,
          startRow: 0,
          aggregationType: "byPage",
        }),
        expect.objectContaining({
          startDate: "2026-08-08",
          endDate: "2026-08-14",
          rowLimit: GSC_ROW_LIMIT,
          startRow: 0,
          aggregationType: "byPage",
        }),
      ]),
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
      },
      {
        dimensions: ["page"],
        startDate: "2026-08-08",
        endDate: "2026-08-14",
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
        aggregationType: "byPage",
      },
    ]);
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
      if (
        request.dimensions[0] === "date" &&
        request.dataState === undefined
      ) {
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

    await vi.waitFor(() => expect(optionalStarted).toHaveLength(10));
    release();
    await expect(pending).resolves.toBeDefined();
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
    // Each of the six attachments soft-fails on its own, so a lost page read
    // costs page attribution and the handoff, not the query lanes.
    expect(envelope.result.limitations).toContain(
      "query_page_coverage_below_floor",
    );
  });

  it("keeps final action evidence when both fresh trend reads are unavailable", async () => {
    const client: GscQueryClient = async (request) => {
      if (request.dataState !== undefined) {
        throw new Error("fresh trend unavailable");
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
    expect(envelope.result.trend).toEqual({
      daily: {
        evidence: "unavailable",
        points: [],
        firstIncompleteDate: null,
        firstIncompleteHour: null,
      },
      hourly: {
        evidence: "unavailable",
        points: [],
        firstIncompleteDate: null,
        firstIncompleteHour: null,
      },
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
      ...Array.from({ length: 5 }, (_, index) => ({
        keys: [`baseline ${index}`],
        clicks: 10,
        impressions: 100,
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
        responseAggregationType: "byPage",
      };
    };

    const pending = runDailyBriefing({
      client,
      now: NOW,
      brandTerms: [],
      brandTermsConfirmed: true,
    });

    await vi.waitFor(() => expect(calls).toHaveLength(11));
    releaseQueryReads();
    const envelope = await pending;

    expect(envelope.result.actions[0]).toMatchObject({
      kind: "click_opportunity",
      query: "pricing automation",
      page: "https://example.com/pricing",
    });
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
    ).toHaveLength(2);
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
