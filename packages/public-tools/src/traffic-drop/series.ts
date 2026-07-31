import type {
  TrafficDailyPoint,
  TrafficWindow,
  TrafficWindowId,
} from "./types.ts";

/**
 * Frozen detector constants (v3.1 §3.2).
 *
 * These are not tuning knobs. Each one exists because the previous design
 * failed on a real site: a fixed 28-day comparison reported +329% on a series
 * whose operator was living through a -81% collapse, and a detector without an
 * absolute floor turned every young site's ordinary wobble into an "event".
 * Changing any of them changes what the tool claims about real traffic, so a
 * change must bump the schema version and be re-run against the fixture.
 */
export const TRAFFIC_WINDOW_DAYS = 7;
/** Twelve weeks. Below this the engine reports insufficient_history instead of guessing. */
export const TRAFFIC_MIN_HISTORY_DAYS = 84;
/** Absolute floors: a "peak" that is small in absolute terms is noise, however sharp. */
export const TRAFFIC_PEAK_MIN_CLICKS = 100;
export const TRAFFIC_PEAK_MIN_IMPRESSIONS = 1_000;
/**
 * Relative floor against the site's own typical week before the candidate.
 *
 * Deliberately 1: the peak must be at least an ordinary week for this site,
 * not a spike. Requiring a multiple makes the most common real failure —
 * steady traffic that falls off a plateau — undetectable, because there the
 * "peak" IS the normal level. Noise is held back by the absolute floors below
 * plus the requirement that the drop be 40% and hold for two weeks; a site
 * that merely wobbles never clears those.
 */
export const TRAFFIC_PEAK_MEDIAN_MULTIPLE = 1;
/** A follow-up window at or above 60% of peak is not a trough. */
export const TRAFFIC_SUSTAIN_RATIO = 0.6;
/** Two non-overlapping windows (~14 days) below the ratio before it is "sustained". */
export const TRAFFIC_SUSTAIN_WINDOW_COUNT = 2;
/** A trough more than 28 days after the peak is a separate event, not this one. */
export const TRAFFIC_TROUGH_MAX_LAG_DAYS = 28;
/**
 * Search Console finalises data two to three days late, so the newest rows
 * always read low. They are dropped before the window-level verdict is
 * measured — left in, they would bias every decline the tool reports downward,
 * and the freshest "drop" would be an artefact of the reporting pipeline.
 * Day-level findings still see these days, and say so.
 */
export const TRAFFIC_UNFINALIZED_TAIL_DAYS = 3;
/**
 * How far above its old baseline a site can settle and still count as "the
 * promotion ended" rather than "a decline". Beyond this it came down from a
 * spike into a genuinely higher plateau, which is a different story.
 */
export const TRAFFIC_PRIOR_NORMAL_TOLERANCE = 1.5;

/** Totals for one closed calendar range. */
export interface TrafficWindowTotals {
  readonly startDate: string;
  readonly endDate: string;
  readonly clicks: number;
  readonly impressions: number;
}

const MS_PER_DAY = 86_400_000;

/** Calendar arithmetic on YYYY-MM-DD, in UTC so DST never shifts a day. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

/**
 * First day the property actually had visibility, or null if it never did.
 *
 * Search Console's own contract is only that the reader never INVENTS zero
 * rows for days it did not return — not that zero rows never arrive. They do:
 * a property that existed but drew nothing on a given day comes back as a real
 * row with `impressions: 0`. Counting those as history would make a site look
 * older than its visibility, which is what every history gate is actually
 * asking about.
 */
export function firstVisibleDate(
  series: readonly TrafficDailyPoint[],
): string | null {
  return series.find((day) => day.impressions > 0)?.date ?? null;
}

