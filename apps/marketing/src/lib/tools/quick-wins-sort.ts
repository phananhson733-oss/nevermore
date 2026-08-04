// @input  -- evidence rows and the column a visitor clicked
// @output -- a reordered copy, the next sort state, and the aria-sort value
// @pos    -- table interaction only; it reorders rows and computes nothing new
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { QuickWinEvidenceRow } from "@sf/public-tools";

/** Every column the evidence table renders, and nothing else. */
export type QuickWinsSortKey =
  | "query"
  | "position"
  | "impressions"
  | "clicks"
  | "observedCtr"
  | "baselineCtr"
  | "clickGap"
  | "tailProbability";

export type SortDirection = "asc" | "desc";

export interface QuickWinsSort {
  readonly key: QuickWinsSortKey;
  readonly direction: SortDirection;
}

/**
 * The order the engine already produced.
 *
 * The table opens on it so the first thing a visitor sees is the ranking the
 * report was written around, not a different reading of the same numbers.
 */
export const DEFAULT_SORT: QuickWinsSort = {
  key: "clickGap",
  direction: "desc",
};

/**
 * Collation for the one text column.
 *
 * `undefined` takes the runtime's locale, which in a browser is the visitor's
 * own — the right answer for a list of search queries they typed. `base`
 * sensitivity keeps "Apple" and "apple" adjacent instead of splitting the
 * alphabet in two by case.
 */
const COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/**
 * The comparable value, or null when there is not one.
 *
 * NaN is folded into null deliberately. It compares false against everything,
 * so leaving it in the comparison makes the comparator intransitive and the
 * resulting order arbitrary — the sort does not throw, it just quietly returns
 * something that is not sorted.
 */
function numericValue(
  row: QuickWinEvidenceRow,
  key: Exclude<QuickWinsSortKey, "query">,
): number | null {
  const raw = row[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

/**
 * Reorder a copy of the rows.
 *
 * Unavailable values sort last in both directions. A rate we could not compute
 * is not the smallest rate, and letting it fall to whichever end the direction
 * implies would put "we do not know" at the top of an ascending sort where it
 * reads as "these are the worst".
 *
 * Ties keep the order they arrived in — `Array.prototype.sort` is stable — so
 * sorting by a column full of equal values does not discard the engine's
 * ranking underneath it.
 */
export function sortEvidenceRows(
  rows: readonly QuickWinEvidenceRow[],
  sort: QuickWinsSort,
): readonly QuickWinEvidenceRow[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  if (sort.key === "query") {
    return [...rows].sort((a, b) => sign * COLLATOR.compare(a.query, b.query));
  }

  const key = sort.key;
  return [...rows].sort((a, b) => {
    const left = numericValue(a, key);
    const right = numericValue(b, key);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    if (left === right) return 0;
    return sign * (left - right);
  });
}

/**
 * What clicking `key` should do next.
 *
 * A fresh numeric column opens descending, because on every one of them the
 * large end is the end worth looking at first. Text opens A–Z. Clicking the
 * column already sorted reverses it.
 */
export function nextSort(
  current: QuickWinsSort,
  key: QuickWinsSortKey,
): QuickWinsSort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: key === "query" ? "asc" : "desc" };
}

/** The `aria-sort` value for one header cell. */
export function ariaSort(
  current: QuickWinsSort,
  key: QuickWinsSortKey,
): "ascending" | "descending" | "none" {
  if (current.key !== key) return "none";
  return current.direction === "asc" ? "ascending" : "descending";
}
