// @input  -- an instant, and optionally a window length
// @output -- the Search Console date window to request, in Pacific calendar days
// @pos    -- the only place a run decides which days it is looking at
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Days to stay behind the current Pacific day.
 *
 * Search Console finalises a day some time after it ends. Requesting up to
 * "today" returns a partial tail that looks like a collapse in traffic and a
 * distorted CTR — the last day or two are always low because they are
 * incomplete, not because anything happened.
 */
export const GSC_FINAL_LAG_DAYS = 3;

/** The comparison window frozen by v3.1 §一修正 1. */
export const WINDOW_LENGTH_DAYS = 28;

export interface GscWindow {
  /** Inclusive, YYYY-MM-DD in Pacific calendar days. */
  readonly startDate: string;
  /** Inclusive, YYYY-MM-DD in Pacific calendar days. */
  readonly endDate: string;
}

const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The Pacific calendar day an instant falls on.
 *
 * Search Console's natural day is Pacific Time, not UTC and not the server's
 * zone. A window cut on UTC days is offset by one day for roughly a third of
 * every UTC day, which silently shifts both ends of the comparison and moves
 * whichever rows sit on the boundary. `en-CA` is used because it formats as
 * YYYY-MM-DD, the same shape the API expects back.
 */
export function pacificDate(instant: Date): string {
  return PACIFIC_DAY.format(instant);
}

/**
 * Move a calendar day by a number of days.
 *
 * Deliberately done in UTC on a date-only value rather than with a local
 * `Date`: local arithmetic gains or loses an hour across a DST boundary and
 * can land on the wrong calendar day, which is exactly the class of bug this
 * module exists to prevent.
 */
export function shiftDate(isoDate: string, days: number): string {
  const at = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The most recent window whose days Search Console has finalised.
 *
 * Derived from the Pacific day rather than the caller's clock, so two runs
 * inside the same Pacific day request exactly the same days. A window that
 * moves between two visitors' runs is a window that makes their numbers
 * incomparable for a reason neither of them can see.
 */
export function latestFinalWindow(
  now: Date,
  options: {
    readonly lagDays?: number;
    readonly lengthDays?: number;
  } = {},
): GscWindow {
  const lagDays = options.lagDays ?? GSC_FINAL_LAG_DAYS;
  const lengthDays = options.lengthDays ?? WINDOW_LENGTH_DAYS;

  // Unvalidated, lengthDays: 0 produced startDate > endDate and a negative
  // lagDays requested days Search Console has not finalised. A window that
  // cannot be honestly described is not a window.
  if (!Number.isSafeInteger(lengthDays) || lengthDays < 1) {
    throw new RangeError(
      `latestFinalWindow: lengthDays must be a positive integer, got ${lengthDays}`,
    );
  }
  if (!Number.isSafeInteger(lagDays) || lagDays < 0) {
    throw new RangeError(
      `latestFinalWindow: lagDays must be a non-negative integer, got ${lagDays}`,
    );
  }

  const endDate = shiftDate(pacificDate(now), -lagDays);
  // Inclusive on both ends, so a 28-day window spans 27 shifts.
  const startDate = shiftDate(endDate, -(lengthDays - 1));

  return { startDate, endDate };
}
