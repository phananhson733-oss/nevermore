import { describe, expect, it } from "vitest";
import type { GscQueryClient, GscQueryRequest } from "../gsc-analytics/types.ts";
import { buildDailyBriefing } from "./report.ts";
import type { DailyBriefingChange, DailyBriefingEnvelope } from "./types.ts";
import { verifyDailyBriefing } from "./verification.ts";

const NOW = new Date("2026-08-31T06:00:00Z");
const QUERY = "a query + & тест";
const PAGE = "https://example.com/detail/1?lang=bg&v=2";
const CURRENT = { query: QUERY, clicks: 261, impressions: 1617, position: 4 };

function pairChange(): DailyBriefingChange {
  return {
    kind: "first_observed_leading", evidence: "not_observed",
    metricScope: "query_page", query: QUERY, page: PAGE, pageEvidence: "observed",
    current: CURRENT, previous: null, clickChange: null, clickChangeRatio: null,
    positionDelta: null, baselineCtr: null, clickGap: null,
  };
}

function fixture(change = pairChange()): DailyBriefingEnvelope {
  const base = buildDailyBriefing({ now: NOW, dateRows: [], brandTerms: [], brandTermsConfirmed: true });
  return {
    ...base,
    result: {
      ...base.result,
      freshness: { ...base.result.freshness, status: "complete", comparisonEligible: true, latestAvailableDate: "2026-08-27", firstIncompleteDate: null, missingDates: [] },
      windows: {
        latestDay: { startDate: "2026-08-27", endDate: "2026-08-27" },
        previousDay: { startDate: "2026-08-26", endDate: "2026-08-26" },
        current7Days: { startDate: "2026-08-21", endDate: "2026-08-27" },
        previous7Days: { startDate: "2026-08-14", endDate: "2026-08-20" },
        readRange: { startDate: "2026-08-14", endDate: "2026-08-27" },
      },
      changes: [change],
      actions: change.page === null ? [] : [{ kind: change.kind, query: QUERY, page: PAGE, destination: "on-page-seo-check" }],
      pageChanges: [], pageActions: [],
      propertyTrend: { change: null, action: null, noiseFloor: null },
      queryWatchlist: { ...base.result.queryWatchlist, items: [] },
      provisionalMoves: { ...base.result.provisionalMoves, items: [] },
      pageChecks: { ...base.result.pageChecks, items: [] },
      suggestedChecks: { ...base.result.suggestedChecks, items: [] },
    },
  };
}

const clock = { now: () => NOW };

