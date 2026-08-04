// @input  -- an injected Search Analytics client and a date window
// @output -- query rows and property totals, with paging and aggregation reported
// @pos    -- pure orchestration; the HTTP client is a seam supplied by apps/*
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { GscQueryRow } from "../site-baseline/types.ts";
import type {
  GscQueryClient,
  GscQueryResponse,
  GscReadPaging,
} from "./types.ts";
import type { GscWindow } from "./window.ts";

/** Search Analytics caps a single response at 25,000 rows. */
export const GSC_ROW_LIMIT = 25_000;

/**
 * Pages to fetch before giving up and declaring the read truncated.
 *
 * Four pages is 100,000 rows, well past what any property in this tool's
 * audience returns for one 28-day window. The cap exists so a large property
 * cannot hold a Search Console connection open indefinitely — Search Console
 * quota is counted per GCP project, so one visitor paging forever is spending
 * every other visitor's budget.
 */
export const GSC_MAX_PAGES = 4;

export interface ReadBudget {
  /**
   * Whether the request has run out of time.
   *
   * Checked before each page after the first. Without it the worst case is
   * GSC_MAX_PAGES sequential calls, each with its own timeout and its own
   * retry — four pages at 20s + backoff + 20s is roughly 164 seconds, well
   * past any platform function limit. Hitting that limit means the visitor
   * gets a bare platform 504 instead of a stable envelope, and the handler's
   * `finally` never runs to release the in-flight slot.
   */
  readonly isExpired: () => boolean;
}

export interface QueryRowsRead {
  readonly rows: readonly GscQueryRow[];
  readonly paging: GscReadPaging;
  readonly responseAggregationType: string | null;
}

/**
 * Read every query row for the window, paging until Search Console runs out.
 *
 * A failure part-way through pages is thrown, never swallowed into a partial
 * result. Rows come back ordered by clicks descending, so a prefix is not a
 * sample — it is systematically missing the low-click, high-impression queries
 * that a CTR gap table exists to find. Returning that prefix as if it were the
 * property would produce a confident answer computed from the wrong half.
 */
export async function readQueryRows(
  client: GscQueryClient,
  window: GscWindow,
  budget?: ReadBudget,
  /**
   * Pages this read may fetch, when the caller needs a tighter cap.
   *
   * `GSC_MAX_PAGES` was chosen for a caller that reads ONE window. A caller
   * reading two windows pays it twice, and the total is what the shared
   * project quota sees. Clamped to the shared cap so this can only tighten.
   */
  maxPages: number = GSC_MAX_PAGES,
): Promise<QueryRowsRead> {
  const rows: GscQueryRow[] = [];
  let pagesFetched = 0;
  let truncated = false;
  let responseAggregationType: string | null = null;
  const pageCap = Math.max(1, Math.min(GSC_MAX_PAGES, Math.trunc(maxPages)));

  for (let page = 0; page < pageCap; page += 1) {
    // The first page is always fetched — a report with no rows at all is not
    // a cheaper report, it is a different (and false) answer. Later pages are
    // dropped when the budget is gone, and the result says it was truncated.
    if (page > 0 && budget?.isExpired() === true) {
      truncated = true;
      break;
    }

    const response: GscQueryResponse = await client({
      dimensions: ["query"],
      startDate: window.startDate,
      endDate: window.endDate,
      rowLimit: GSC_ROW_LIMIT,
      startRow: page * GSC_ROW_LIMIT,
    });
    pagesFetched += 1;
    // Freeze the first page's basis; a later page that disagrees makes the
    // whole row set mixed. Overwriting per page kept only the LAST value, so
    // a first page of byPage rows followed by a byProperty page compared as
    // byProperty and the mixed sum was divided by a property total.
    if (page === 0) {
      responseAggregationType = response.responseAggregationType;
    } else if (response.responseAggregationType !== responseAggregationType) {
      responseAggregationType = null;
    }

    for (const raw of response.rows) {
      const query = raw.keys[0];
      // A row without its dimension key cannot be attributed to anything.
      // Keying it on undefined would create a phantom query that collides
      // with every other malformed row.
      if (query === undefined) continue;
      rows.push({
        query,
        clicks: raw.clicks,
        impressions: raw.impressions,
        position: raw.position,
      });
    }

    if (response.rows.length < GSC_ROW_LIMIT) break;
    // A full last page means there was more we did not ask for.
    if (page === pageCap - 1) truncated = true;
  }

  return {
    rows,
    paging: { pagesFetched, truncated },
    responseAggregationType,
  };
}

export interface PropertyTotals {
  readonly impressions: number;
  readonly clicks: number;
  /**
   * The basis Search Console actually aggregated this total by.
   *
   * Carried so the caller can refuse to divide it by a row sum computed on a
   * different basis. A quotient of two different measurements is a defect, not
   * an approximation.
   */
  readonly responseAggregationType: string | null;
}

/**
 * Read the property's own totals for the same window.
 *
 * Requested with no dimensions, which is one row and the cheapest call in the
 * plan. It exists to size the withheld remainder: the difference between this
 * and the sum of the query rows is what Search Console held back for privacy.
 *
 * Returns null when the property reported nothing. Returning zeros instead
 * would let the anonymization gap compute to a confident 0%, which is the one
 * answer we know to be wrong.
 */
export async function readPropertyTotals(
  client: GscQueryClient,
  window: GscWindow,
): Promise<PropertyTotals | null> {
  const response = await client({
    dimensions: [],
    startDate: window.startDate,
    endDate: window.endDate,
    rowLimit: 1,
    startRow: 0,
  });

  const row = response.rows[0];
  if (row === undefined) return null;

  return {
    impressions: row.impressions,
    clicks: row.clicks,
    responseAggregationType: response.responseAggregationType,
  };
}
