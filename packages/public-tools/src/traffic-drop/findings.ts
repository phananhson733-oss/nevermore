import {
  addDays,
  daysBetween,
  historySpanDays,
  median,
  sortByDate,
  TRAFFIC_UNFINALIZED_TAIL_DAYS,
  TRAFFIC_WINDOW_DAYS,
} from "./series.ts";
import type {
  TrafficChangePoint,
  TrafficDailyPoint,
  TrafficFinding,
  TrafficWindow,
} from "./types.ts";

/**
 * Frozen finding thresholds (v3.1 §3.3).
 *
 * The two-stage pair is the one that matters most: on the reference series the
 * first stage lost 59% of clicks while impressions moved 4%, and the second
 * stage lost 73% of impressions while CTR recovered. Reporting that as a single
 * -81% event sends the reader to fix the wrong thing.
 */
export const TWO_STAGE_CLICK_DROP_MIN = 0.3;
/** Above this, impressions did move, and the stage is not "visibility held". */
export const TWO_STAGE_IMPRESSION_HOLD_MAX = 0.15;
export const TWO_STAGE_IMPRESSION_DROP_MIN = 0.3;
/** A spike day must stand out from the period, not merely be the maximum. */
export const SPIKE_DAY_IMPRESSION_MULTIPLE = 1.5;
/** ...and must convert far below the peak week to be worth reporting. */
export const SPIKE_DAY_CTR_RATIO_MAX = 0.5;
/** A day under a fifth of its own baseline is an outage-shaped day, not a slow day. */
export const ANOMALY_DAY_IMPRESSION_RATIO = 0.2;
/**
 * The baseline is the median of the same weekday over the preceding weeks —
 * never the trailing 7-day mean.
 *
 * Many sites (B2B especially) lose most of their weekend traffic every week. A
 * trailing-mean baseline calls that an anomaly every Saturday; a same-weekday
 * baseline compares Saturday with Saturdays and stays quiet, while still
 * catching a Monday that fell off a cliff.
 */
export const ANOMALY_BASELINE_WEEKS = 4;
/** Longer than this is not "an anomaly", it is the decline itself. */
export const ANOMALY_MAX_DAYS = 3;
/** Recovery is measured against the last normal day before the run, not the baseline. */
export const ANOMALY_REBOUND_RATIO = 0.5;
/** Thirteen months: a year-over-year read needs the same season last year. */
export const SEASONALITY_MIN_DAYS = 395;

/** Relative change from `from` to `to`. Null when the base is 0. */
function change(from: number, to: number): number | null {
  if (from === 0) return null;
  return (to - from) / from;
}

function windowById(
  windows: readonly TrafficWindow[],
  id: TrafficWindow["id"],
): TrafficWindow | undefined {
  return windows.find((window) => window.id === id);
}

/**
 * Two stages with different mechanics: clicks collapse while impressions hold,
 * then impressions collapse in turn.
 */
function detectTwoStageDecline(
  changePoint: TrafficChangePoint,
): TrafficFinding | null {
  // Only a decision the detector actually reached can carry an `observed`
  // finding. Publishing "this is two declines" off windows the detector
  // labelled transient — or could not judge at all — would state as fact
  // something the run explicitly declined to conclude.
  if (changePoint.state !== "sustained_decline") return null;
  const peak = windowById(changePoint.windows, "peak");
  const mid = windowById(changePoint.windows, "mid");
  const recent = windowById(changePoint.windows, "recent");
  if (!peak || !mid || !recent) return null;

  const clickDropStageOne = change(peak.clicks, mid.clicks);
  const impressionChangeStageOne = change(peak.impressions, mid.impressions);
  const impressionDropStageTwo = change(mid.impressions, recent.impressions);
  if (
    clickDropStageOne === null ||
    impressionChangeStageOne === null ||
    impressionDropStageTwo === null
  ) {
    return null;
  }

  const clicksCollapsed = clickDropStageOne <= -TWO_STAGE_CLICK_DROP_MIN;
  const impressionsHeld =
    Math.abs(impressionChangeStageOne) <= TWO_STAGE_IMPRESSION_HOLD_MAX;
  const impressionsThenCollapsed =
    impressionDropStageTwo <= -TWO_STAGE_IMPRESSION_DROP_MIN;
  if (!clicksCollapsed || !impressionsHeld || !impressionsThenCollapsed) {
    return null;
  }

  return {
    id: "two_stage_decline",
    tier: "observed",
    measures: [
      { key: "stage_one_clicks_change", value: clickDropStageOne },
      { key: "stage_one_impressions_change", value: impressionChangeStageOne },
      { key: "stage_two_impressions_change", value: impressionDropStageTwo },
      { key: "peak_ctr", value: peak.ctr },
      { key: "mid_ctr", value: mid.ctr },
      { key: "recent_ctr", value: recent.ctr },
      { key: "total_clicks_change", value: change(peak.clicks, recent.clicks) },
      {
        key: "total_impressions_change",
        value: change(peak.impressions, recent.impressions),
      },
    ],
    queries: [],
    hypothesis: null,
    limitation: null,
  };
}

