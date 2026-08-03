// @input  -- an injected Search Analytics client and a date window
// @output -- page rows, query-by-page rows, and how much of each query the split covers
// @pos    -- the page dimension, kept separate because it is not an expansion of the query one
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { GscQueryRow } from "../site-baseline/types.ts";
import { GSC_MAX_PAGES, GSC_ROW_LIMIT, type ReadBudget } from "./reader.ts";
import type { GscQueryClient, GscReadPaging } from "./types.ts";
import type { GscWindow } from "./window.ts";

export { GSC_ROW_LIMIT };

/**
 * Coverage a query's page split must reach before anything reads it as complete.
 *
 * Search Console drops rows when a query is grouped by page — it returns the
 * top rows under an internal limit, ordered by clicks descending, and paging
 * does NOT recover what it dropped. So `[query,page]` is not an additive
 * expansion of `[query]`: the parts can sum to less than the whole, and the
 * difference is invisible without measuring it.
 *
 * Anything that depends on "these rows are all of them" — which page carries a
 * query, whether one page dominates — has to check this first. 0.8 leaves room
 * for the rounding Search Console applies without admitting a split that is
 * missing a fifth of the query.
 */
export const MIN_DIMENSION_COVERAGE = 0.8;

export interface GscPageRow {
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

export interface GscQueryPageRow {
  readonly query: string;
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

interface PagedRead<T> {
  readonly rows: readonly T[];
  readonly paging: GscReadPaging;
  readonly responseAggregationType: string | null;
}

/**
 * Shared paging loop.
 *
 * `map` returns null for a row that cannot be attributed — a missing dimension
 * key. Keying such a row on `undefined` would invent an entity that collides
 * with every other malformed row in the set.
 */
async function readPaged<T>(
  client: GscQueryClient,
  window: GscWindow,
  dimensions: readonly ("query" | "page")[],
  map: (keys: readonly string[], row: { clicks: number; impressions: number; position: number }) => T | null,
  budget?: ReadBudget,
): Promise<PagedRead<T>> {
  const rows: T[] = [];
  let pagesFetched = 0;
  let truncated = false;
  let responseAggregationType: string | null = null;

  for (let page = 0; page < GSC_MAX_PAGES; page += 1) {
    if (page > 0 && budget?.isExpired() === true) {
      truncated = true;
      break;
    }

    const response = await client({
      dimensions,
      startDate: window.startDate,
      endDate: window.endDate,
      rowLimit: GSC_ROW_LIMIT,
      startRow: page * GSC_ROW_LIMIT,
    });
    pagesFetched += 1;
    // Freeze the first page's basis; a later page that disagrees makes the
    // whole set mixed and unusable as a denominator.
    if (page === 0) {
      responseAggregationType = response.responseAggregationType;
    } else if (response.responseAggregationType !== responseAggregationType) {
      responseAggregationType = null;
    }

    for (const raw of response.rows) {
      const mapped = map(raw.keys, raw);
      if (mapped !== null) rows.push(mapped);
    }

    if (response.rows.length < GSC_ROW_LIMIT) break;
    if (page === GSC_MAX_PAGES - 1) truncated = true;
  }

  return { rows, paging: { pagesFetched, truncated }, responseAggregationType };
}

/** Property pages for the window, one row each. */
export function readPageRows(
  client: GscQueryClient,
  window: GscWindow,
  budget?: ReadBudget,
): Promise<PagedRead<GscPageRow>> {
  return readPaged(
    client,
    window,
    ["page"],
    (keys, row) => {
      const page = keys[0];
      if (page === undefined) return null;
      return {
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      };
    },
    budget,
  );
}

/**
 * The query-by-page split.
 *
 * The most expensive shape Search Console offers and the one it drops rows
 * from most readily. Always paired with `queryPageCoverage` before anything
 * treats a page as "the" page for a query.
 */
export function readQueryPageRows(
  client: GscQueryClient,
  window: GscWindow,
  budget?: ReadBudget,
): Promise<PagedRead<GscQueryPageRow>> {
  return readPaged(
    client,
    window,
    ["query", "page"],
    (keys, row) => {
      const query = keys[0];
      const page = keys[1];
      if (query === undefined || page === undefined) return null;
      return {
        query,
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      };
    },
    budget,
  );
}

/**
 * How much of each query's impressions the page split accounts for.
 *
 * Null means the question is not answerable for that query: either it had no
 * impressions to divide, or the split sums to MORE than the query total, which
 * is not 120% coverage but two readings that disagree. Both are reported as
 * unavailable rather than as a number, so a caller cannot mistake a
 * contradiction for a measurement.
 */
export function queryPageCoverage(
  queryRows: readonly GscQueryRow[],
  queryPageRows: readonly GscQueryPageRow[],
): ReadonlyMap<string, number | null> {
  const splitByQuery = new Map<string, number>();
  for (const row of queryPageRows) {
    if (!Number.isFinite(row.impressions)) continue;
    splitByQuery.set(
      row.query,
      (splitByQuery.get(row.query) ?? 0) + row.impressions,
    );
  }

  const coverage = new Map<string, number | null>();
  for (const row of queryRows) {
    if (!(Number.isFinite(row.impressions) && row.impressions > 0)) {
      coverage.set(row.query, null);
      continue;
    }
    const split = splitByQuery.get(row.query) ?? 0;
    const ratio = split / row.impressions;
    coverage.set(row.query, ratio > 1 ? null : ratio);
  }
  return coverage;
}
