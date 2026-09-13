/** Local wall-clock stamps, the only time format the workbench stores (types.ts AuditReport.at). */
const pad = (n: number): string => String(n).padStart(2, "0");

export function formatLocalStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * The local `Date` for a `YYYY-MM-DD HH:mm` stamp, or null. Fields that `Date`
 * would silently roll over (Feb 30, 09:60, 24:00) and years 0000-0099 (which
 * `Date` remaps to 19xx) are rejected rather than moved.
 */
export function parseLocalStamp(stamp: string): Date | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute);
  const sameDay = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return sameDay ? date : null;
}

/** `n` calendar days before `now`, optionally at `hour`:MM (minute derived from n, jsx:2673). Never mutates `now`. */
export function daysAgo(now: Date, n: number, hour?: number): string {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() - n);
  if (hour !== undefined) date.setHours(hour, 5 + ((n * 7) % 50), 0, 0);
  return formatLocalStamp(date);
}

/** True when `at` is not in the future and at most `days` days old. Unparseable stamps are outside every window. */
export function withinDays(at: string, days: number, now: Date): boolean {
  const date = parseLocalStamp(at);
  if (!date) return false;
  const age = (now.getTime() - date.getTime()) / 86_400_000;
  return age >= 0 && age <= days;
}

/** The `YYYY-MM-DD` part of a stamp. */
export function stampDate(stamp: string): string {
  return stamp.slice(0, 10);
}
