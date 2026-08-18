// @input  -- booked provider costs and a scripted shared-quota store
// @output -- proof the per-run ceiling and the daily breaker cannot be switched off
// @pos    -- focused tests for the GEO Agent's only spend bound

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeGeoDailyBudget,
  createGeoCostAccumulator,
  geoDailyBudgetBucket,
  GEO_CALL_P50_COST_USD,
  GEO_CALLS_PER_RUN,
  GEO_DAILY_RUN_MAX,
  GEO_MAX_PROVIDER_COST_USD,
  GEO_RUN_P50_COST_USD,
} from "./geo-cost-guard.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("geo cost constants", () => {
  it("fixes the call count at the §2.2 retrieval/natural mix", () => {
    // Five retrieval probes at three samples plus three natural-demand
    // questions at one. Pinned as a literal because the ceiling below is
    // derived from it: a call count that changed without this failing would
    // leave a ceiling that no longer bounds anything.
    expect(GEO_CALLS_PER_RUN).toBe(18);
  });

  it("keeps the per-run ceiling above the measured worst case", () => {
    // Twelve calibration calls ranged $0.035-$0.052.
    expect(GEO_MAX_PROVIDER_COST_USD).toBeGreaterThan(
      GEO_CALLS_PER_RUN * 0.052,
    );
  });

  it("leaves the daily breaker above a single run", () => {
    expect(GEO_RUN_P50_COST_USD).toBeCloseTo(0.8226, 4);
    expect(GEO_DAILY_RUN_MAX).toBeGreaterThan(1);
  });
});

describe("createGeoCostAccumulator", () => {
  it("totals what it settled", () => {
    const costs = createGeoCostAccumulator();
    costs.admit();
    costs.settle(0.04);
    costs.admit();
    costs.settle(0.05);

    expect(costs.spent()).toBeCloseTo(0.09, 6);
    expect(costs.unpricedCalls()).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "refuses %s rather than poisoning the total",
    (value) => {
      const costs = createGeoCostAccumulator();
      costs.admit();
      costs.settle(0.04);
      costs.admit();
      costs.settle(value);

      expect(costs.spent()).toBeCloseTo(0.04, 6);
      expect(costs.unpricedCalls()).toBe(1);
      // The point of refusing: one NaN would make every comparison false and
      // leave the ceiling permanently open.
      expect(costs.admit()).toBe(true);
    },
  );

  it("refuses rather than throwing once the ceiling is reached", () => {
    const costs = createGeoCostAccumulator();
    let admitted = 0;
    for (let call = 0; call < GEO_CALLS_PER_RUN * 2; call += 1) {
      if (costs.admit()) {
        admitted += 1;
        costs.settle(GEO_CALL_P50_COST_USD);
      }
    }

    expect(costs.capped()).toBe(true);
    expect(costs.spent()).toBeLessThanOrEqual(GEO_MAX_PROVIDER_COST_USD);
    expect(admitted).toBeLessThan(GEO_CALLS_PER_RUN * 2);
  });

  it("admits a full normal run without capping", () => {
    const costs = createGeoCostAccumulator();
    for (let call = 0; call < GEO_CALLS_PER_RUN; call += 1) {
      expect(costs.admit()).toBe(true);
      costs.settle(GEO_CALL_P50_COST_USD);
    }

    expect(costs.capped()).toBe(false);
  });

  it("counts concurrent reservations, not just settled spend", () => {
    // The defect this replaced: with eight calls in flight and nothing settled
    // yet, a check against settled spend alone admitted every one of them.
    const costs = createGeoCostAccumulator();
    let admitted = 0;
    while (costs.admit()) admitted += 1;

    expect(admitted).toBeGreaterThan(0);
    expect(admitted * GEO_CALL_P50_COST_USD).toBeLessThanOrEqual(
      GEO_MAX_PROVIDER_COST_USD,
    );
    expect(costs.spent()).toBe(0);
  });
});

describe("geoDailyBudgetBucket", () => {
  it("keys one bucket per UTC day for the whole account", () => {
    const bucket = geoDailyBudgetBucket(Date.parse("2026-08-17T23:59:00.000Z"));

    expect(bucket).toBe("agent-geo:budget:2026-08-17");
    expect(bucket).not.toContain("user");
  });
});

function quota(row: unknown) {
  return {
    quota: { callQuota: vi.fn(async () => Promise.resolve(row)) },
    now: () => Date.parse("2026-08-17T10:00:00.000Z"),
  } as never;
}

describe("consumeGeoDailyBudget", () => {
  it("allows a run inside the day's budget", async () => {
    const outcome = await consumeGeoDailyBudget(
      quota({ allowed: true, hits: 3, reset_at: null }),
    );

    expect(outcome).toEqual({ kind: "allowed", runsToday: 3 });
  });

  it("reports an exhausted budget without describing the store", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const outcome = await consumeGeoDailyBudget(
      quota({
        allowed: false,
        hits: GEO_DAILY_RUN_MAX,
        reset_at: "2026-08-18T00:00:00.000Z",
      }),
    );

    expect(outcome.kind).toBe("exhausted");
  });

  it("logs and reports an unavailable budget store", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const dependencies = {
      quota: {
        callQuota: vi.fn(async () => {
          throw new Error("connection refused to db.internal");
        }),
      },
      now: () => Date.parse("2026-08-17T10:00:00.000Z"),
    } as never;

    const outcome = await consumeGeoDailyBudget(dependencies);

    expect(outcome.kind).toBe("unavailable");
    expect(error).toHaveBeenCalled();
  });
});
