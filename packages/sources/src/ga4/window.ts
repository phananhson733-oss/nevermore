/**
 * GA4 collection window (spec §7.4). Pure and deterministic: given an injected
 * `now` instant and the GA4 property's timezone, it derives the fetch window and
 * the current-28-day aggregation window entirely in the PROPERTY's calendar —
 * never the machine's local time. `endDate` is "yesterday" in the property tz;
 * the fetch window spans 56 days; `current28d` is the trailing 28-day slice used
 * for `Ga4LandingProjection`. The timezone is returned so the snapshot can store
 * it (spec §7.4).
 */

const DAY_MS = 86_400_000;

export interface Ga4DateRange {
  readonly start: string;
  readonly end: string;
}

export interface Ga4Window {
  /** The GA4 property timezone the dates were computed in (stored in snapshot). */
  readonly timeZone: string;
  /** Fetch-window start: `endDate` − 55 days (YYYY-MM-DD). */
  readonly startDate: string;
  /** Fetch-window end: yesterday in the property timezone (YYYY-MM-DD). */
  readonly endDate: string;
  /** Trailing 28-day aggregation window, inclusive (YYYY-MM-DD). */
  readonly current28d: Ga4DateRange;
}

/** The calendar date of `now` in `timeZone`, as a UTC-midnight epoch. */
function calendarEpochUtc(now: Date, timeZone: string): number {
  if (Number.isNaN(now.getTime())) {
    throw new Error("computeGa4Window: `now` is an invalid Date");
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new Error(`computeGa4Window: invalid GA4 property timezone: ${timeZone}`);
  }
  const parts = formatter.formatToParts(now);
  const read = (type: "year" | "month" | "day"): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : Number.NaN;
  };
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`computeGa4Window: could not derive a calendar date in ${timeZone}`);
  }
  // Anchor at UTC midnight so subsequent day arithmetic is DST-independent.
  return Date.UTC(year, month - 1, day);
}

/** Format a UTC-midnight epoch as YYYY-MM-DD. */
function formatDate(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

/**
 * Compute the GA4 organic-landing window. `startDate = endDate − 55` (56 days
 * inclusive); `current28d = [endDate − 27, endDate]` (28 days inclusive).
 */
export function computeGa4Window(now: Date, propertyTimeZone: string): Ga4Window {
  const today = calendarEpochUtc(now, propertyTimeZone);
  const endEpoch = today - DAY_MS; // yesterday in the property timezone
  const startEpoch = endEpoch - 55 * DAY_MS;
  const current28dStart = endEpoch - 27 * DAY_MS;
  const endDate = formatDate(endEpoch);
  return {
    timeZone: propertyTimeZone,
    startDate: formatDate(startEpoch),
    endDate,
    current28d: { start: formatDate(current28dStart), end: endDate },
  };
}
