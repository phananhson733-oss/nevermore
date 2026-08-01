import { SEASONALITY_MIN_DAYS } from "./findings.ts";
import {
  addDays,
  historySpanDays,
  TRAFFIC_UNFINALIZED_TAIL_DAYS,
} from "./series.ts";
import type {
  TrafficChangePoint,
  TrafficCheck,
  TrafficDailyPoint,
  TrafficFinding,
  TrafficFindingId,
  TrafficUnavailableReason,
} from "./types.ts";

/** Calendar days of recent visibility the zeroed-visibility check judges on. */
const TAIL_DAYS = 7;

/**
 * Every check the run performs, in report order.
 *
 * The list is fixed and always rendered in full, including the checks that
 * found nothing and the ones that could not run. Publishing only the hits
 * would let a report that examined four things read as if it had examined
 * everything — and the checks that could not run are often the ones the reader
 * most needs to know about, because that is where they have to go looking with
 * data this tool cannot reach.
 *
 * The invariant that matters here: `clear` means "we ran this check and found
 * nothing". A check that could not run reports `not_available` with a reason,
 * never `clear`. Getting this wrong tells a de-indexed site it is healthy.
 */
export const TRAFFIC_CHECK_IDS = [
  "sustained_decline",
  "ctr_changepoint",
  "transient_visibility_anomaly",
  "decline_concentration",
  "affected_page_availability",
  "sitewide_visibility_zeroed",
  "single_page_dominated_decline",
  "seasonality_yoy",
  "index_status_at_event",
] as const;

export type TrafficCheckId = (typeof TRAFFIC_CHECK_IDS)[number];

/** Optional evidence the daily series alone cannot provide. */
export interface TrafficCheckInputs {
  /** Query-dimension rows were fetched and analysed. */
  readonly hasQueryData: boolean;
  /** Page-dimension rows were fetched and analysed. */
  readonly hasPageData: boolean;
  /** Affected pages were fetched; true only when every probe responded. */
  readonly pageProbes: {
    readonly ran: boolean;
    readonly allHealthy: boolean;
  } | null;
  /** One page carried most of the loss, when page data was analysed. */
  readonly singlePageDominated: boolean | null;
}

const NO_EXTRA_INPUTS: TrafficCheckInputs = {
  hasQueryData: false,
  hasPageData: false,
  pageProbes: null,
  singlePageDominated: null,
};

function check(
  id: TrafficCheckId,
  status: TrafficCheck["status"],
  unavailableReason: TrafficCheck["unavailableReason"] = null,
): TrafficCheck {
  return { id, status, unavailableReason };
}

export interface TrafficCheckContext {
  readonly changePoint: TrafficChangePoint;
  readonly findings: readonly TrafficFinding[];
  readonly series: readonly TrafficDailyPoint[];
  /**
   * The day the run happened, as YYYY-MM-DD.
   *
   * Needed because "is this property still visible" is a question about NOW,
   * and the series cannot answer it alone: a property that went dark stops
   * producing rows, so its last row is the last day it was healthy. Without an
   * outside clock the check reads that row and reports good news.
   */
  readonly runDate: string;
  readonly inputs?: TrafficCheckInputs;
}

