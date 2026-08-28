import { describe, expect, it } from "vitest";

import {
  benjaminiHochberg,
  BH_FDR_Q,
  changeVerdict,
  collapseGroupsToBernoulli,
  describeProportion,
  mcnemarExactP,
  minTrialsForZeroClaim,
  MIN_TRIALS_FOR_TEST,
  newcombeDiff,
  pooled,
  twoProportionP,
  wilson,
  ZERO_CLAIM_UPPER_BOUND,
} from "./stats.ts";

const near = (value: number | null, expected: number, tolerance = 1e-4) => {
  expect(value).not.toBeNull();
  expect(Math.abs((value as number) - expected)).toBeLessThan(tolerance);
};

describe("wilson", () => {
  it("matches published interval values", () => {
    // Cross-checked against R's binom.confint(method = "wilson").
    const zeroOfFive = wilson(0, 5);
    expect(zeroOfFive.point).toBe(0);
    expect(zeroOfFive.lo).toBe(0);
    near(zeroOfFive.hi, 0.43449);

    near(wilson(1, 10).lo, 0.017876);
    near(wilson(1, 10).hi, 0.404146);
    near(wilson(5, 5).lo, 0.565525);
    expect(wilson(5, 5).hi).toBe(1);
  });

  it("reports no trials as unavailable rather than zero", () => {
    const none = wilson(0, 0);
    expect(none.point).toBeNull();
    expect(none.lo).toBeNull();
    expect(none.hi).toBeNull();
    expect(describeProportion(none)).toEqual({ kind: "unavailable" });
  });

  it("refuses counts that cannot be a proportion", () => {
    expect(() => wilson(2, 1)).toThrow(RangeError);
    expect(() => wilson(-1, 5)).toThrow(RangeError);
    expect(() => wilson(1.5, 5)).toThrow(RangeError);
    expect(() => wilson(Number.NaN, 5)).toThrow(RangeError);
  });
});

describe("pooled", () => {
  it("sums counts rather than averaging rates", () => {
    const value = pooled([
      { successes: 1, trials: 5 },
      { successes: 9, trials: 100 },
    ]);
    expect(value.successes).toBe(10);
    expect(value.trials).toBe(105);
    // Averaging the two rates would give 0.145, which weights the five-sample
    // group the same as the hundred-sample one.
    near(value.point, 10 / 105);
  });
});

describe("the zero claim", () => {
  it("draws the line where the upper bound actually falls", () => {
    expect(minTrialsForZeroClaim()).toBe(35);
    expect(wilson(0, 35).hi).toBeLessThanOrEqual(ZERO_CLAIM_UPPER_BOUND);
    expect(wilson(0, 34).hi).toBeGreaterThan(ZERO_CLAIM_UPPER_BOUND);
    near(wilson(0, 35).hi, 0.098901);
    near(wilson(0, 34).hi, 0.101515);
  });

  it("separates a small sample from a conclusion", () => {
    expect(describeProportion(wilson(0, 5)).kind).toBe("unobserved");
    expect(describeProportion(wilson(0, 34)).kind).toBe("unobserved");
    expect(describeProportion(wilson(0, 35)).kind).toBe("zero");
    expect(describeProportion(wilson(0, 50)).kind).toBe("zero");
  });

  it("never renders an observation that happened as zero", () => {
    // 1/2001 rounds to 0.0% at one decimal place; "observed" and "0.0%" in the
    // same row is exactly the sentence the four shapes exist to prevent.
    const description = describeProportion(wilson(1, 2_001));
    expect(description.kind).toBe("observed");
    if (description.kind === "observed") {
      expect(description.percent).toBeGreaterThan(0);
    }
  });
});

describe("clustered observations", () => {
  it("counts questions, not repeats of the same question", () => {
    const sevenQuestionsNeverMentioned = Array.from({ length: 7 }, () => ({
      successes: 0,
      trials: 5,
    }));

    // Pooled, this is 35 trials and clears the zero-claim bar on the strength
    // of seven observations. Collapsed, it is seven, and stays "not observed".
    expect(describeProportion(pooled(sevenQuestionsNeverMentioned)).kind).toBe(
      "zero",
    );
    const collapsed = collapseGroupsToBernoulli(sevenQuestionsNeverMentioned);
    expect(collapsed).toEqual({ successes: 0, trials: 7 });
    expect(
      describeProportion(wilson(collapsed.successes, collapsed.trials)).kind,
    ).toBe("unobserved");
  });

  it("treats a question mentioned at least once as one success", () => {
    expect(
      collapseGroupsToBernoulli([
        { successes: 3, trials: 5 },
        { successes: 1, trials: 5 },
        { successes: 0, trials: 5 },
        { successes: 0, trials: 0 },
      ]),
    ).toEqual({ successes: 2, trials: 3 });
  });
});

