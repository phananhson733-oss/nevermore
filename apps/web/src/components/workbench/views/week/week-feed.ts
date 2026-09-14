/**
 * The week page's date range and event feed (plan Task 8 Step 1; jsx:2788-2794,
 * defects W3 / W5 / W19; codex S7a #5 / #9).
 *
 * The range is the local calendar range the subtitle prints (`weekWindow`): the
 * `WEEK_WINDOW_DAYS` dates ending today, from 00:00 on the date six days back up
 * to `now`, both ends in. Seven dates, not the eight it spanned before (codex
 * S7r2 #6), and not a calendar week either, so what is counted over it is
 * labelled 「近 7 天」 / "the last 7 days"; the page title keeps the design's
 * 「本周变化」. It is calendar dates, not a rolling 168 hours, because the subtitle shows
 * dates and nothing else: the rolling window this replaced left stamps on the
 * first printed date outside the counts beneath it (a 2026-09-07 09:00 artifact
 * under 「2026-09-07 至 2026-09-14」 at 12:00 was 171 hours old and not counted).
 * One function draws the range for the subtitle and the report title
 * (`weekRange`), the artifact count and this feed, so they cannot disagree.
 *
 * A stamp is in when it parses and sits between the range's first and last
 * stamp. Stamps are compared as `YYYY-MM-DD HH:mm` strings, which order like the
 * wall clock, so no millisecond arithmetic runs across a daylight-saving change;
 * a stamp in the future is never in. The stored stamps carry no offset, so the
 * repeated hour of a fall-back change stays ambiguous (codex S7a #10, a known
 * limit of the storage format, not handled here).
 *
 * Events come from completed runs only — every audit and visibility run the
 * store still holds (`auditHistory` and `lastAudit`, `visHistory` and
 * `lastVis`), `profileDoc`, `kb` — and from every artifact in the basket. A
 * snapshot object held twice is one event: the reducer keeps one report as both
 * `lastAudit` and an `auditHistory` entry when a report is dispatched again
 * after a later one (`archive` in reducer.ts). Two runs stamped with the same
 * minute are two events, whatever they hold (codex S7r2 #4): a stamp is not a
 * run's identity, and the store keeps no run id. The rule does not assume a
 * shared reference exists only in memory: `loadPersisted` hands the store a
 * whole state that never passes through `archive`, and that state can carry
 * shared references too (hydration's `normalizeInterrupted` makes `audit` the
 * `lastAudit` object). One object counts once, however it arrived; a repeat
 * that arrives as two copies counts twice. The report the reducer shares comes
 * back from localStorage as two separate objects (measured: JSON.parse and the
 * schema build each anew), so after a reload it is listed twice (a known limit). `audit` and `visResults` are
 * deliberately not read: while a run is in flight they are empty or partial,
 * and an event built from them either vanishes mid-run or presents a partial
 * result as a measurement (Q20).
 *
 * Newest first by stamp string order; a stamp that does not parse never reaches
 * the sort, because the range drops it first. Runs are listed ahead of
 * artifacts, so a run and an artifact stamped in the same minute keep that
 * order (the sort is stable).
 */
import type { WeekEvent, WeekEventKind } from "@/lib/workbench/mock/builders/week";
import { daysAgo, formatLocalStamp, parseLocalStamp, stampDate } from "@/lib/workbench/mock/time";
import type { Artifact, ModuleId, WorkbenchProjectState } from "@/lib/workbench/types";

/** How many local dates the range holds, today included. */
export const WEEK_WINDOW_DAYS = 7;

export interface WeekWindow {
  /** The first date in the range, `YYYY-MM-DD`, local. */
  readonly from: string;
  /** Today, `YYYY-MM-DD`, local. */
  readonly to: string;
  /** The first stamp in the range: 00:00 on `from`. */
  readonly first: string;
  /** The last stamp in the range: the minute `now` falls in. */
  readonly last: string;
  /**
   * `now` as an instant, epoch milliseconds. In an hour a daylight-saving
   * change repeats, `last` names two instants; `rangePlacement` needs the one.
   */
  readonly nowTime: number;
}

export type WeekFeedState = Pick<
  WorkbenchProjectState,
  "lastAudit" | "auditHistory" | "lastVis" | "visHistory" | "profileDoc" | "kb" | "artifacts"
>;

