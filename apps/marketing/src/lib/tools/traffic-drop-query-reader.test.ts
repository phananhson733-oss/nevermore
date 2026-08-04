import { describe, expect, it, vi } from "vitest";

import {
  comparisonWindows,
  createTrafficDropQueryReader,
  QUERY_READ_CALL_BUDGET,
  QUERY_READ_MAX_PAGES,
  QUERY_WINDOW_DAYS,
} from "./traffic-drop-query-reader.ts";
import { GSC_MAX_PAGES, type TrafficChangePoint } from "@sf/public-tools";

function changePoint(peakEnd: string): TrafficChangePoint {
  return {
    state: "sustained_decline",
    windows: [
      {
        id: "peak",
        startDate: "2026-05-01",
        endDate: peakEnd,
        clicks: 400,
        impressions: 9_000,
        ctr: 0.044,
      },
      {
        id: "mid",
        startDate: "2026-05-08",
        endDate: "2026-05-14",
        clicks: 90,
        impressions: 8_000,
        ctr: 0.011,
      },
    ],
    limitation: null,
  };
}

/** 2026-08-01 05:00 Pacific, so the last finalised day is 2026-07-29. */
const NOW = new Date("2026-08-01T12:00:00.000Z");

describe("comparisonWindows", () => {
  it("ends the later window on the last FINALISED day, not on the series end", () => {
    // The bug this pins: the daily series is read with `dataState: all` so a
    // visitor can see the days they came about, which runs two to three days
    // past finalisation. These query reads use `final`. Anchoring on the
    // series end asked for 28 days and got about 25, biasing every ratio down
    // and — worse — lowering the later window's coverage specifically, which
    // is the exact asymmetry the coverage-shift gate exists to catch.
    const windows = comparisonWindows(changePoint("2026-05-07"), NOW);

    expect(windows).toEqual({
      before: { startDate: "2026-04-10", endDate: "2026-05-07" },
      after: { startDate: "2026-07-02", endDate: "2026-07-29" },
    });
  });

  it("cuts the later window on Pacific days, not on the server's zone", () => {
    // 2026-08-01T02:00Z is still 2026-07-31 in Los Angeles. A window cut on
    // UTC days lands a day late for roughly a third of every UTC day, which
    // moves whichever rows sit on the boundary in both windows.
    const windows = comparisonWindows(
      changePoint("2026-05-07"),
      new Date("2026-08-01T02:00:00.000Z"),
    );

    expect(windows?.after.endDate).toBe("2026-07-28");
  });

  it("refuses to compare windows that overlap", () => {
    // An event too recent to have a clear 28 days after it produces windows
    // sharing days. A "before versus after" built from overlapping spans
    // measures some of the same traffic twice, which shrinks every difference
    // toward zero and reports the site as steadier than it is.
    expect(comparisonWindows(changePoint("2026-07-20"), NOW)).toBeNull();
  });

  it("has nothing to compare when no peak was found", () => {
    expect(
      comparisonWindows(
        { state: "no_material_decline", windows: [], limitation: null },
        NOW,
      ),
    ).toBeNull();
  });

  it("keeps the two windows the same length", () => {
    const windows = comparisonWindows(changePoint("2026-05-07"), NOW);
    const span = (range: { startDate: string; endDate: string }) =>
      (Date.parse(`${range.endDate}T00:00:00Z`) -
        Date.parse(`${range.startDate}T00:00:00Z`)) /
        86_400_000 +
      1;

    expect(span(windows!.before)).toBe(QUERY_WINDOW_DAYS);
    expect(span(windows!.after)).toBe(QUERY_WINDOW_DAYS);
  });
});

describe("createTrafficDropQueryReader", () => {
  it("issues exactly the four logical reads when nothing pages", async () => {
    // Asserted as equality, not a ceiling. The previous version of this test
    // used `<=` against a budget of 4 with empty single-page responses, which
    // is satisfied by any implementation that reads at most four times — it
    // would not have noticed a fifth read, and it proved nothing at all about
    // paging or retries.
    const fetchImpl = vi.fn(async () =>
      Response.json({ rows: [], responseAggregationType: "byProperty" }),
    );
    const reader = createTrafficDropQueryReader({
      accessToken: "test-token",
      remainingMs: () => 20_000,
      fetchImpl,
    });

    await reader({
      property: "sc-domain:example.com",
      changePoint: changePoint("2026-05-07"),
      now: NOW,
    });

    expect(fetchImpl.mock.calls.length).toBe(4);
  });

  it("states a ceiling that accounts for paging and retries", () => {
    // Search Console quota is counted per GCP project, not per visitor, so the
    // number that matters is the worst case, not the happy path. Two windows,
    // each up to QUERY_READ_MAX_PAGES row pages plus one totals call, and every
    // attempt may retry once.
    expect(QUERY_READ_CALL_BUDGET).toBe(2 * (QUERY_READ_MAX_PAGES + 1) * 2);
    // Tighter than the row reader's own cap, which was sized for a caller that
    // reads a single window.
    expect(QUERY_READ_MAX_PAGES).toBeLessThan(GSC_MAX_PAGES);
  });

  it("cancels the reads still in flight when one of them fails", async () => {
    // `Promise.all` rejects on the first failure and leaves the rest running.
    // Without the shared AbortController those calls outlive the response and
    // the gate release, so the per-visitor concurrency limit stops limiting
    // concurrency and the quota is spent after the visitor already has their
    // answer.
    const signals: AbortSignal[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      calls += 1;
      if (init?.signal) signals.push(init.signal);
      if (calls === 1) throw new Error("malformed response");
      // The rest hang until aborted.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    });

    const reader = createTrafficDropQueryReader({
      accessToken: "test-token",
      remainingMs: () => 20_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      reader({
        property: "sc-domain:example.com",
        changePoint: changePoint("2026-05-07"),
        now: NOW,
      }),
    ).resolves.toBeNull();

    // The first call's own abort scope is disposed when its attempt throws, so
    // it unsubscribes from the parent and never flips. The ones that matter
    // are the reads still waiting on the network.
    expect(signals.length).toBeGreaterThan(1);
    expect(signals.slice(1).every((signal) => signal.aborted)).toBe(true);
  });

  it("spends nothing at all when there is no window pair", async () => {
    const fetchImpl = vi.fn();
    const reader = createTrafficDropQueryReader({
      accessToken: "test-token",
      remainingMs: () => 20_000,
      fetchImpl,
    });

    const result = await reader({
      property: "sc-domain:example.com",
      changePoint: {
        state: "no_material_decline",
        windows: [],
        limitation: null,
      },
      now: NOW,
    });

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves null rather than throwing, so the report survives", async () => {
    const reader = createTrafficDropQueryReader({
      accessToken: "test-token",
      remainingMs: () => 20_000,
      fetchImpl: () => Promise.reject(new Error("429 rate limited")),
    });

    await expect(
      reader({
        property: "sc-domain:example.com",
        changePoint: changePoint("2026-05-07"),
        now: NOW,
      }),
    ).resolves.toBeNull();
  });
});
