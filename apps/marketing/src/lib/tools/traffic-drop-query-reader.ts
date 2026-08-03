// @input  -- a granted property, the detected event, a deadline, and the visitor's token
// @output -- query rows and property totals for the two comparison windows, or null
// @pos    -- the optional half of a traffic-drop run; the report is complete without it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  latestFinalWindow,
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
 * Pages each query read may fetch.
 *
 * Deliberately below the shared `GSC_MAX_PAGES` of 4. The row reader's own cap
 * was written for a single-window tool; here there are TWO windows, and the
 * arithmetic that matters is the total: at 4 pages each, one run reaches 8 row
 * requests plus 2 totals, and one retry apiece doubles that to 20 HTTP calls
 * against quota counted per GCP project rather than per visitor.
 *
 * Two pages is 50,000 query rows per window, past anything the audience for a
 * free public tool has. A property beyond it reports `read_truncated` and the
 * split is withheld — which is the correct outcome anyway, since a prefix of
 * click-sorted rows systematically omits the long tail.
 */
export const QUERY_READ_MAX_PAGES = 2;

/**
 * Worst-case upstream HTTP calls for one run of this reader.
 *
 * Two windows x (QUERY_READ_MAX_PAGES row pages + 1 totals call), then doubled
 * because every attempt may retry once. This is the number the budget test
 * asserts against, and it is a real ceiling rather than the plan's happy path
 * — the previous constant said 4, counted only the logical reads, and its test
 * used single-page empty responses, so nothing in the suite would have noticed
 * a run issuing five times that.
 */
export const QUERY_READ_CALL_BUDGET = 2 * (QUERY_READ_MAX_PAGES + 1) * 2;

export interface TrafficDropQueryReadInput {
  readonly property: string;
  readonly changePoint: TrafficChangePoint;
  /** The run's clock. The later window is derived from it, not from the series. */
  readonly now: Date;
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
 * The later window ends on the last day Search Console has FINALISED, derived
 * from the Pacific clock — not on the last day of the daily series.
 *
 * Those are different days, and using the series end was a real defect. The
 * daily series is read with `dataState: all` on purpose, so a visitor can see
 * the event they came about; it therefore runs two to three days past
 * finalisation. These query reads use `dataState: final`. Anchoring a 28-day
 * window on the series end asked for 28 calendar days and got about 25 days of
 * data, while the earlier window got all 28 — every ratio biased downward by
 * roughly a tenth, for a reason nothing in the output would have shown. Worse,
 * the missing days lower the later window's coverage specifically, which is
 * the exact asymmetry the coverage-shift gate exists to catch; a shift of that
 * size can sit under the gate's threshold and ship as a confident number.
 *
 * The pair must also not overlap. An event too recent to have a clear 28 days
 * after it produces windows that share days, and a "before versus after" built
 * from overlapping spans measures some of the same traffic twice — it shrinks
 * every difference toward zero and reports the site as steadier than it is.
 */
export function comparisonWindows(
  changePoint: TrafficChangePoint,
  now: Date,
): { readonly before: Window; readonly after: Window } | null {
  const peak = changePoint.windows.find((window) => window.id === "peak");
  if (peak === undefined) return null;

  const before = windowEndingOn(peak.endDate);
  const after = latestFinalWindow(now, { lengthDays: QUERY_WINDOW_DAYS });
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
 * The four reads are issued concurrently so one window's latency does not
 * stack on the other's, and they share an AbortController: the first failure
 * cancels the rest.
 *
 * That cancellation is not tidiness. `Promise.all` rejects the moment one
 * member does, and without the signal the other three requests keep running —
 * including their retries — after this function has already returned null, the
 * handler has returned a 200, and the gate slot has been released. The caller
 * is then free to start another run while those calls are still in flight,
 * which is a per-visitor concurrency limit that does not limit concurrency,
 * and quota spent after the visitor already has their answer.
 *
 * A failure in any of them discards the whole result: a split computed from
 * one window's rows against the other window's missing totals is not a partial
 * answer, it is a wrong one.
 */
export function createTrafficDropQueryReader(options: {
  readonly accessToken: string;
  readonly remainingMs: () => number;
  /** Injected so a test can count upstream calls without a network. */
  readonly fetchImpl?: typeof fetch;
}): (input: TrafficDropQueryReadInput) => Promise<TrafficQueryEvidence | null> {
  return async ({ property, changePoint, now }) => {
    const windows = comparisonWindows(changePoint, now);
    if (windows === null) return null;

    const abort = new AbortController();
    const client = createSearchAnalyticsClient({
      siteUrl: property,
      accessToken: options.accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
      remainingMs: options.remainingMs,
      signal: abort.signal,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    const budget = { isExpired: () => options.remainingMs() <= 0 };

    try {
      const [beforeRows, beforeTotals, afterRows, afterTotals] =
        await Promise.all([
          readQueryRows(client, windows.before, budget, QUERY_READ_MAX_PAGES),
          readPropertyTotals(client, windows.before),
          readQueryRows(client, windows.after, budget, QUERY_READ_MAX_PAGES),
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
    } finally {
      // Cancels whatever is still in flight. Without it, a fast rejection from
      // one read leaves the other three running past the response and past the
      // gate release.
      abort.abort();
    }
  };
}
