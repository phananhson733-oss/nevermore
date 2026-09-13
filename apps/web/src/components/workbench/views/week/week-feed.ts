/**
 * The week page's event feed (plan Task 8 Step 1; jsx:2788-2794, defects
 * W3 / W5 / W19).
 *
 * Events come from completed runs only (`lastAudit`, `lastVis`, `profileDoc`,
 * `kb`) and from every artifact in the basket. `audit` and `visResults` are
 * deliberately not read: while a run is in flight they are empty or partial,
 * and an event built from them either vanishes mid-run or presents a partial
 * result as a measurement (Q20).
 *
 * The window is `withinDays(at, 7, now)`: a stamp exactly seven days before
 * `now` is in, one second more is out, and a stamp in the future is never in.
 * Newest first by the local `YYYY-MM-DD HH:mm` stamp's string order; a stamp
 * that does not parse never reaches the sort, because the window drops it
 * first. Runs are listed ahead of artifacts, so a run and an artifact stamped
 * in the same minute keep that order (the sort is stable).
 *
 * `artifactsWithinDays` lives here rather than in `mock/time.ts` because this
 * page is its only reader (PR-2 A8 never landed).
 */
import type { WeekEvent } from "@/lib/workbench/mock/builders/week";
import { withinDays } from "@/lib/workbench/mock/time";
import type { Artifact, WorkbenchProjectState } from "@/lib/workbench/types";

export const WEEK_WINDOW_DAYS = 7;

export type WeekFeedState = Pick<
  WorkbenchProjectState,
  "lastAudit" | "lastVis" | "profileDoc" | "kb" | "artifacts"
>;

export function artifactsWithinDays(
  artifacts: readonly Artifact[],
  days: number,
  now: Date,
): readonly Artifact[] {
  return artifacts.filter((artifact) => withinDays(artifact.at, days, now));
}

function runEvents(state: WeekFeedState): readonly WeekEvent[] {
  const runs: readonly (WeekEvent | null)[] = [
    state.lastAudit === null
      ? null
      : { kind: "audit", at: state.lastAudit.at, module: "audit", title: null },
    state.lastVis === null
      ? null
      : { kind: "visibility", at: state.lastVis.at, module: "visibility", title: null },
    state.profileDoc === null
      ? null
      : { kind: "profile", at: state.profileDoc.at, module: "profile", title: null },
    state.kb === null ? null : { kind: "kb", at: state.kb.at, module: "kb", title: null },
  ];
  return runs.filter((event): event is WeekEvent => event !== null);
}

function artifactEvent(artifact: Artifact): WeekEvent {
  return { kind: "artifact", at: artifact.at, module: artifact.module, title: artifact.title };
}

function newestFirst(a: WeekEvent, b: WeekEvent): number {
  if (a.at === b.at) return 0;
  return a.at < b.at ? 1 : -1;
}

export function weekFeed(state: WeekFeedState, now: Date): readonly WeekEvent[] {
  const inWindow = (event: WeekEvent): boolean =>
    withinDays(event.at, WEEK_WINDOW_DAYS, now);
  return [
    ...runEvents(state).filter(inWindow),
    ...artifactsWithinDays(state.artifacts, WEEK_WINDOW_DAYS, now).map(artifactEvent),
  ].toSorted(newestFirst);
}
