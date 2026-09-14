/**
 * The GSC import boundary (T10 Step 1b, Q8): paste or file text in, the rows the
 * store keeps out, plus every count the import result has to disclose.
 *
 * `parseGsc` emits one row per record and does not dedupe: an export pasted
 * twice, or two exports pasted back to back, gives the same query several rows.
 * Every reader downstream would count them separately (the week page's
 * borderline list, the profile's GSC signals), and `GscRow` has no page,
 * country or date to tell a repeated paste from a second date range. So the
 * ruling is made once, here, and not re-made by each view:
 *
 * - One row per query, keyed by `normQ` — the key `buildRows` already dedupes
 *   the keyword matrix with (`keywords.ts` `dedupeByQuery`), so the table on the
 *   data-sources page and the overview's candidate count see the same queries.
 * - The FIRST occurrence is kept, verbatim. Nothing is summed and no position is
 *   weighted: summing doubles every click of a paste that was repeated, and a
 *   weighted average of two unknown date ranges describes no period at all. The
 *   repeats are counted into `skipped` and reported on their own
 *   (`duplicates`), so the operator can see what was dropped and why.
 * - A row whose query folds to nothing under `normQ` is dropped the way
 *   `buildRows` drops it, and counted into `skipped` (not into `duplicates`).
 *   `parseGsc` trims its queries, so no paste produces one today.
 * - The row cap applies after dedupe (a repeat must not take a unique row's
 *   place). Rows cut by the cap are not "skipped" — they parsed — and `parsed`
 *   keeps the uncapped count so the view can say how many were cut.
 *
 * The byte limit is a property of reading a file, not of parsing text; it lives
 * here only so the view and its test read one number.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
import type { GscRow } from "../types.ts";
import { parseGsc, type ParsedGsc } from "./gsc.ts";
import { normQ } from "./text.ts";

/** Rows kept from one import (Q8). */
export const GSC_IMPORT_MAX_ROWS = 5000;

/** Largest file read at all (Q8): 2 MB, in SI bytes so the "MB" label is exact. */
export const GSC_IMPORT_MAX_BYTES = 2_000_000;

export interface GscImport {
  /** What the store keeps: unique by `normQ`, first occurrence, at most the cap. */
  readonly rows: readonly GscRow[];
  /** Unique rows before the cap. `rows.length < parsed` means the cap cut some. */
  readonly parsed: number;
  /** Records that did not become a kept row: the parser's own skips, blank keys and duplicates. */
  readonly skipped: number;
  /** The part of `skipped` that repeated an earlier query. */
  readonly duplicates: number;
  readonly headerDetected: ParsedGsc["headerDetected"];
  readonly recognized: ParsedGsc["recognized"];
}

export interface DedupedGscRows {
  readonly rows: readonly GscRow[];
  readonly duplicates: number;
  /** Rows whose query `normQ` folds to the empty string. */
  readonly blank: number;
}

/** First occurrence of each `normQ` key wins; blank keys are dropped and counted apart. */
export function dedupeGscRows(rows: readonly GscRow[]): DedupedGscRows {
  const keys = rows.map((row) => normQ(row.query));
  // Reversed so the earliest index is the last one written for each key.
  const firstIndex = new Map(keys.map((key, index) => [key, index] as const).toReversed());
  const kept = rows.filter((_, index) => {
    const key = keys[index] ?? "";
    return key !== "" && firstIndex.get(key) === index;
  });
  const blank = keys.filter((key) => key === "").length;
  return { rows: kept, duplicates: rows.length - kept.length - blank, blank };
}

export function importGsc(text: string, maxRows: number = GSC_IMPORT_MAX_ROWS): GscImport {
  const parsed = parseGsc(text);
  const unique = dedupeGscRows(parsed.rows);
  return {
    rows: unique.rows.slice(0, maxRows),
    parsed: unique.rows.length,
    skipped: parsed.skipped + unique.blank + unique.duplicates,
    duplicates: unique.duplicates,
    headerDetected: parsed.headerDetected,
    recognized: parsed.recognized,
  };
}
