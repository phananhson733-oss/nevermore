import { describe, expect, it, vi } from "vitest";

import {
  comparisonWindows,
  createTrafficDropQueryReader,
  QUERY_READ_CALL_BUDGET,
  QUERY_WINDOW_DAYS,
} from "./traffic-drop-query-reader.ts";
import type { TrafficChangePoint } from "@sf/public-tools";

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

describe("comparisonWindows", () => {
  it("builds two equal windows, the later one ending at the series end", () => {
    const windows = comparisonWindows(changePoint("2026-05-07"), "2026-07-29");

    expect(windows).toEqual({
      before: { startDate: "2026-04-10", endDate: "2026-05-07" },
      after: { startDate: "2026-07-02", endDate: "2026-07-29" },
    });
  });

  it("refuses to compare windows that overlap", () => {
    // An event too recent to have a clear 28 days after it produces windows
    // sharing days. A "before versus after" built from overlapping spans
    // measures some of the same traffic twice, which shrinks every difference
    // toward zero and reports the site as steadier than it is.
    expect(comparisonWindows(changePoint("2026-07-20"), "2026-07-29")).toBeNull();
  });

  it("has nothing to compare when no peak was found", () => {
    expect(
      comparisonWindows(
        { state: "no_material_decline", windows: [], limitation: null },
        "2026-07-29",
      ),
    ).toBeNull();
  });

  it("keeps the two windows the same length", () => {
    const windows = comparisonWindows(changePoint("2026-05-07"), "2026-07-29");
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
  it("stays inside the per-run upstream call budget", async () => {
    // Search Console quota is counted per GCP project, not per visitor, so an
    // unbounded plan here is spent out of every other visitor's budget. The
    // plan is four calls — two windows, each needing its rows and its totals —
    // and this is the test that notices if a fifth is ever added.
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
      seriesEndDate: "2026-07-29",
    });

    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(
      QUERY_READ_CALL_BUDGET,
    );
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
      changePoint: { state: "no_material_decline", windows: [], limitation: null },
      seriesEndDate: "2026-07-29",
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
        seriesEndDate: "2026-07-29",
      }),
    ).resolves.toBeNull();
  });
});