/** A single decline, when the two stages did not separate. */
function detectSingleStageDecline(
  changePoint: TrafficChangePoint,
): TrafficFinding | null {
  if (changePoint.state !== "sustained_decline") return null;
  const peak = windowById(changePoint.windows, "peak");
  const recent = windowById(changePoint.windows, "recent");
  if (!peak || !recent) return null;

  return {
    id: "sustained_decline",
    tier: "observed",
    measures: [
      { key: "peak_clicks", value: peak.clicks },
      { key: "recent_clicks", value: recent.clicks },
      { key: "total_clicks_change", value: change(peak.clicks, recent.clicks) },
      {
        key: "total_impressions_change",
        value: change(peak.impressions, recent.impressions),
      },
    ],
    queries: [],
    hypothesis: null,
    limitation: null,
  };
}

/**
 * The day that drew the most impressions of the whole event window while
 * converting far below the peak week.
 *
 * This is what lets the reader see that a stage-one CTR collapse can happen
 * with no ranking change at all: a different, lower-intent set of queries
 * arrived. The engine states the arithmetic and offers the influx as a
 * hypothesis; Search Console cannot confirm it.
 */
function detectHighImpressionLowClickDay(
  series: readonly TrafficDailyPoint[],
  changePoint: TrafficChangePoint,
): TrafficFinding | null {
  const peak = windowById(changePoint.windows, "peak");
  const recent = windowById(changePoint.windows, "recent");
  if (!peak || !recent || peak.ctr === null) return null;

  const period = series.filter(
    (day) => day.date >= peak.startDate && day.date <= recent.endDate,
  );
  if (period.length === 0) return null;

  const top = period.reduce((best, day) =>
    day.impressions > best.impressions ? day : best,
  );
  if (top.impressions === 0) return null;

  const meanImpressions =
    period.reduce((total, day) => total + day.impressions, 0) / period.length;
  const standsOut =
    top.impressions >= meanImpressions * SPIKE_DAY_IMPRESSION_MULTIPLE;
  const dayCtr = top.clicks / top.impressions;
  const convertsPoorly = dayCtr < peak.ctr * SPIKE_DAY_CTR_RATIO_MAX;
  if (!standsOut || !convertsPoorly) return null;

  return {
    id: "high_impression_low_click_day",
    tier: "observed",
    measures: [
      { key: "date", value: top.date },
      { key: "impressions", value: top.impressions },
      { key: "clicks", value: top.clicks },
      { key: "day_ctr", value: dayCtr },
      { key: "peak_window_ctr", value: peak.ctr },
    ],
    queries: [],
    hypothesis: "low_intent_query_influx",
    limitation: null,
  };
}

/**
 * Median impressions on the same weekday over the preceding weeks, or null when
 * those weeks are not all present.
 *
 * Indexed by DATE, not by array position: Search Console omits days a property
 * drew nothing, and an index-based lookback silently compares a Saturday with a
 * Wednesday the moment one row is missing — which is exactly how a normal
 * weekend becomes a reported outage.
 */
function sameWeekdayBaseline(
  byDate: ReadonlyMap<string, TrafficDailyPoint>,
  date: string,
): number | null {
  const samples: number[] = [];
  for (let week = 1; week <= ANOMALY_BASELINE_WEEKS; week += 1) {
    const day = byDate.get(addDays(date, -week * TRAFFIC_WINDOW_DAYS));
    if (!day) return null;
    samples.push(day.impressions);
  }
  return median(samples);
}

/** True when the day sits far below what that weekday normally draws. */
function isCollapsedDay(
  byDate: ReadonlyMap<string, TrafficDailyPoint>,
  date: string,
): boolean {
  const baseline = sameWeekdayBaseline(byDate, date);
  if (baseline === null || baseline === 0) return false;
  const day = byDate.get(date);
  return (
    day !== undefined &&
    day.impressions < baseline * ANOMALY_DAY_IMPRESSION_RATIO
  );
}

/**
 * One to three consecutive days that fell off a cliff and then came back.
 *
 * Reported apart from the decline on purpose: a two-day dip that recovered is
 * not evidence of a sustained problem, and merging the two would let a blip
 * inflate the headline.
 */
