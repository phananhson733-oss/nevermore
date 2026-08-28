// @input  -- integer success/trial counts from GEO sampling and check runs
// @output -- Wilson proportions, pooled aggregates, difference intervals, BH decisions, and a renderable description
// @pos    -- the only place a proportion becomes a number a reader sees; no locale strings live here

/**
 * Zero dependencies, zero copy.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Intervals are Wilson score intervals. A Wald interval has zero width at
 *    p̂ = 0 ("0% ± 0%"), and p̂ = 0 is the single most common observation in
 *    GEO sampling — a brand that is never mentioned. Reporting that as a point
 *    estimate of zero is the difference between "we did not see it" and "it
 *    does not happen".
 * 2. Nothing here returns a sentence. `describeProportion` returns a tagged
 *    union and the caller renders it through next-intl, because a rule engine
 *    that returns Chinese prose cannot serve `/en`.
 */

/** Two-sided 95%. */
export const Z95 = 1.959963984540054;

/**
 * The line between "0.0%" and "not observed in this run".
 *
 * Owner ruling D7 (2026-08-28): a zero is only reported as a zero when the
 * Wilson upper bound is at or below this value — roughly n ≥ 35 at 95%. Below
 * it the run says "not observed, upper bound x%", because 0/5 and 0/50 are
 * different claims and only one of them is a conclusion.
 *
 * The threshold is printed on the page next to the numbers it governs.
 */
export const ZERO_CLAIM_UPPER_BOUND = 0.1;

/** Aggregate hypotheses below this trial count do not enter significance testing. */
export const MIN_TRIALS_FOR_TEST = 30;

/** Benjamini-Hochberg false discovery rate for the run-over-run comparison. */
export const BH_FDR_Q = 0.1;

/**
 * A proportion with its sample size and interval.
 *
 * `trials === 0` gives `point: null` — unavailable, which is not zero.
 */
export interface Proportion {
  readonly successes: number;
  readonly trials: number;
  readonly point: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  readonly level: number;
}

/* ------------------------------------------------------------------ */
/* Input contract                                                      */
/* ------------------------------------------------------------------ */

/**
 * Counts reaching this file are derived internally, never parsed from a
 * request, so a bad count is a bug rather than bad input. Throwing makes it
 * loud at the seam that produced it; returning "unavailable" would let a
 * NaN travel all the way to a rendered percentage.
 */
function assertCounts(successes: number, trials: number): void {
  if (!Number.isSafeInteger(trials) || trials < 0) {
    throw new RangeError(`trials must be a non-negative integer, got ${trials}`);
  }
  if (!Number.isSafeInteger(successes) || successes < 0) {
    throw new RangeError(
      `successes must be a non-negative integer, got ${successes}`,
    );
  }
  if (successes > trials) {
    throw new RangeError(
      `successes (${successes}) cannot exceed trials (${trials})`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Normal distribution                                                 */
/* ------------------------------------------------------------------ */

/** Abramowitz & Stegun 7.1.26, |ε| < 1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/* ------------------------------------------------------------------ */
/* Wilson score interval                                               */
/* ------------------------------------------------------------------ */

/**
 *            p̂ + z²/2n  ±  z·√( p̂(1−p̂)/n + z²/4n² )
 *   CI  =  ────────────────────────────────────────────
 *                        1 + z²/n
 */
export function wilson(
  successes: number,
  trials: number,
  z: number = Z95,
): Proportion {
  assertCounts(successes, trials);
  if (!Number.isFinite(z) || z <= 0) {
    throw new RangeError(`z must be a positive finite number, got ${z}`);
  }
  const level = 2 * normalCdf(z) - 1;
  if (trials === 0) {
    return { successes, trials, point: null, lo: null, hi: null, level };
  }
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half =
    (z / denom) *
    Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    successes,
    trials,
    point: p,
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
    level,
  };
}

/**
 * Aggregation is pooled: Σ successes / Σ trials.
 *
 * Averaging per-group proportions is wrong here because the groups have
 * different trial counts — a prompt whose samples mostly timed out would get
 * the same weight as one with a full set.
 */
export function pooled(
  parts: readonly { readonly successes: number; readonly trials: number }[],
  z: number = Z95,
): Proportion {
  let s = 0;
  let t = 0;
  for (const part of parts) {
    assertCounts(part.successes, part.trials);
    s += part.successes;
    t += part.trials;
  }
  return wilson(s, t, z);
}

/* ------------------------------------------------------------------ */
/* Comparing two proportions                                           */
/* ------------------------------------------------------------------ */

/** Two-proportion z test with pooled variance; returns the two-sided p value. */
export function twoProportionP(
  k1: number,
  n1: number,
  k2: number,
  n2: number,
): number {
  assertCounts(k1, n1);
  assertCounts(k2, n2);
  if (n1 === 0 || n2 === 0) return 1;
  const pp = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
  if (!Number.isFinite(se) || se === 0) return 1;
  const zStat = (k2 / n2 - k1 / n1) / se;
  return 2 * (1 - normalCdf(Math.abs(zStat)));
}

/**
 * Newcombe method 10: combine each side's Wilson interval into an interval for
 * the difference. Far better behaved than a Wald difference at small n.
 */
export function newcombeDiff(
  k1: number,
  n1: number,
  k2: number,
  n2: number,
  z: number = Z95,
): { readonly diff: number; readonly lo: number; readonly hi: number } | null {
  assertCounts(k1, n1);
  assertCounts(k2, n2);
  if (n1 === 0 || n2 === 0) return null;
  const w1 = wilson(k1, n1, z);
  const w2 = wilson(k2, n2, z);
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const diff = p2 - p1;
  const lo = diff - Math.sqrt((p2 - w2.lo!) ** 2 + (w1.hi! - p1) ** 2);
  const hi = diff + Math.sqrt((w2.hi! - p2) ** 2 + (p1 - w1.lo!) ** 2);
  return { diff, lo: Math.max(-1, lo), hi: Math.min(1, hi) };
}

/* ------------------------------------------------------------------ */
/* Multiple comparisons                                                */
/* ------------------------------------------------------------------ */

/**
 * Benjamini-Hochberg FDR, step-up.
 *
 * The comparison view tests up to seven aggregate hypotheses at once; at
 * α = 0.05 that is an expected 0.35 false positives per comparison, which is
 * how "we improved" gets manufactured out of noise.
 *
 * Step-up matters: every hypothesis ranked at or below the largest index
 * satisfying p₍ᵢ₎ ≤ (i/m)·q is rejected, including ones whose own p value
 * fails that inequality. Rejecting only the ones that individually pass is a
 * common and quieter mistake.
 */
export function benjaminiHochberg(
  pValues: readonly number[],
  q: number = BH_FDR_Q,
): boolean[] {
  if (!Number.isFinite(q) || q <= 0 || q > 1) {
    throw new RangeError(`q must be in (0, 1], got ${q}`);
  }
  const m = pValues.length;
  const out = new Array<boolean>(m).fill(false);
  if (m === 0) return out;
  for (const p of pValues) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new RangeError(`p values must be in [0, 1], got ${p}`);
    }
  }

  const ranked = pValues
    .map((p, index) => ({ p, index }))
    .sort((a, b) => a.p - b.p);

  let kMax = -1;
  for (let rank = 0; rank < m; rank += 1) {
    if (ranked[rank]!.p <= ((rank + 1) / m) * q) kMax = rank;
  }
  for (let rank = 0; rank <= kMax; rank += 1) out[ranked[rank]!.index] = true;
  return out;
}

