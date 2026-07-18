/**
 * GSC collection window math (spec §7.4, §8.4). Search Console finalizes daily
 * metrics on a ~3-day lag, so the reporting window ends 3 America/Los_Angeles
 * calendar days before "now". The window is 56 days long and is split into two
 * contiguous 28-day halves so the decay rule (WP3) can compare `current28d` vs
 * `previous28d`.
 *
 * Pure and deterministic: identical `(now, timeZone)` always yields identical
 * output. `now` and `timeZone` are injectable so tests never depend on the wall
 * clock or the host locale. All day arithmetic is done on UTC midnight anchors
 * of the LA calendar date, which is DST-independent (no local offset is ever
 * added back), so the returned `YYYY-MM-DD` strings are stable across PST/PDT.
 */

/** A closed `[start, end]` inclusive date range as `YYYY-MM-DD` strings. */
export interface GscDateRange {
  readonly start: string;
  readonly end: string;
}

/** The resolved GSC reporting window (spec §7.4). `startDate === previous28d.start`. */
export interface GscWindow {
  /** First day queried (inclusive) — 55 days before `endDate`. */
  readonly startDate: string;
  /** Last day queried (inclusive) — LA today minus the 3-day reporting lag. */
  readonly endDate: string;
  /** The most recent 28 days of the window. */
  readonly current28d: GscDateRange;
  /** The 28 days immediately before `current28d` (no overlap, no gap). */
  readonly previous28d: GscDateRange;
}

const DAY_MS = 86_400_000;
const DEFAULT_TIME_ZONE = "America/Los_Angeles";

/** Search Console finalizes `dataState:"final"` metrics ~3 days behind. */
const REPORTING_LAG_DAYS = 3;
/** Each half-window is 28 days inclusive. */
const HALF_WINDOW_DAYS = 28;

function partValue(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new Error(`GSC window: missing "${type}" part from Intl.DateTimeFormat`);
  }
  const value = Number.parseInt(part.value, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`GSC window: non-numeric "${type}" part "${part.value}"`);
  }
  return value;
}

/**
 * The UTC-midnight epoch millis of the calendar date that `instant` falls on in
 * `timeZone`. This collapses the instant to a timezone-local day, then re-anchors
 * it at UTC so subsequent day arithmetic never crosses a DST boundary.
 */
function zonedDateAnchorMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const year = partValue(parts, "year");
  const month = partValue(parts, "month");
  const day = partValue(parts, "day");
  return Date.UTC(year, month - 1, day);
}

function formatAnchor(anchorMs: number): string {
  const date = new Date(anchorMs);
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolve the GSC reporting window for `now`. `timeZone` defaults to
 * America/Los_Angeles (spec §8.4); pass an override only for tests.
 */
export function computeGscWindow(now: Date, timeZone?: string): GscWindow {
  const zone = timeZone ?? DEFAULT_TIME_ZONE;
  const todayAnchor = zonedDateAnchorMs(now, zone);

  const endMs = todayAnchor - REPORTING_LAG_DAYS * DAY_MS;
  const currentStartMs = endMs - (HALF_WINDOW_DAYS - 1) * DAY_MS;
  const previousEndMs = currentStartMs - DAY_MS;
  const previousStartMs = previousEndMs - (HALF_WINDOW_DAYS - 1) * DAY_MS;

  return {
    startDate: formatAnchor(previousStartMs),
    endDate: formatAnchor(endMs),
    current28d: { start: formatAnchor(currentStartMs), end: formatAnchor(endMs) },
    previous28d: { start: formatAnchor(previousStartMs), end: formatAnchor(previousEndMs) },
  };
}