describe("Daily Briefing exact GSC evidence recheck", () => {
  it("retains an exact-pair finding only after same-window exact filters reproduce its metrics and prior absence", async () => {
    const calls: GscQueryRequest[] = [];
    const client: GscQueryClient = async request => {
      calls.push(request);
      return { rows: request.startDate === "2026-08-21" ? [{ keys: [], ...CURRENT }] : [], responseAggregationType: "byPage" };
    };
    const output = await verifyDailyBriefing(fixture(), client, clock);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ dimensions: [], dataState: "all", aggregationType: "byPage", startDate: "2026-08-21", endDate: "2026-08-27", filters: [{ dimension: "query", expression: QUERY }, { dimension: "page", expression: PAGE }] });
    expect(output.result.changes).toHaveLength(1);
    expect(output.result.actions).toHaveLength(1);
    expect(output.result.verification).toMatchObject({ source: "google_search_console_api", websiteChecked: false, verifiedCount: 1, withheldCount: 0, checkedAt: NOW.toISOString() });
    expect(output.result.verification?.items[0]).toMatchObject({ status: "verified", metricScope: "query_page", aggregationType: "byPage", current: { clicks: 261, impressions: 1617, position: 4 }, previous: null });
  });

  it("withdraws the whole finding and action on a different position, never patches a number under an old conclusion", async () => {
    const original = fixture();
    const client: GscQueryClient = async request => ({ rows: request.startDate === "2026-08-21" ? [{ keys: [], ...CURRENT, position: 1.9 }] : [], responseAggregationType: "byPage" });
    const output = await verifyDailyBriefing(original, client, clock);
    expect(output.result.changes).toEqual([]);
    expect(output.result.actions).toEqual([]);
    expect(original.result.changes[0]?.current.position).toBe(4);
    expect(output.result.verification?.items[0]).toMatchObject({ status: "mismatch", current: { position: 1.9 } });
    expect(output.result.verification?.withheldCount).toBe(1);
  });

  it("queries a query-wide observation by property without inventing a page filter", async () => {
    const calls: GscQueryRequest[] = [];
    const change: DailyBriefingChange = { ...pairChange(), metricScope: "query", page: null, pageEvidence: "unavailable", kind: "stable_position_click_decline", current: { ...CURRENT, position: 2 }, previous: { ...CURRENT, clicks: 400, position: 2 }, clickChange: -139, clickChangeRatio: -139 / 400, positionDelta: 0 };
    const client: GscQueryClient = async request => {
      calls.push(request);
      return { rows: [{ keys: [], ...(request.startDate === "2026-08-21" ? change.current : change.previous!) }], responseAggregationType: "byProperty" };
    };
    const output = await verifyDailyBriefing(fixture(change), client, clock);
    expect(output.result.changes).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls.every(request => request.aggregationType === "byProperty" && request.filters?.length === 1 && request.filters[0]?.dimension === "query")).toBe(true);
    expect(output.result.actions).toEqual([]);
  });

  it("does not treat an empty current response as an observed zero", async () => {
    const output = await verifyDailyBriefing(fixture(), async () => ({ rows: [], responseAggregationType: "byPage" }), clock);
    expect(output.result.actions).toEqual([]);
    expect(output.result.verification?.items[0]).toMatchObject({ status: "mismatch", current: null });
  });

  it("rejects a first-observed claim when the exact prior read finds the pair", async () => {
    const output = await verifyDailyBriefing(fixture(), async () => ({ rows: [{ keys: [], ...CURRENT }], responseAggregationType: "byPage" }), clock);
    expect(output.result.changes).toEqual([]);
    expect(output.result.verification?.items[0]?.status).toBe("mismatch");
  });

  it.each(["wrong basis", "failure", "multiple rows", "invalid metrics"])("fails closed for %s", async failure => {
    const output = await verifyDailyBriefing(fixture(), async () => {
      if (failure === "failure") throw new Error("provider unavailable");
      return { rows: failure === "multiple rows" ? [{ keys: [], ...CURRENT }, { keys: [], ...CURRENT }] : [{ keys: [], ...CURRENT, ...(failure === "invalid metrics" ? { clicks: Number.NaN } : {}) }], responseAggregationType: failure === "wrong basis" ? "byProperty" : "byPage" };
    }, clock);
    expect(output.result.changes).toEqual([]);
    expect(output.result.actions).toEqual([]);
    expect(output.result.verification?.items[0]?.status).toBe("unavailable");
  });

  it("spends no provider calls after the shared budget expires", async () => {
    let calls = 0;
    const output = await verifyDailyBriefing(fixture(), async () => { calls += 1; throw new Error("must not call"); }, { ...clock, budget: { isExpired: () => true } });
    expect(calls).toBe(0);
    expect(output.result.actions).toEqual([]);
    expect(output.result.verification?.items[0]?.status).toBe("unavailable");
  });

  it("does not recheck a guessed window when no date was returned", async () => {
    let calls = 0;
    const input = fixture();
    const output = await verifyDailyBriefing({ ...input, result: { ...input.result, windows: null } }, async () => { calls += 1; throw new Error("must not call"); }, clock);
    expect(calls).toBe(0);
    expect(output.result.changes).toEqual([]);
    expect(output.result.actions).toEqual([]);
  });

  it("rejects dimensioned rows from an undimensioned exact-total request", async () => {
    const output = await verifyDailyBriefing(fixture(), async request => ({ rows: request.startDate === "2026-08-21" ? [{ keys: ["another query"], ...CURRENT }] : [], responseAggregationType: "byPage" }), clock);
    expect(output.result.changes).toEqual([]);
    expect(output.result.verification?.items[0]?.status).toBe("unavailable");
  });

  it("withdraws comparisons when the exact reread announces unfinished data", async () => {
    const output = await verifyDailyBriefing(fixture(), async request => ({ rows: request.startDate === "2026-08-21" ? [{ keys: [], ...CURRENT }] : [], responseAggregationType: "byPage", metadata: { firstIncompleteDate: "2026-08-26", firstIncompleteHour: null } }), clock);
    expect(output.result.changes).toEqual([]);
    expect(output.result.verification?.items[0]?.status).toBe("unavailable");
  });

  it("does not allow exact-number agreement to override an incomplete comparison window", async () => {
    const input = fixture();
    const output = await verifyDailyBriefing({ ...input, result: { ...input.result, freshness: { ...input.result.freshness, status: "partial", comparisonEligible: false } } }, async request => ({ rows: request.startDate === "2026-08-21" ? [{ keys: [], ...CURRENT }] : [], responseAggregationType: "byPage" }), clock);
    expect(output.result.changes).toEqual([]);
    expect(output.result.actions).toEqual([]);
  });

  it("rechecks the prior impression count even when a watchlist row was below the comparison floor", async () => {
    const input = fixture();
    const observed = { kind: "sample_floor_reached" as const, band: "page_one" as const, metricScope: "query" as const, query: QUERY, page: null, pageEvidence: "unavailable" as const, current: CURRENT, previous: null, previousEvidence: "below_floor" as const, previousBelowFloor: 70, positionDelta: null };
    const calls: GscQueryRequest[] = [];
    const output = await verifyDailyBriefing({ ...input, result: { ...input.result, changes: [], actions: [], queryWatchlist: { ...input.result.queryWatchlist, items: [observed] } } }, async request => {
      calls.push(request);
      return { rows: [{ keys: [], ...(request.startDate === "2026-08-21" ? CURRENT : { clicks: 1, impressions: 90, position: 4 }) }], responseAggregationType: "byProperty" };
    }, clock);
    expect(calls).toHaveLength(2);
    expect(output.result.queryWatchlist.items).toEqual([]);
    expect(output.result.verification?.items[0]?.status).toBe("mismatch");
  });

  it("never retains a query-wide measurement as a concrete-page optimization action", async () => {
    const change = { ...pairChange(), kind: "stable_position_click_decline" as const, metricScope: "query" as const, previous: { ...CURRENT, clicks: 400 } };
    const output = await verifyDailyBriefing(fixture(change), async request => ({ rows: [{ keys: [], ...(request.startDate === "2026-08-21" ? CURRENT : change.previous) }], responseAggregationType: "byProperty" }), clock);
    expect(output.result.changes[0]?.page).toBeNull();
    expect(output.result.changes[0]?.pageEvidence).toBe("unavailable");
    expect(output.result.actions).toEqual([]);
  });

  it("checks claimed prior absence for a current observation instead of declaring only its current numbers verified", async () => {
    const input = fixture();
    const observed = { kind: "sample_floor_reached" as const, band: "page_one" as const, metricScope: "query" as const, query: QUERY, page: null, pageEvidence: "unavailable" as const, current: CURRENT, previous: null, previousEvidence: "not_observed" as const, previousBelowFloor: null, positionDelta: null };
    const calls: GscQueryRequest[] = [];
    const output = await verifyDailyBriefing({ ...input, result: { ...input.result, changes: [], actions: [], queryWatchlist: { ...input.result.queryWatchlist, items: [observed] } } }, async request => {
      calls.push(request);
      return { rows: [{ keys: [], ...CURRENT }], responseAggregationType: "byProperty" };
    }, clock);
    expect(calls).toHaveLength(2);
    expect(output.result.queryWatchlist.items).toEqual([]);
  });

  it("never silently broadens an invalid pair subject into a query-total verification", async () => {
    const input = fixture({ ...pairChange(), page: null, pageEvidence: "unavailable" });
    const output = await verifyDailyBriefing(input, async request => ({ rows: request.startDate === "2026-08-21" ? [{ keys: [], ...CURRENT }] : [], responseAggregationType: "byPage" }), clock);
    expect(output.result.changes).toEqual([]);
    expect(output.result.verification?.items[0]?.status).toBe("unavailable");
  });
});
