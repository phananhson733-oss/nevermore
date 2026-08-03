// @input  -- a granted property, the detected event, a deadline, and the visitor's token
// @output -- query rows and property totals for the two comparison windows, or null
// @pos    -- the optional half of a traffic-drop run; the report is complete without it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  readPropertyTotals,
  readQueryRows,
  shiftDate,
  type TrafficChangePoint,
  type TrafficQueryEvidence,
} from "@sf/public-tools";
import { createSearchAnalyticsClient } from "@sf/sources";

/** Per-call deadline for a single Search Console request. */
const READ_TIMEOUT_MS = 15_000;

/**
 * Length of each comparison window, in days.
 *
 * Deliberately wider than the detector's 7-day windows. Query-dimension
 * coverage scales with volume: over seven days most of a small property's
 * queries sit under Search Console's anonymization threshold and never appear,
 * so a 7-day split would be computed on a fraction of the site and would fail
 * its own coverage gate on properties where it would otherwise be useful.
 * Twenty-eight days is the same length every other window in this codebase
 * uses, which keeps the two connected tools comparable.
 */
export const QUERY_WINDOW_DAYS = 28;

/**
 * Upstream calls this reader is allowed to make.
 *
 * Two windows, each needing its query rows and its property totals. Paging can
 * multiply the row reads, which is what the shared deadline is for; this cap
 * is about the plan, not the retries. Search Console quota is counted per GCP
 * project rather than per visitor, so an unbounded plan here is spent out of
 * every other visitor's budget.
 */
export const QUERY_READ_CALL_BUDGET = 4;

export interface TrafficDropQueryReadInput {
  readonly property: string;
  readonly changePoint: TrafficChangePoint;
  /** Last day of the series, which is already a finalised day. */
  readonly seriesEndDate: string;
}

interface Window {
  readonly startDate: string;
  readonly endDate: string;
}

function windowEndingOn(endDate: string): Window {
  // Inclusive on both ends, so a 28-day window spans 27 shifts.
  return { startDate: shiftDate(endDate, -(QUERY_WINDOW_DAYS - 1)), endDate };
}

/**
 * The two windows to compare, or null when there is nothing to compare.
 *
 * The pair must not overlap. An event too recent to have 28 clear days after
 * it produces windows that share days, and a "before versus after" built from
 * overlapping spans measures partly the same traffic twice — it would shrink
 * every difference toward zero and report the site as steadier than it is.
 */
export function comparisonWindows(
  changePoint: TrafficChangePoint,
  seriesEndDate: string,
): { readonly before: Window; readonly after: Window } | null {
  const peak = changePoint.windows.find((window) => window.id === "peak");
  if (peak === undefined) return null;

  const before = windowEndingOn(peak.endDate);
  const after = windowEndingOn(seriesEndDate);
  if (after.startDate <= before.endDate) return null;

  return { before, after };
}

/**
 * Read the query dimension for both windows.
 *
 * Returns null rather than throwing on anything that goes wrong. This evidence
 * is an attachment to a report that is already complete without it: a visitor
 * whose property has an unreadable query dimension should get their decline
 * analysis and a `not_available` on two checks, not a 502.
 *
 * The four reads are issued as two concurrent pairs so one window's latency
 * does not stack on the other's. A failure in any of them discards the whole
 * result: a split computed from one window's rows against the other window's
 * missing totals is not a partial answer, it is a wrong one.
 */
export function createTrafficDropQueryReader(options: {
  readonly accessToken: string;
  readonly remainingMs: () => number;
  /** Injected so a test can count upstream calls without a network. */
  readonly fetchImpl?: typeof fetch;
}): (input: TrafficDropQueryReadInput) => Promise<TrafficQueryEvidence | null> {
  return async ({ property, changePoint, seriesEndDate }) => {
    const windows = comparisonWindows(changePoint, seriesEndDate);
    if (windows === null) return null;

    const client = createSearchAnalyticsClient({
      siteUrl: property,
      accessToken: options.accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
      remainingMs: options.remainingMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    const budget = { isExpired: () => options.remainingMs() <= 0 };

    try {
      const [beforeRows, beforeTotals, afterRows, afterTotals] =
        await Promise.all([
          readQueryRows(client, windows.before, budget),
          readPropertyTotals(client, windows.before),
          readQueryRows(client, windows.after, budget),
          readPropertyTotals(client, windows.after),
        ]);

      return {
        before: {
          startDate: windows.before.startDate,
          endDate: windows.before.endDate,
          rows: beforeRows.rows,
          paging: beforeRows.paging,
          queryAggregation: beforeRows.responseAggregationType,
          totals: beforeTotals,
        },
        after: {
          startDate: windows.after.startDate,
          endDate: windows.after.endDate,
          rows: afterRows.rows,
          paging: afterRows.paging,
          queryAggregation: afterRows.responseAggregationType,
          totals: afterTotals,
        },
      };
    } catch (error) {
      // Deliberately swallowed: the caller reports `query_read_not_performed`,
      // which is the truth and is distinguishable from "we looked and found
      // nothing" everywhere it is rendered.
      //
      // But swallowed is not the same as silent. A soft-failing path with no
      // record of WHY leaves a production diagnosis with nothing but a status
      // code to go on, and the reason — a 429 against shared project quota, a
      // timeout, an expired grant — decides which of those is a capacity
      // problem and which is a bug. No query text is logged; the windows are
      // dates and the property is already in the request.
      console.error(
        "[traffic-drop] query evidence unavailable:",
        JSON.stringify({
          before: windows.before,
          after: windows.after,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return null;
    }
  };
}
