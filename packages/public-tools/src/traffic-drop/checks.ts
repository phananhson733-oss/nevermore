import { SEASONALITY_MIN_DAYS } from "./findings.ts";
import { daysBetween } from "./series.ts";
import type {
  TrafficChangePoint,
  TrafficCheck,
  TrafficDailyPoint,
  TrafficFinding,
  TrafficFindingId,
} from "./types.ts";

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
  const undecidable = changePoint.state === "insufficient_history";
  const belowFloor = changePoint.limitation === "site_below_detection_floor";
  const windowLevelUnavailable = undecidable
    ? "history_below_twelve_weeks"
    : belowFloor
      ? "site_below_detection_floor"
      : null;

  const recent = changePoint.windows.find((window) => window.id === "recent");
  const tail = series.slice(-7);
  const tailImpressions = tail.reduce((total, day) => total + day.impressions, 0);

  const first = series[0]?.date;
  const last = series[series.length - 1]?.date;
  const span = first && last ? daysBetween(first, last) + 1 : 0;

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
      : check("decline_concentration", "not_available", "query_data_not_supplied"),
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
    span >= SEASONALITY_MIN_DAYS
      ? check("seasonality_yoy", hit("seasonality_unavailable") ? "hit" : "clear")
      : check("seasonality_yoy", "not_available", "history_below_thirteen_months"),
    // Search Console's index report always trails the Search Analytics series,
    // so a technical read of the event days is never available in-tool.
    check("index_status_at_event", "not_available", "index_report_lag"),
  ];
}