/**
 * Days of history: the calendar span the property has been VISIBLE for.
 *
 * The one definition of "how much history is there", used by every gate and by
 * the number the report shows. It used to be four definitions — the report
 * measured from the first visible day while the twelve-week gate, the
 * year-over-year gate and the check list each measured from the first row —
 * so a site with a zero-impression prefix was told it had 31 days of history
 * in one place and 32 in another, and, worse, the gates were the LOOSER pair:
 * they could clear a twelve-week threshold the displayed number said was not
 * met, and hand back a "sustained decline" for a site the same page called too
 * young to judge.
 *
 * Deliberately not `series.length`: Search Console omits days it has nothing
 * for, so a row count understates the age of any site with quiet stretches.
 */
export function historySpanDays(series: readonly TrafficDailyPoint[]): number {
  const first = firstVisibleDate(series);
  const last = series[series.length - 1]?.date;
  if (!first || !last) return 0;
  return daysBetween(first, last) + 1;
}

/**
 * Ascending by date, with duplicate dates collapsed.
 *
 * GSC may hand back rows in any order, and a detector whose verdict depends on
 * row order is not a detector. Duplicates are dropped rather than summed: two
 * rows for one date means we misunderstood the response, and doubling that
 * day's traffic would quietly manufacture a peak.
 */
export function sortByDate(
  series: readonly TrafficDailyPoint[],
): readonly TrafficDailyPoint[] {
  const byDate = new Map<string, TrafficDailyPoint>();
  for (const day of series) {
    if (!byDate.has(day.date)) byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

/**
 * Totals for the `size`-CALENDAR-DAY window ending on `endDate`.
 *
 * Returns null unless every day in the range is present. Windows are cut by
 * date, never by array position: Search Console omits days a property drew
 * nothing, so seven rows can span three weeks. An index-sliced "week" compared
 * against a real week is not a comparison, and a window missing days would
 * under-count its own totals and inflate the decline.
 */
export function windowEndingOn(
  series: readonly TrafficDailyPoint[],
  endDate: string,
  size: number = TRAFFIC_WINDOW_DAYS,
  index?: ReadonlyMap<string, TrafficDailyPoint>,
): TrafficWindowTotals | null {
  const lookup = index ?? new Map(series.map((day) => [day.date, day]));
  const startDate = addDays(endDate, -(size - 1));

  let clicks = 0;
  let impressions = 0;
  for (let offset = 0; offset < size; offset += 1) {
    const day = lookup.get(addDays(startDate, offset));
    if (!day) return null;
    clicks += day.clicks;
    impressions += day.impressions;
  }

  return { startDate, endDate, clicks, impressions };
}

/** Index a series by date once, for repeated window cuts. */
export function indexByDate(
  series: readonly TrafficDailyPoint[],
): ReadonlyMap<string, TrafficDailyPoint> {
  return new Map(series.map((day) => [day.date, day]));
}

/** Every whole right-aligned calendar window, oldest first. */
export function rollingWindows(
  series: readonly TrafficDailyPoint[],
  size: number = TRAFFIC_WINDOW_DAYS,
): readonly TrafficWindowTotals[] {
  const lookup = indexByDate(series);
  const windows: TrafficWindowTotals[] = [];
  for (const day of series) {
    const totals = windowEndingOn(series, day.date, size, lookup);
    if (totals) windows.push(totals);
  }
  return windows;
}

/** Median of a numeric list. Returns 0 for an empty list, which no caller passes. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Whole calendar days between two window ends. */
export function lagInDays(
  earlier: TrafficWindowTotals,
  later: TrafficWindowTotals,
): number {
  return daysBetween(earlier.endDate, later.endDate);
}

/**
 * Present a window for the report.
 *
 * CTR is null — never 0 — when there were no impressions to divide by: a ratio
 * that does not exist is not a ratio of zero.
 */
export function toTrafficWindow(
  id: TrafficWindowId,
  totals: TrafficWindowTotals,
): TrafficWindow {
  return {
    id,
    startDate: totals.startDate,
    endDate: totals.endDate,
    clicks: totals.clicks,
    impressions: totals.impressions,
    ctr: totals.impressions === 0 ? null : totals.clicks / totals.impressions,
  };
}
