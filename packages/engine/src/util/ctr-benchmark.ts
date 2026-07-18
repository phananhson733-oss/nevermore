/**
 * Search CTR benchmark table (spec §8.4). CTR below `benchmark(position) × 0.5`
 * for a page with enough impressions in positions 1–10 triggers SEARCH-CTR-004.
 * Average position is impression-weighted; rows with no impressions are excluded.
 */

/** Expected CTR at an average SERP position (1–10). Positions > 10 return null. */
export function ctrBenchmark(position: number): number | null {
  const rounded = Math.round(position);
  if (rounded <= 1) return 0.25;
  if (rounded === 2) return 0.15;
  if (rounded === 3) return 0.1;
  if (rounded <= 5) return 0.07;
  if (rounded <= 10) return 0.03;
  return null;
}

/** The CTR under-performance threshold: half the positional benchmark. */
export function ctrThreshold(position: number): number | null {
  const bench = ctrBenchmark(position);
  return bench === null ? null : bench * 0.5;
}