/* ------------------------------------------------------------------ */
/* Description                                                         */
/* ------------------------------------------------------------------ */

/**
 * What a proportion is allowed to say, as data.
 *
 * The UI renders exactly these four shapes and never assembles a percentage
 * itself, so "0.0%" cannot appear next to an n of 5 by way of a template
 * somebody wrote in a component.
 */
export type ProportionDescription =
  /** No trials at all. Unavailable, not zero. */
  | { readonly kind: "unavailable" }
  /** Zero observed, but the sample is too small to call it a zero. */
  | {
      readonly kind: "unobserved";
      readonly trials: number;
      readonly hiPercent: number;
    }
  /** Zero observed with a tight enough upper bound to report as 0.0%. */
  | {
      readonly kind: "zero";
      readonly trials: number;
      readonly hiPercent: number;
    }
  | {
      readonly kind: "observed";
      readonly percent: number;
      readonly trials: number;
      readonly loPercent: number;
      readonly hiPercent: number;
    };

const asPercent = (value: number): number => Math.round(value * 1000) / 10;

export function describeProportion(
  proportion: Proportion,
  zeroClaimUpperBound: number = ZERO_CLAIM_UPPER_BOUND,
): ProportionDescription {
  if (proportion.trials === 0 || proportion.point === null) {
    return { kind: "unavailable" };
  }
  const hiPercent = asPercent(proportion.hi ?? 1);
  if (proportion.successes === 0) {
    return (proportion.hi ?? 1) <= zeroClaimUpperBound
      ? { kind: "zero", trials: proportion.trials, hiPercent }
      : { kind: "unobserved", trials: proportion.trials, hiPercent };
  }
  return {
    kind: "observed",
    percent: asPercent(proportion.point),
    trials: proportion.trials,
    loPercent: asPercent(proportion.lo ?? 0),
    hiPercent,
  };
}

/**
 * The smallest trial count at which a zero may be reported as 0.0%.
 *
 * Derived rather than declared, so the number printed on the page cannot drift
 * away from the bound that actually governs the decision.
 */
export function minTrialsForZeroClaim(
  zeroClaimUpperBound: number = ZERO_CLAIM_UPPER_BOUND,
  z: number = Z95,
): number {
  for (let trials = 1; trials <= 10_000; trials += 1) {
    if ((wilson(0, trials, z).hi ?? 1) <= zeroClaimUpperBound) return trials;
  }
  return Number.POSITIVE_INFINITY;
}
