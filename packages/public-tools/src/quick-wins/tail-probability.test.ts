import { describe, expect, it } from "vitest";

import { binomialLowerTail } from "./tail-probability.ts";

describe("binomialLowerTail", () => {
  it("matches the exact binomial sum on a hand-checkable case", () => {
    // C(10,0..5) / 2^10 = (1+10+45+120+210+252)/1024
    expect(binomialLowerTail(10, 5, 0.5)).toBeCloseTo(0.623046875, 12);
  });

  it("reduces to (1-p)^n when no clicks were observed", () => {
    expect(binomialLowerTail(100, 0, 0.01)).toBeCloseTo(0.99 ** 100, 12);
  });

  it("is monotone in the observed click count", () => {
    const at2 = binomialLowerTail(1000, 2, 0.02)!;
    const at5 = binomialLowerTail(1000, 5, 0.02)!;
    const at20 = binomialLowerTail(1000, 20, 0.02)!;

    expect(at2).toBeLessThan(at5);
    expect(at5).toBeLessThan(at20);
  });

  it("is monotone in the baseline rate", () => {
    // The same weak result is more surprising against a higher baseline.
    const vsLow = binomialLowerTail(1000, 5, 0.01)!;
    const vsHigh = binomialLowerTail(1000, 5, 0.05)!;

    expect(vsHigh).toBeLessThan(vsLow);
  });

  it("handles the real astrologywiki row without overflow or NaN", () => {
    // position 8.9, 3,259 impressions, 4 clicks, against the site's own
    // 8-11 band rate of 0.51%.
    const p = binomialLowerTail(3259, 4, 0.0051);

    expect(p).not.toBeNull();
    expect(Number.isFinite(p!)).toBe(true);
    expect(p!).toBeGreaterThan(0);
    expect(p!).toBeLessThan(0.001);
  });

  it("stays inside [0,1] at impression counts where factorials would overflow", () => {
    const p = binomialLowerTail(250_000, 40, 0.03);

    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThanOrEqual(0);
    expect(p!).toBeLessThanOrEqual(1);
  });

  // These are the regression cases for the underflow that a naive
  // (1-p)^n-seeded recurrence hits. Each n here is past the threshold where
  // that seed rounds to zero, and each expected value was computed
  // independently in log space. A [0,1] range assertion passes on the broken
  // implementation; these do not.
  it("does not collapse to zero past the seed-underflow threshold", () => {
    // n·ln(0.7) = -750: the seed is unrepresentable, the answer is not.
    expect(binomialLowerTail(2100, 630, 0.3)!).toBeCloseTo(0.5108, 3);
  });

  it("reports a query at its baseline as unremarkable, not as extreme", () => {
    // 1,250 clicks on 25,000 impressions IS the 5% baseline. Returning 0 here
    // would render as "< 0.0001" — the strongest signal in the table — for a
    // query performing exactly as the site's own curve predicts.
    expect(binomialLowerTail(25_000, 1250, 0.05)!).toBeCloseTo(0.5075, 3);
  });

  it("reports a query far above its baseline as ~1", () => {
    expect(binomialLowerTail(25_000, 2000, 0.05)!).toBeCloseTo(1, 6);
  });

  it("keeps the small-n answers it already had", () => {
    // The pre-fix implementation was correct below the underflow threshold;
    // the log-space rewrite must not move those values.
    expect(binomialLowerTail(3259, 4, 0.0051)!).toBeCloseTo(2.418977e-4, 8);
    expect(binomialLowerTail(1000, 5, 0.02)!).toBeCloseTo(6.400907e-5, 9);
  });

  it("returns 1 when the observed clicks reach the impression count", () => {
    expect(binomialLowerTail(100, 100, 0.5)).toBe(1);
    expect(binomialLowerTail(100, 200, 0.5)).toBe(1);
  });

  it("treats a zero baseline as making every outcome unremarkable", () => {
    expect(binomialLowerTail(1000, 0, 0)).toBe(1);
  });

  it("treats a baseline of 1 as making any shortfall impossible", () => {
    expect(binomialLowerTail(1000, 999, 1)).toBe(0);
  });

  it("returns null where the question is undefined", () => {
    expect(binomialLowerTail(0, 0, 0.05)).toBeNull();
    expect(binomialLowerTail(-1, 0, 0.05)).toBeNull();
    expect(binomialLowerTail(100, -1, 0.05)).toBeNull();
    expect(binomialLowerTail(100, 1, 1.5)).toBeNull();
    expect(binomialLowerTail(100, 1, Number.NaN)).toBeNull();
  });
});
