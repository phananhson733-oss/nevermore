// @input  -- the contract rows of one v3 run and the pressed reading order
// @output -- a new array in that order, with rows carrying no value always last
// @pos    -- the display-order rule behind the Marketing competitor gap results table's sort toggle

import type { CompetitorKeywordGapRow } from "@sf/public-tools/competitor-keyword-gap";

export const COMPETITOR_KEYWORD_GAP_SORTS = [
  "impressions",
  "position",
] as const;

export type CompetitorKeywordGapSort =
  (typeof COMPETITOR_KEYWORD_GAP_SORTS)[number];

/**
 * This keyword's own impressions, and nothing else.
 *
 * NOT falling back to the attributed page's impressions, which the report's
 * comparator does: that number is the page's total across every query it ranks
 * for, so a keyword with no measured impressions would outrank one with 400
 * under a control that says "sort by impressions". The page total answers a
 * different question and belongs to a different row.
 */
function impressions(row: CompetitorKeywordGapRow): number | null {
  return row.gsc.queryImpressions;
}

/** This keyword's own average position, for the same reason. */
function position(row: CompetitorKeywordGapRow): number | null {
  return row.gsc.queryPosition;
}

/**
 * What orders the rows the primary key cannot separate.
 *
 * It has to be a real quantity, not the keyword. A run with no Search Console
 * overlay -- which the tool offers its own button for -- has null impressions
 * and null position on EVERY row, so an alphabetical tie-break turned the whole
 * table into an A-Z list while the pressed toggle said "by impressions".
 * Provider search volume is the one number every row can have.
 */
function searchVolume(row: CompetitorKeywordGapRow): number | null {
  const { availability, value } = row.searchVolume;
  if (availability === "provider_no_data" || value === null) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * A row with no value sorts LAST, in either mode.
 *
 * Most rows in this tool have no Search Console evidence at all -- that absence
 * is what makes them gaps -- so an unknown left to sit among the small numbers
 * would put a row nothing is known about above a row that was measured.
 */
function compare(
  left: number | null,
  right: number | null,
  better: (left: number, right: number) => number,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return better(left, right);
}

const ORDER: Readonly<
  Record<
    CompetitorKeywordGapSort,
    {
      readonly value: (row: CompetitorKeywordGapRow) => number | null;
      readonly better: (left: number, right: number) => number;
    }
  >
> = {
  // Descending: the row the most people already saw comes first.
  impressions: { value: impressions, better: (left, right) => right - left },
  // ASCENDING, best position first: the row closest to page one is the one
  // worth acting on next, so a #4 must never sort below a #58.
  position: { value: position, better: (left, right) => left - right },
};

export function sortCompetitorKeywordGapRows(
  rows: readonly CompetitorKeywordGapRow[],
  sort: CompetitorKeywordGapSort,
): readonly CompetitorKeywordGapRow[] {
  const { value, better } = ORDER[sort];
  // `toSorted`: the contract order the caller holds is display state's to read,
  // never to rewrite.
  return rows.toSorted(
    (left, right) =>
      compare(value(left), value(right), better) ||
      compare(
        searchVolume(left),
        searchVolume(right),
        (leftVolume, rightVolume) => rightVolume - leftVolume,
      ) ||
      // Last, and only to make the order deterministic: without a final key two
      // renders of one run could disagree about which of two identical rows
      // comes first.
      left.keyword.localeCompare(right.keyword),
  );
}