export function weekWindow(now: Date): WeekWindow {
  const from = stampDate(daysAgo(now, WEEK_WINDOW_DAYS - 1));
  const last = formatLocalStamp(now);
  return { from, to: stampDate(last), first: `${from} 00:00`, last, nowTime: now.getTime() };
}

export function inWeekWindow(at: string, range: WeekWindow): boolean {
  return parseLocalStamp(at) !== null && at >= range.first && at <= range.last;
}

/**
 * Where a stamp stands against the range, for the sentence a card prints under
 * it: `outside` is before the range's first minute or after `now`; `unknown`
 * is a stamp that cannot be placed. Unlike `inWeekWindow`, which decides the
 * counts and compares strings, this compares instants and says `unknown`
 * wherever the stamp does not pin one down (codex S8r3):
 * - it does not parse;
 * - it falls in a daylight-saving gap, a local time that never happens, which
 *   `Date` quietly moves to another time (America/Los_Angeles reads
 *   2026-03-08 02:30 as 03:30);
 * - it falls in a repeated hour and its two readings, before and after the
 *   change, land on different sides of the range's ends.
 * The counts keep such a stamp as they did; only the card declines to say.
 */
export type RangePlacement = "inside" | "outside" | "unknown";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * Each instant a parsed stamp can mean: its own, and in an hour a
 * daylight-saving change repeats, the one on the other side of the change.
 * The change is found from the UTC offsets a day either side; two changes
 * within two days of each other are not looked for.
 */
function stampReadings(date: Date): readonly number[] {
  const time = date.getTime();
  const before = new Date(time - DAY_MS).getTimezoneOffset();
  const after = new Date(time + DAY_MS).getTimezoneOffset();
  const shift = Math.abs(before - after) * MINUTE_MS;
  if (shift === 0) return [time];
  const stamp = formatLocalStamp(date);
  return [time - shift, time, time + shift].filter((reading) => formatLocalStamp(new Date(reading)) === stamp);
}

export function rangePlacement(at: string, range: WeekWindow): RangePlacement {
  const date = parseLocalStamp(at);
  const first = parseLocalStamp(range.first);
  if (date === null || first === null) return "unknown";
  // A daylight-saving gap: `Date` moved the stamp to a time it does not say.
  if (formatLocalStamp(date) !== at) return "unknown";
  const places = new Set(
    stampReadings(date).map((reading) =>
      reading >= first.getTime() && reading <= range.nowTime ? "inside" : "outside",
    ),
  );
  const [only] = places;
  return places.size === 1 && only !== undefined ? only : "unknown";
}

export function artifactsInWeek(artifacts: readonly Artifact[], range: WeekWindow): readonly Artifact[] {
  return artifacts.filter((artifact) => inWeekWindow(artifact.at, range));
}

function runEvent(kind: Exclude<WeekEventKind, "artifact">, module: ModuleId, at: string): WeekEvent {
  return { kind, at, module, title: null };
}

/** Each object once, by identity: the same snapshot held twice, not two snapshots that look alike. */
function eachObjectOnce<T extends object>(items: readonly T[]): readonly T[] {
  return items.filter((item, index) => items.indexOf(item) === index);
}

function runEvents(state: WeekFeedState): readonly WeekEvent[] {
  const audits = eachObjectOnce([...state.auditHistory, ...(state.lastAudit === null ? [] : [state.lastAudit])]);
  const runs = eachObjectOnce([...state.visHistory, ...(state.lastVis === null ? [] : [state.lastVis])]);
  return [
    ...audits.map((report) => runEvent("audit", "audit", report.at)),
    ...runs.map((snapshot) => runEvent("visibility", "visibility", snapshot.at)),
    ...(state.profileDoc === null ? [] : [runEvent("profile", "profile", state.profileDoc.at)]),
    ...(state.kb === null ? [] : [runEvent("kb", "kb", state.kb.at)]),
  ];
}

function artifactEvent(artifact: Artifact): WeekEvent {
  return { kind: "artifact", at: artifact.at, module: artifact.module, title: artifact.title };
}

function newestFirst(a: WeekEvent, b: WeekEvent): number {
  if (a.at === b.at) return 0;
  return a.at < b.at ? 1 : -1;
}

export function weekFeed(state: WeekFeedState, now: Date): readonly WeekEvent[] {
  const range = weekWindow(now);
  const runs = runEvents(state).filter((event) => inWeekWindow(event.at, range));
  return [...runs, ...artifactsInWeek(state.artifacts, range).map(artifactEvent)].toSorted(newestFirst);
}