describe("significance", () => {
  it("refuses to test below the declared floor", () => {
    // 0/5 against 3/5 is a coin landing differently twice. The unguarded z test
    // gives p = 0.038 and would be rejected at q = 0.10.
    expect(twoProportionP(0, 5, 3, 5)).toBe(1);
    expect(benjaminiHochberg([twoProportionP(0, 5, 3, 5)])).toEqual([false]);
    expect(MIN_TRIALS_FOR_TEST).toBe(30);
  });

  it("still tests once both sides carry enough trials", () => {
    const p = twoProportionP(10, 100, 30, 100);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.01);
  });

  it("rejects every hypothesis at or below the largest passing rank", () => {
    // p = 0.05 fails its own 2/5 * 0.1 threshold and is still rejected,
    // because rank 4 passes. Comparing each p to its own threshold instead is
    // the quiet version of this mistake.
    expect(benjaminiHochberg([0.005, 0.05, 0.06, 0.079, 0.9], 0.1)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(benjaminiHochberg([], 0.1)).toEqual([]);
  });

  it("keeps the index of each p value when ranking", () => {
    expect(benjaminiHochberg([0.9, 0.001, 0.5], 0.1)).toEqual([
      false,
      true,
      false,
    ]);
  });
});

describe("difference intervals", () => {
  it("spans zero when five samples changed", () => {
    const interval = newcombeDiff(0, 5, 2, 5);
    expect(interval).not.toBeNull();
    expect(interval!.lo).toBeLessThan(0);
    expect(interval!.hi).toBeGreaterThan(0);
  });

  it("does not call a change significant while its interval contains zero", () => {
    // 1/5 -> 4/5 gives p = 0.058 from the unguarded z test and an interval
    // whose lower bound is still below zero. One verdict, and it is the
    // stricter one.
    const verdict = changeVerdict(
      { baseSuccesses: 1, baseTrials: 5, currentSuccesses: 4, currentTrials: 5 },
      true,
    );
    expect(verdict.testable).toBe(false);
    expect(verdict.changed).toBe(false);
    expect(verdict.lo).not.toBeNull();
    expect(verdict.lo!).toBeLessThan(0);
  });

  it("calls a change only when both the test and the interval agree", () => {
    const verdict = changeVerdict(
      {
        baseSuccesses: 10,
        baseTrials: 100,
        currentSuccesses: 40,
        currentTrials: 100,
      },
      true,
    );
    expect(verdict.testable).toBe(true);
    expect(verdict.changed).toBe(true);
    expect(verdict.lo!).toBeGreaterThan(0);

    // The same counts without the FDR rejection stay unchanged.
    expect(
      changeVerdict(
        {
          baseSuccesses: 10,
          baseTrials: 100,
          currentSuccesses: 40,
          currentTrials: 100,
        },
        false,
      ).changed,
    ).toBe(false);
  });

  it("never reports a change the test and the interval disagree about", () => {
    // Exhaustive over the sampling sizes this tool can produce.
    for (let n1 = 0; n1 <= 40; n1 += 5) {
      for (let n2 = 0; n2 <= 40; n2 += 5) {
        for (let k1 = 0; k1 <= n1; k1 += 1) {
          for (let k2 = 0; k2 <= n2; k2 += 1) {
            const verdict = changeVerdict(
              {
                baseSuccesses: k1,
                baseTrials: n1,
                currentSuccesses: k2,
                currentTrials: n2,
              },
              true,
            );
            if (!verdict.changed) continue;
            expect(verdict.lo).not.toBeNull();
            expect(verdict.lo! > 0 || verdict.hi! < 0).toBe(true);
          }
        }
      }
    }
  });
});

describe("mcnemarExactP", () => {
  it("says nothing happened when nothing moved", () => {
    expect(mcnemarExactP(0, 0)).toBe(1);
  });

  it("matches the exact binomial by hand", () => {
    // b=5, c=0: 2 * P(X <= 0) with X ~ Bin(5, 0.5) = 2 * 1/32.
    expect(mcnemarExactP(5, 0)).toBeCloseTo(0.0625, 12);
    // b=4, c=1: 2 * (1/32 + 5/32) = 0.375.
    expect(mcnemarExactP(4, 1)).toBeCloseTo(0.375, 12);
    // An even split is the least surprising outcome there is.
    expect(mcnemarExactP(3, 3)).toBe(1);
  });

  it("is symmetric in the two directions", () => {
    expect(mcnemarExactP(9, 2)).toBeCloseTo(mcnemarExactP(2, 9), 15);
  });

  it("cannot reject below six discordant pairs", () => {
    // The smallest attainable p at five is 0.0625, above the q it would be
    // compared against. This is why the paired test needs a handful of
    // questions to have moved before it can say anything at all.
    for (let moved = 1; moved <= 5; moved += 1) {
      expect(mcnemarExactP(moved, 0)).toBeGreaterThan(BH_FDR_Q / 2);
    }
    expect(mcnemarExactP(6, 0)).toBeLessThan(BH_FDR_Q / 2);
  });

  it("never exceeds one, however lopsided", () => {
    expect(mcnemarExactP(1, 1)).toBeLessThanOrEqual(1);
    expect(mcnemarExactP(40, 40)).toBeLessThanOrEqual(1);
  });

  it("refuses counts that are not counts", () => {
    expect(() => mcnemarExactP(-1, 0)).toThrow(RangeError);
    expect(() => mcnemarExactP(1.5, 0)).toThrow(RangeError);
  });
});
