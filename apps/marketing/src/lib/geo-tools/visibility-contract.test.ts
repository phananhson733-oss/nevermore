import { describe, expect, it } from "vitest";

import {
  VISIBILITY_CALL_COST_USD,
  VISIBILITY_CALL_SECONDS,
  VISIBILITY_CONCURRENCY,
  VISIBILITY_SAMPLES_DEFAULT,
  visibilityCallCount,
  visibilityCostEstimateUsd,
  visibilityMinutesEstimate,
} from "./visibility-contract.ts";

/**
 * These three numbers are what a visitor reads before agreeing to a paid run.
 *
 * Everything below is written against the constants rather than against the
 * numbers they currently produce: a calibration that moves the price or the
 * per-call latency must move the estimate, and a test that pinned today's
 * dollars would stay green while the page started quoting the wrong figure.
 */

/** A real run: fifteen frozen questions at the default sampling depth. */
const REAL_QUESTIONS = 15;
const REAL_CALLS = visibilityCallCount(REAL_QUESTIONS, VISIBILITY_SAMPLES_DEFAULT);

describe("visibilityCallCount", () => {
  it("is one call per sample of per question", () => {
    expect(VISIBILITY_SAMPLES_DEFAULT).toBe(5);
    expect(REAL_CALLS).toBe(75);
    // Multiplied, not added: 15 + 5 is 20, and a run that bought 20 answers
    // instead of 75 would quote a quarter of what it spends.
    expect(visibilityCallCount(REAL_QUESTIONS, 1)).toBe(REAL_QUESTIONS);
    expect(visibilityCallCount(1, VISIBILITY_SAMPLES_DEFAULT)).toBe(
      VISIBILITY_SAMPLES_DEFAULT,
    );
  });

  it("asks for nothing when there are no questions", () => {
    expect(visibilityCallCount(0, VISIBILITY_SAMPLES_DEFAULT)).toBe(0);
  });
});

describe("visibilityCostEstimateUsd", () => {
  it("quotes nothing for a run with no calls", () => {
    expect(visibilityCostEstimateUsd(0)).toBe(0);
  });

  it("quotes the calibrated price per call, to the cent", () => {
    const quoted = visibilityCostEstimateUsd(REAL_CALLS);
    const exact = REAL_CALLS * VISIBILITY_CALL_COST_USD;

    // A figure a page prints with two decimals must BE two decimals, or the
    // render rounds a second time and the two disagree.
    expect(quoted).toBe(Number(quoted.toFixed(2)));
    // Within half a cent of the calibrated total: that is what rounding to the
    // cent allows, and it is more than a floor or a dropped multiplication can
    // manage.
    expect(Math.abs(quoted - exact)).toBeLessThanOrEqual(0.005 + 1e-9);
  });

  it("scales with the number of calls", () => {
    const single = visibilityCostEstimateUsd(REAL_CALLS);
    const double = visibilityCostEstimateUsd(REAL_CALLS * 2);

    expect(double).toBeGreaterThan(single);
    // Doubling the run doubles the bill, give or take the two roundings.
    expect(Math.abs(double - single * 2)).toBeLessThanOrEqual(0.02 + 1e-9);
  });
});

describe("visibilityMinutesEstimate", () => {
  it("never quotes zero minutes", () => {
    expect(visibilityMinutesEstimate(0)).toBe(1);
    expect(visibilityMinutesEstimate(1)).toBeGreaterThanOrEqual(1);
  });

  it("quotes whole minutes", () => {
    expect(Number.isInteger(visibilityMinutesEstimate(REAL_CALLS))).toBe(true);
  });

  it("charges one wave for anything that fits in one wave", () => {
    // The width the concurrency constant publishes: filling it costs the same
    // wall clock as a single call, and an estimate that ignored concurrency
    // would quote eight times as long.
    expect(visibilityMinutesEstimate(VISIBILITY_CONCURRENCY)).toBe(
      visibilityMinutesEstimate(1),
    );
  });

  it("charges a full wave for a partial one", () => {
    const eleven = VISIBILITY_CONCURRENCY * 11;
    // One call past eleven full waves costs what twelve full waves cost.
    expect(visibilityMinutesEstimate(eleven + 1)).toBe(
      visibilityMinutesEstimate(VISIBILITY_CONCURRENCY * 12),
    );
    expect(visibilityMinutesEstimate(eleven + 1)).toBeGreaterThan(
      visibilityMinutesEstimate(eleven),
    );
  });

  it("quotes the wall clock of the waves a real run needs", () => {
    const waves = Math.ceil(REAL_CALLS / VISIBILITY_CONCURRENCY);
    const seconds = waves * VISIBILITY_CALL_SECONDS;

    // Rounded to the nearest minute, so at most thirty seconds either way.
    // A floor instead of a ceiling drops a whole wave and lands outside this.
    expect(
      Math.abs(visibilityMinutesEstimate(REAL_CALLS) * 60 - seconds),
    ).toBeLessThanOrEqual(30);
  });
});