function detectTransientDayAnomaly(
  series: readonly TrafficDailyPoint[],
): TrafficFinding | null {
  const byDate = new Map(series.map((day) => [day.date, day]));

  for (let index = series.length - 1; index >= 0; index -= 1) {
    const day = series[index];
    if (!day || !isCollapsedDay(byDate, day.date)) continue;

    // Walk back over the contiguous run of collapsed days, by date.
    let startDate = day.date;
    while (isCollapsedDay(byDate, addDays(startDate, -1))) {
      startDate = addDays(startDate, -1);
    }

    const runLength = daysBetween(startDate, day.date) + 1;
    const after = byDate.get(addDays(day.date, 1));
    // Recovery is judged against the last normal day before the run: the
    // question is whether traffic came back to where it was, not whether it
    // beat a baseline that a site-wide decline has already left behind.
    const before = byDate.get(addDays(startDate, -1));
    const baseline = sameWeekdayBaseline(byDate, day.date);
    const recoveryReference = before?.impressions ?? baseline;
    const recovered =
      after !== undefined &&
      recoveryReference !== null &&
      after.impressions >= recoveryReference * ANOMALY_REBOUND_RATIO;

    // Keep scanning: a run that is too long, still ongoing, or unmeasurable is
    // not this finding — but an older, genuine anomaly may still be in the
    // series, and stopping here would hide it.
    if (runLength > ANOMALY_MAX_DAYS || !recovered || baseline === null) {
      index -= runLength - 1;
      continue;
    }

    const run = series.filter(
      (entry) => entry.date >= startDate && entry.date <= day.date,
    );
    // An "outage" inside the days Search Console has not finalised may be the
    // reporting lag rather than an event. We still show it — a real outage
    // yesterday is exactly what someone opens this tool for — but we do not
    // let it pass as settled fact.
    const newest = series[series.length - 1]?.date;
    const unfinalized =
      newest !== undefined &&
      daysBetween(day.date, newest) < TRAFFIC_UNFINALIZED_TAIL_DAYS;

    return {
      id: "transient_visibility_anomaly",
      tier: "observed",
      measures: [
        { key: "start_date", value: startDate },
        { key: "end_date", value: day.date },
        { key: "day_count", value: runLength },
        {
          key: "low_impressions",
          value: Math.min(...run.map((entry) => entry.impressions)),
        },
        { key: "baseline_impressions", value: Math.round(baseline) },
        { key: "rebound_impressions", value: after.impressions },
      ],
      queries: [],
      hypothesis: null,
      limitation: unfinalized
        ? "event_within_unfinalized_window"
        : "index_report_predates_event",
    };
  }
  return null;
}

/**
 * Year-over-year needs last year. Saying so is the finding.
 *
 * History is the calendar span the property has been visible for, not a row
 * count: Search Console omits empty days, so a two-year-old site with quiet
 * stretches has far fewer rows than days and would be told it is too young for
 * a comparison it can actually support. `historySpanDays` is the one place
 * that measurement lives, shared with the twelve-week gate and with the number
 * the report shows.
 */
function detectSeasonalityBoundary(
  series: readonly TrafficDailyPoint[],
): TrafficFinding | null {
  const span = historySpanDays(series);
  if (span >= SEASONALITY_MIN_DAYS) return null;
  return {
    id: "seasonality_unavailable",
    tier: "data_boundary",
    measures: [
      { key: "history_days", value: span },
      { key: "required_days", value: SEASONALITY_MIN_DAYS },
    ],
    queries: [],
    hypothesis: null,
    limitation: null,
  };
}

/**
 * Everything the daily series alone can support.
 *
 * Query-level findings (which cohort carried the drop) need a second GSC
 * dimension and are added by the reader layer; their absence is reported as an
 * unavailable check rather than silently omitted.
 */
export function buildTrafficFindings(
  input: readonly TrafficDailyPoint[],
  changePoint: TrafficChangePoint,
): readonly TrafficFinding[] {
  const series = sortByDate(input);
  const twoStage = detectTwoStageDecline(changePoint);

  return [
    twoStage,
    twoStage ? null : detectSingleStageDecline(changePoint),
    detectHighImpressionLowClickDay(series, changePoint),
    detectTransientDayAnomaly(series),
    detectSeasonalityBoundary(series),
  ].filter((finding): finding is TrafficFinding => finding !== null);
}

/** Median daily CTR over a series. Exported for the report's period summary. */
export function medianDailyCtr(
  series: readonly TrafficDailyPoint[],
): number | null {
  const ratios = series
    .filter((day) => day.impressions > 0)
    .map((day) => day.clicks / day.impressions);
  return ratios.length === 0 ? null : median(ratios);
}
