import { describe, expect, it, vi } from "vitest";

import { GSC_ROW_LIMIT } from "../gsc-analytics/reader.ts";
import type {
  GscQueryRequest,
  GscQueryResponse,
  GscRawRow,
} from "../gsc-analytics/types.ts";
import { latestFinalWindow } from "../gsc-analytics/window.ts";
import { MIN_BUCKET_QUERIES } from "../site-baseline/ctr-curve.ts";
import { runQuickWins } from "./run.ts";

const NOW = new Date("2026-08-03T20:00:00Z");

/**
 * A usable band.
 *
 * One row MORE than the bucket gate, because leave-one-out removes the query
 * being measured before it computes that query's baseline: a band of exactly
 * MIN_BUCKET_QUERIES qualifies as a curve but cannot serve as a baseline for
 * anyone inside it.
 */
function band(): GscRawRow[] {
  return Array.from({ length: MIN_BUCKET_QUERIES + 1 }, (_, i) => ({
    keys: [`peer${i}`],
    impressions: 1000,
    clicks: 50,
    position: 9,
  }));
}

/** Answers the query read and the totals read from one fake. */
function client(
  options: {
    readonly queryRows?: readonly GscRawRow[];
    readonly totals?: GscRawRow | null;
    readonly failTotals?: boolean;
    readonly failQueries?: boolean;
  } = {},
) {
  const calls: GscQueryRequest[] = [];
  const impl = async (request: GscQueryRequest): Promise<GscQueryResponse> => {
    calls.push(request);
    if (request.dimensions.length === 0) {
      if (options.failTotals) throw new Error("totals unavailable");
      // band() sums to 6,000 impressions and 300 clicks; these totals leave a
      // sixth of each withheld by Search Console.
      const row = options.totals ?? {
        keys: [],
        impressions: 7200,
        clicks: 360,
        position: 9,
      };
      return {
        rows: row === null ? [] : [row],
        responseAggregationType: "byProperty",
      };
    }
    if (options.failQueries) throw new Error("429");
    return {
      rows: options.queryRows ?? band(),
      responseAggregationType: "byProperty",
    };
  };
  return { impl, calls };
}

describe("runQuickWins", () => {
  it("reads the latest finalised Pacific window", async () => {
    const { impl, calls } = client();

    await runQuickWins({ client: impl, now: NOW, brandTerms: [] });

    const expected = latestFinalWindow(NOW);
    for (const call of calls) {
      expect(call.startDate).toBe(expected.startDate);
      expect(call.endDate).toBe(expected.endDate);
    }
  });

  it("stamps completedAt from the supplied clock", async () => {
    const { impl } = client();

    const envelope = await runQuickWins({
      client: impl,
      now: NOW,
      brandTerms: [],
    });

    expect(envelope.run.completedAt).toBe(NOW.toISOString());
  });

  it("computes the anonymization gap from the totals read", async () => {
    const { impl } = client();

    const { result } = await runQuickWins({
      client: impl,
      now: NOW,
      brandTerms: [],
    });

    // 6,000 of 7,200 impressions came back in the query report.
    expect(result.anonymization?.missingImpressionShare).toBeCloseTo(1 / 6);
  });

  it("degrades to an unknown gap when only the totals read fails", async () => {
    // One unavailable dimension must not take down a run whose main
    // measurement succeeded — but it also must not be reported as a 0% gap.
    const { impl } = client({ failTotals: true });

    const { result } = await runQuickWins({
      client: impl,
      now: NOW,
      brandTerms: [],
    });

    expect(result.anonymization).toBeNull();
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("fails the run when the query read fails", async () => {
    // There is no report without the query rows. Substituting an empty table
    // would tell the visitor their site has no measurable gaps.
    const { impl } = client({ failQueries: true });

    await expect(
      runQuickWins({ client: impl, now: NOW, brandTerms: [] }),
    ).rejects.toThrow("429");
  });

  it("passes truncation through to the limitations", async () => {
    const full = Array.from({ length: GSC_ROW_LIMIT }, (_, i) => ({
      keys: [`q${i}`],
      impressions: 100,
      clicks: 1,
      position: 9,
    }));
    const { impl } = client({ queryRows: full });

    const { result } = await runQuickWins({
      client: impl,
      now: NOW,
      brandTerms: [],
    });

    expect(result.limitations).toContain("partial_gsc_export");
  });

  it("applies the visitor's brand terms", async () => {
    const { impl } = client({
      queryRows: [
        ...band(),
        { keys: ["acme pricing"], impressions: 5000, clicks: 500, position: 9 },
      ],
    });

    const { result } = await runQuickWins({
      client: impl,
      now: NOW,
      brandTerms: ["acme"],
    });

    expect(result.curve.brandRowsExcluded).toBe(1);
  });

  it("issues both reads concurrently rather than one after the other", async () => {
    const started: string[] = [];
    const impl = vi.fn(async (request: GscQueryRequest) => {
      started.push(request.dimensions.length === 0 ? "totals" : "queries");
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        rows: request.dimensions.length === 0 ? [] : band(),
        responseAggregationType: "byProperty",
      };
    });

    await runQuickWins({ client: impl, now: NOW, brandTerms: [] });

    // Both calls are in flight before either resolves.
    expect(started).toHaveLength(2);
  });
});
