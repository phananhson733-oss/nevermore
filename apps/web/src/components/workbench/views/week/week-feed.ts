/**
 * The week page's date range and event feed (plan Task 8 Step 1; jsx:2788-2794,
 * defects W3 / W5 / W19; codex S7a #5 / #9).
 *
 * The range is the local calendar range the subtitle prints (`weekWindow`): from
 * 00:00 on the date `WEEK_WINDOW_DAYS` days before today up to `now`, both ends
 * in. It is calendar dates, not a rolling 168 hours, because the subtitle shows
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
 * run's identity, and the store keeps no run id. Object identity does not
 * survive the JSON round-trip, so after a reload that repeated report is listed
 * twice (a known limit). `audit` and `visResults` are
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
}

export type WeekFeedState = Pick<
  WorkbenchProjectState,
  "lastAudit" | "auditHistory" | "lastVis" | "visHistory" | "profileDoc" | "kb" | "artifacts"
>;

export function weekWindow(now: Date): WeekWindow {
  const from = stampDate(daysAgo(now, WEEK_WINDOW_DAYS));
  const last = formatLocalStamp(now);
  return { from, to: stampDate(last), first: `${from} 00:00`, last };
}

export function inWeekWindow(at: string, range: WeekWindow): boolean {
  return parseLocalStamp(at) !== null && at >= range.first && at <= range.last;
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
