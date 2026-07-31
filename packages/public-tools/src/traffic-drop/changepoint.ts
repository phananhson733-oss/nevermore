import {
  addDays,
  daysBetween,
  indexByDate,
  lagInDays,
  median,
  rollingWindows,
  sortByDate,
  toTrafficWindow,
  TRAFFIC_MIN_HISTORY_DAYS,
  TRAFFIC_PEAK_MEDIAN_MULTIPLE,
  TRAFFIC_PEAK_MIN_CLICKS,
  TRAFFIC_PEAK_MIN_IMPRESSIONS,
  TRAFFIC_PRIOR_NORMAL_TOLERANCE,
  TRAFFIC_SUSTAIN_RATIO,
  TRAFFIC_SUSTAIN_WINDOW_COUNT,
  TRAFFIC_TROUGH_MAX_LAG_DAYS,
  TRAFFIC_UNFINALIZED_TAIL_DAYS,
  TRAFFIC_WINDOW_DAYS,
  windowEndingOn,
  type TrafficWindowTotals,
} from "./series.ts";
import type {
  TrafficChangePoint,
  TrafficDailyPoint,
  TrafficWindow,
} from "./types.ts";

const NO_EVENT: TrafficChangePoint = {
  state: "no_material_decline",
  windows: [],
  limitation: null,
};

/**
 * Baseline the peak is judged against.
 *
 * Uses the median of the windows BEFORE the candidate, not of the whole
 * series. A whole-series median moves as the decline itself accumulates: once
 * a collapse has lasted more than half the history, the median has fallen with
 * it and the peak no longer clears `2 x median`, so the tool goes quiet exactly
 * when the problem is worst.
 */
function priorMedian(
  windows: readonly TrafficWindowTotals[],
  candidate: TrafficWindowTotals,
): number {
  const prior = windows.filter(
    (window) => window.endDate < candidate.startDate,
  );
  return median((prior.length > 0 ? prior : windows).map((w) => w.clicks));
}

/**
 * The last window that qualifies as a peak, or null if none does.
 *
 * "Last" rather than "first" on ties: the peak we want is the final high point
 * before things turned, not an equally high week earlier in the plateau. A
 * window with no room for follow-ups after it is not a candidate — a peak at
 * the very end of the series describes growth, not a decline.
 */
function findPeak(
  windows: readonly TrafficWindowTotals[],
  lastDate: string,
): TrafficWindowTotals | null {
  let peak: TrafficWindowTotals | null = null;
  for (const window of windows) {
    if (daysBetween(window.endDate, lastDate) < TRAFFIC_WINDOW_DAYS) continue;
    if (window.impressions < TRAFFIC_PEAK_MIN_IMPRESSIONS) continue;
    const floor = Math.max(
      TRAFFIC_PEAK_MIN_CLICKS,
      priorMedian(windows, window) * TRAFFIC_PEAK_MEDIAN_MULTIPLE,
    );
    if (window.clicks < floor) continue;
    if (peak === null || window.clicks >= peak.clicks) peak = window;
  }
  return peak;
}

/** Non-overlapping whole calendar windows following the peak, within the lag budget. */
function followUpWindows(
  series: readonly TrafficDailyPoint[],
  peak: TrafficWindowTotals,
): readonly TrafficWindowTotals[] {
  const lookup = indexByDate(series);
  const windows: TrafficWindowTotals[] = [];
  for (
    let endDate = addDays(peak.endDate, TRAFFIC_WINDOW_DAYS);
    daysBetween(peak.endDate, endDate) <= TRAFFIC_TROUGH_MAX_LAG_DAYS;
    endDate = addDays(endDate, TRAFFIC_WINDOW_DAYS)
  ) {
    const totals = windowEndingOn(series, endDate, TRAFFIC_WINDOW_DAYS, lookup);
    if (!totals) break;
    if (lagInDays(peak, totals) > TRAFFIC_TROUGH_MAX_LAG_DAYS) break;
    windows.push(totals);
  }
  return windows;
}

/**
 * Whether the level after the event is simply the level before it.
 *
 * A retailer's Black Friday week towers over both November and January, and
 * returning to January is not a decline — it is the end of a promotion. If the
 * post-event weeks sit within the pre-peak normal range, the peak was a spike
 * and no decline is reported.
 */
function returnedToPriorNormal(
  windows: readonly TrafficWindowTotals[],
  peak: TrafficWindowTotals,
  followUps: readonly TrafficWindowTotals[],
): boolean {
  const prior = windows.filter((window) => window.endDate < peak.startDate);
  if (prior.length === 0 || followUps.length === 0) return false;

  const priorNormal = median(prior.map((window) => window.clicks));
  if (priorNormal === 0) return false;

  // "Back to normal" means back to that level, not merely above some fraction
  // of it: a site that settles at four times its old baseline came down from a
  // spike into a higher plateau, which is a different story and still worth
  // reporting on its own terms.
  const after = median(followUps.map((window) => window.clicks));
  return (
    after >= priorNormal * TRAFFIC_SUSTAIN_RATIO &&
    after <= priorNormal * TRAFFIC_PRIOR_NORMAL_TOLERANCE
  );
}

