// @input  -- an impression count, an observed click count, and a baseline rate
// @output -- the lower-tail binomial probability of a result at least this weak
// @pos    -- the continuous disclosure number on every evidence-table row
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * P(X <= clicks) for X ~ Binomial(impressions, baselineCtr).
 *
 * WHAT THIS IS NOT: a significance test. The binomial model assumes every
 * impression is an independent trial with a fixed click probability, and
 * neither assumption holds for search. Impressions of one query share a SERP
 * layout, a device mix and a demand cycle, so they move together; and the
 * baseline rate is itself an estimate with its own uncertainty. Both errors
 * push the same way — this number reads as MORE unusual than the underlying
 * evidence supports.
 *
 * It is published as a continuous figure the visitor can weigh, never as a
 * threshold the engine acts on (v3.1 §二.1 层 1). Turning it into a
 * hit/no-hit decision needs the layer-2 machinery — leave-one-out plus
 * empirical-Bayes shrinkage plus FDR control — which v1 does not have.
 *
 * Returns null when the question is not defined (no impressions, or a baseline
 * outside 0..1).
 *
 * Computed entirely in log space. The obvious implementation seeds the
 * recurrence with P(X=0) = (1-p)^n and scales up from there, which silently
 * fails: once n·ln(1-p) drops below about -745 that seed underflows to
 * exactly 0, every subsequent term is 0·something, and the function returns 0
 * for EVERY click count — including counts at or above the mean. The threshold
 * is n > -745/ln(1-p), which is 2,089 impressions against a 30% baseline and
 * 14,526 against 5%: ordinary sizes for a top-of-page band. A query beating
 * its own site's curve would have come back as the strongest "unusual" signal
 * in the table.
 */
export function binomialLowerTail(
  impressions: number,
  clicks: number,
  baselineCtr: number,
): number | null {
  if (!Number.isFinite(impressions) || impressions <= 0) return null;
  if (!Number.isFinite(baselineCtr) || baselineCtr < 0 || baselineCtr > 1) {
    return null;
  }
  if (!Number.isFinite(clicks) || clicks < 0) return null;
  if (clicks >= impressions) return 1;

  // A baseline of exactly 0 makes every outcome except 0 clicks impossible;
  // a baseline of exactly 1 makes anything short of all-clicks impossible.
  if (baselineCtr === 0) return 1;
  if (baselineCtr === 1) return 0;

  const n = Math.floor(impressions);
  const k = Math.floor(clicks);

  // log P(X=i+1) - log P(X=i) = log(n-i) - log(i+1) + log(p) - log(1-p).
  // Every term stays a logarithm, so the smallest representable probability
  // is exp(-745) rather than the product of one.
  const logRatio = Math.log(baselineCtr) - Math.log1p(-baselineCtr);
  let logTerm = n * Math.log1p(-baselineCtr);

  // Streaming log-sum-exp: rescale the running sum whenever a larger term
  // arrives, so no array is held and no term is lost to underflow. The
  // binomial pmf is unimodal, so this rescales at most once per step up to
  // the mode and never after it.
  let maxLog = logTerm;
  let sum = 1;

  for (let i = 0; i < k; i += 1) {
    logTerm += Math.log(n - i) - Math.log(i + 1) + logRatio;
    if (logTerm > maxLog) {
      sum = sum * Math.exp(maxLog - logTerm) + 1;
      maxLog = logTerm;
    } else {
      sum += Math.exp(logTerm - maxLog);
    }
  }

  const total = Math.exp(maxLog) * sum;
  if (!Number.isFinite(total)) return 1;
  return total > 1 ? 1 : total;
}