export function buildTrafficChecks(
  context: TrafficCheckContext,
): readonly TrafficCheck[] {
  const { changePoint, findings, series } = context;
  const inputs = context.inputs ?? NO_EXTRA_INPUTS;
  const found = new Set<TrafficFindingId>(findings.map((entry) => entry.id));
  const hit = (id: TrafficFindingId) => found.has(id);

  // A run that could not reach a verdict did not "find nothing" — the
  // window-level checks never ran at all.
  //
  // Which reason is dispatched on the LIMITATION, not on the state alone.
  // `insufficient_history` has two sources: a property that has not existed
  // for twelve weeks, and a property that has, but whose event is too recent
  // to judge. Collapsing both into "needs twelve weeks of history" told the
  // owner of a two-year-old site something about their own data they could see
  // was untrue, on the same screen where the limitation box said otherwise.
  const undecidable = changePoint.state === "insufficient_history";
  const windowLevelUnavailable: TrafficUnavailableReason | null = undecidable
    ? changePoint.limitation === "post_event_history_below_two_windows"
      ? "post_event_history_below_two_windows"
      : "history_below_twelve_weeks"
    : changePoint.limitation === "site_below_detection_floor"
      ? "site_below_detection_floor"
      : null;

  const recent = changePoint.windows.find((window) => window.id === "recent");

  // The visibility tail is cut by CALENDAR DAY against the RUN DATE, never by
  // row position and never against the last row.
  //
  // `slice(-7)` returned the last seven ROWS. A property that went dark stops
  // producing rows at all, so its last seven rows are the last seven days it
  // was healthy — and the check announced "the property still records
  // impressions" about a site that had recorded nothing for a month. Anchoring
  // to the last row instead of to today has the same flaw for the same reason:
  // the series cannot tell you it stopped.
  //
  // The window ends where Search Console's data can be expected to reach —
  // finalisation runs two to three days behind, and demanding rows closer to
  // today than that would call every healthy site dark. Missing days inside
  // the window are the evidence, not the absence of it.
  const tailEnd = addDays(context.runDate, -TRAFFIC_UNFINALIZED_TAIL_DAYS);
  const tailStart = addDays(tailEnd, -(TAIL_DAYS - 1));
  const tail = series.filter(
    (day) => day.date >= tailStart && day.date <= tailEnd,
  );
  const tailImpressions = tail.reduce(
    (total, day) => total + day.impressions,
    0,
  );

  const span = historySpanDays(series);

  return [
    windowLevelUnavailable
      ? check("sustained_decline", "not_available", windowLevelUnavailable)
      : check(
          "sustained_decline",
          changePoint.state === "sustained_decline" ? "hit" : "clear",
        ),
    windowLevelUnavailable
      ? check("ctr_changepoint", "not_available", windowLevelUnavailable)
      : check("ctr_changepoint", hit("two_stage_decline") ? "hit" : "clear"),
    // The day-level anomaly needs only four weeks of same-weekday baseline, so
    // it can run on histories the window-level checks cannot.
    span < 5 * 7
      ? check(
          "transient_visibility_anomaly",
          "not_available",
          "history_below_twelve_weeks",
        )
      : check(
          "transient_visibility_anomaly",
          hit("transient_visibility_anomaly") ? "hit" : "clear",
        ),
    inputs.hasQueryData
      ? check(
          "decline_concentration",
          hit("decline_concentration") ? "hit" : "clear",
        )
      : check(
          "decline_concentration",
          "not_available",
          "query_data_not_supplied",
        ),
    inputs.pageProbes?.ran
      ? check(
          "affected_page_availability",
          inputs.pageProbes.allHealthy ? "clear" : "hit",
        )
      : check(
          "affected_page_availability",
          "not_available",
          "probe_data_not_supplied",
        ),
    // Judged on the raw tail, not on a comparison window: a property that lost
    // all visibility has no window to build, and reporting "clear" because the
    // window is missing is exactly backwards.
    tail.length === 0
      ? check("sitewide_visibility_zeroed", "not_available", "no_recent_days")
      : check(
          "sitewide_visibility_zeroed",
          tailImpressions === 0 || recent?.impressions === 0 ? "hit" : "clear",
        ),
    inputs.hasPageData && inputs.singlePageDominated !== null
      ? check(
          "single_page_dominated_decline",
          inputs.singlePageDominated ? "hit" : "clear",
        )
      : check(
          "single_page_dominated_decline",
          "not_available",
          "page_data_not_supplied",
        ),
    // Never `clear`. Above thirteen months this used to report "we checked
    // year-over-year and found nothing", but there is no year-over-year
    // comparison in this engine for it to have found anything with:
    // `detectSeasonalityBoundary` returns null once the history is long
    // enough, so the `hit` branch was unreachable and `clear` was a rubber
    // stamp on a check that never ran — the exact thing the invariant at the
    // top of this file forbids. Which honest reason applies still depends on
    // the history.
    span >= SEASONALITY_MIN_DAYS
      ? check(
          "seasonality_yoy",
          "not_available",
          "yoy_comparison_not_implemented",
        )
      : check(
          "seasonality_yoy",
          "not_available",
          "history_below_thirteen_months",
        ),
    // Search Console's index report always trails the Search Analytics series,
    // so a technical read of the event days is never available in-tool.
    check("index_status_at_event", "not_available", "index_report_lag"),
  ];
}