/**
 * Assemble the three windows the report is built on.
 *
 * `recent` is the last whole week in the series — what the reader is living
 * through — which coincides with the second follow-up on a fresh collapse and
 * diverges from it once the event is older. When `mid` and `recent` are the
 * same week the pair collapses to two windows rather than printing one twice.
 */
function buildWindows(
  series: readonly TrafficDailyPoint[],
  peak: TrafficWindowTotals,
  mid: TrafficWindowTotals,
  lastDate: string,
): readonly TrafficWindow[] {
  const recent = windowEndingOn(series, lastDate);
  if (!recent || recent.endDate === mid.endDate) {
    return [toTrafficWindow("peak", peak), toTrafficWindow("recent", mid)];
  }
  return [
    toTrafficWindow("peak", peak),
    toTrafficWindow("mid", mid),
    toTrafficWindow("recent", recent),
  ];
}

/**
 * Locate at most one recent decline and cut the comparison windows for it.
 *
 * Windows are chosen here and nowhere else. The tool does not accept a
 * caller-supplied window, because a window you pick is a conclusion you pick
 * (Owner 2026-07-31).
 *
 * The most recent days are dropped before anything is measured: Search Console
 * finalises data two to three days late, so the newest rows always read low.
 * Left in, they would bias every decline this tool reports.
 */
export function detectTrafficChangePoint(
  input: readonly TrafficDailyPoint[],
): TrafficChangePoint {
  const all = sortByDate(input);
  const newest = all[all.length - 1]?.date;
  const oldest = all[0]?.date;

  // The history gate asks "has this property existed long enough", which the
  // unfinalized tail does not change. Trimming is about which days we are
  // willing to measure, not about how old the site is.
  if (
    !newest ||
    !oldest ||
    daysBetween(oldest, newest) + 1 < TRAFFIC_MIN_HISTORY_DAYS
  ) {
    return {
      state: "insufficient_history",
      windows: [],
      limitation: "history_below_twelve_weeks",
    };
  }

  const series = all;
  const lastDate = newest;
  /**
   * The newest days are not dropped.
   *
   * Dropping them makes the tool blind to the event someone is opening it
   * about — a collapse three days old would produce "not enough history".
   * Instead the verdict is reported with the caveat attached: Search Console
   * finalises late, those days read low, and a reader deciding what to do
   * needs to know that the most recent window may revise upward.
   */
  const unfinalizedFrom = addDays(newest, -(TRAFFIC_UNFINALIZED_TAIL_DAYS - 1));

  const windows = rollingWindows(series);
  const peak = findPeak(windows, lastDate);
  if (!peak) {
    // Distinguish "nothing went wrong" from "this site is too small for the
    // detector to say anything". Both produce no event; only one of them means
    // the reader is fine.
    const belowFloor = windows.every(
      (window) =>
        window.clicks < TRAFFIC_PEAK_MIN_CLICKS ||
        window.impressions < TRAFFIC_PEAK_MIN_IMPRESSIONS,
    );
    return belowFloor
      ? {
          state: "no_material_decline",
          windows: [],
          limitation: "site_below_detection_floor",
        }
      : NO_EVENT;
  }

  const followUps = followUpWindows(series, peak);
  const mid = followUps[0];
  if (!mid) return NO_EVENT;

  const troughCeiling = peak.clicks * TRAFFIC_SUSTAIN_RATIO;
  const judged = followUps.slice(0, TRAFFIC_SUSTAIN_WINDOW_COUNT);
  const below = judged.filter((window) => window.clicks < troughCeiling);
  if (below.length === 0) return NO_EVENT;

  if (returnedToPriorNormal(windows, peak, followUps)) {
    return {
      state: "no_material_decline",
      windows: [],
      limitation: "returned_to_prior_normal",
    };
  }

  if (followUps.length < TRAFFIC_SUSTAIN_WINDOW_COUNT) {
    // The drop is real but the site has not lived long enough past it to say
    // whether it held. Reporting "sustained" here would be a guess, and
    // reporting "transient" would be a different guess.
    return {
      state: "insufficient_history",
      windows: buildWindows(series, peak, mid, lastDate),
      limitation: "post_event_history_below_two_windows",
    };
  }

  const sustained = below.length === judged.length;
  const windowsOut = buildWindows(series, peak, mid, lastDate);
  const touchesUnfinalized = windowsOut.some(
    (window) => window.endDate >= unfinalizedFrom,
  );

  return {
    state: sustained ? "sustained_decline" : "transient_visibility_anomaly",
    windows: windowsOut,
    limitation: sustained
      ? touchesUnfinalized
        ? "recent_window_unfinalized"
        : null
      : "recovery_observed_within_one_window",
  };
}
