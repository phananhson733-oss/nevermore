// @input  -- one finished evidence row and the set of queries a draft was written for
// @output -- which of the five checking paths that row belongs to
// @pos    -- the triage layer: says what to check next, never whether the row is a problem
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { QuickWinEvidenceRow, QuickWinTrack } from "./types.ts";

/**
 * Every track, as a value.
 *
 * The type is a union, which no test can iterate. A surface that renders a
 * label per track fails at runtime on the one track nobody wrote copy for, and
 * only for the visitors whose data happens to produce it — so the list exists
 * so a test can check the copy is complete before a visitor does.
 */
export const QUICK_WIN_TRACKS = [
  "compare_with_own_page",
  "read_the_serp",
  "band_is_the_story",
  "gap_within_noise",
  "at_or_above_curve",
] as const satisfies readonly QuickWinTrack[];

/**
 * The shortfall a row needs before it is worth opening a tab for.
 *
 * One whole click. Below that the gap is smaller than the unit the underlying
 * measurement comes in: the row's own click count is an integer, so a
 * predicted-minus-observed difference of 0.4 means the two agree as closely as
 * a count of clicks is able to. Sending someone to inspect a search results
 * page over it spends their afternoon on rounding.
 *
 * Deliberately an absolute count and not a ratio. A ratio would rank a query
 * with 100 impressions and a 0.6-click gap alongside one with 40,000
 * impressions and a 240-click gap, and only one of those is worth a morning.
 */
export const MATERIAL_GAP_CLICKS = 1;

/**
 * Which checking path a row belongs to.
 *
 * Order matters, and it is the order of how much the classification is worth:
 *
 * 1. A row at or above the site's own rate has nothing to check. It is in the
 *    table as context — `buildEvidenceTable` keeps it deliberately — and a
 *    "next step" on it would be an instruction to fix something that is fine.
 * 2. A shortfall under one click is inside the noise of its own sample.
 * 3. A wording candidate outranks the band caveat. The caveat exists because a
 *    whole band earning under 1% makes per-query comparison inside it circular
 *    — but a candidate is precisely a page in that same band earning clearly
 *    more, which is the control the caveat says is missing.
 * 4. Otherwise the band caveat applies if the band is under 1%.
 * 5. Otherwise the row has a material shortfall, a healthy band, and no
 *    same-site control — the case where the missing information is the search
 *    results page, which the visitor can see and we cannot.
 */
export function trackForRow(
  row: QuickWinEvidenceRow,
  draftedQueries: ReadonlySet<string>,
): QuickWinTrack {
  // Positive assertion. A non-finite gap should never reach here — evidence.ts
  // drops those rows — but if one did, "at or above the curve" is the reading
  // that recommends nothing rather than the one that sends someone to work.
  if (!(Number.isFinite(row.clickGap) && row.clickGap > 0)) {
    return "at_or_above_curve";
  }
  if (row.clickGap < MATERIAL_GAP_CLICKS) return "gap_within_noise";
  if (draftedQueries.has(row.query)) return "compare_with_own_page";
  if (row.baselineBandUnderOnePercent) return "band_is_the_story";
  return "read_the_serp";
}

/** The same classification applied across the table, preserving row order. */
export function withTracks(
  rows: readonly QuickWinEvidenceRow[],
  draftedQueries: ReadonlySet<string>,
): readonly QuickWinEvidenceRow[] {
  return rows.map((row) => ({
    ...row,
    track: trackForRow(row, draftedQueries),
  }));
}

/** How many rows fall on each path. Every track is present, including at zero. */
export function trackCounts(
  rows: readonly QuickWinEvidenceRow[],
): Readonly<Record<QuickWinTrack, number>> {
  const counts: Record<QuickWinTrack, number> = {
    compare_with_own_page: 0,
    read_the_serp: 0,
    band_is_the_story: 0,
    gap_within_noise: 0,
    at_or_above_curve: 0,
  };
  for (const row of rows) counts[row.track] += 1;
  return counts;
}
