/**
 * Where the decline sits on Google's published ranking-update timeline.
 *
 * This is CONTEXT, not a判据. It is deliberately incapable of contributing to
 * any conclusion, and the reasons are worth stating where the code lives:
 *
 * 1. The event is not a date. The detector works on whole 7-day windows, so
 *    the best it can say is "somewhere in these N days". Comparing a multi-day
 *    interval against a multi-week rollout is a coincidence test with a very
 *    generous notion of coincidence.
 *
 * 2. The base rate is enormous. Google's four 2024 core updates alone rolled
 *    out across roughly 94 days — about a quarter of the year — before adding
 *    spam updates or the event window's own width. A signal that fires on a
 *    large fraction of all inputs is background, not evidence.
 *
 * 3. Not matching proves nothing. Google adjusts ranking continuously; the
 *    announced updates are a subset. "Did not land in a published window" is
 *    not a reason to rule anything out, and copy built on this module must not
 *    render it as one.
 *
 * What it IS good for: orienting someone who is about to go read about a
 * specific update, and heading off the "was there an update that week?" search
 * that every visitor makes anyway.
 */

import { daysBetween } from "./series.ts";

/**
 * The shape this module needs from a comparison window.
 *
 * Declared structurally rather than imported from `types.ts` so the dependency
 * runs one way: `types.ts` publishes `CoreUpdateTimeline`, and nothing here
 * reaches back into it.
 */
export interface ComparisonWindowLike {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
}

export type RankingUpdateKind = "core" | "spam" | "other";

export interface RankingUpdate {
  readonly id: string;
  readonly name: string;
  readonly kind: RankingUpdateKind;
  /** Inclusive first day of the announced rollout, YYYY-MM-DD. */
  readonly startDate: string;
  /**
   * Inclusive last day of the announced rollout, or null.
   *
   * Null means Google announced the start but the completion was not
   * published (or had not been at the time this table was compiled). It is
   * NOT a synonym for "still running" and must never be widened into an open
   * interval — that would make the update overlap every later event forever.
   */
  readonly endDate: string | null;
}

export interface RankingUpdateTable {
  /** Bumped whenever entries change, so a stored result can be re-read later. */
  readonly version: string;
  readonly source: string;
  /**
   * The last day this table's compiler actually checked the dashboard.
   *
   * This field is what makes the whole module honest. An event AFTER this date
   * cannot be compared: the absence of a matching entry would mean "we have
   * not looked since then", and rendering that as "no update around your
   * decline" is a false negative manufactured by our own staleness.
   */
  readonly verifiedThrough: string;
  readonly updates: readonly RankingUpdate[];
}

/**
 * Announced ranking updates, as published on the Search Status Dashboard.
 *
 * OWNER STEP — this table has to be extended by hand, and detection A stays
 * `not_available` for any event after `verifiedThrough` until someone does it.
 * That is the intended failure mode: a stale table producing "no update found"
 * is worse than a table that admits it stopped looking.
 *
 * Rules for adding an entry:
 * - take the dates from `status.search.google.com`, not from a blog post;
 * - `endDate` is the announced completion, and stays null until it is
 *   announced;
 * - move `verifiedThrough` to the day you checked, not to the last entry's
 *   date — those are different facts;
 * - bump `version`.
 */
export const RANKING_UPDATE_TABLE: RankingUpdateTable = {
  version: "2025-07-17.v1",
  source:
    "https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history",
  verifiedThrough: "2025-07-17",
  updates: [
    {
      id: "core-2023-03",
      name: "March 2023 core update",
      kind: "core",
      startDate: "2023-03-15",
      endDate: "2023-03-28",
    },
    {
      id: "core-2023-08",
      name: "August 2023 core update",
      kind: "core",
      startDate: "2023-08-22",
      endDate: "2023-09-07",
    },
    {
      id: "core-2023-10",
      name: "October 2023 core update",
      kind: "core",
      startDate: "2023-10-05",
      endDate: "2023-10-19",
    },
    {
      id: "core-2023-11",
      name: "November 2023 core update",
      kind: "core",
      startDate: "2023-11-02",
      endDate: "2023-11-28",
    },
    {
      id: "core-2024-03",
      name: "March 2024 core update",
      kind: "core",
      startDate: "2024-03-05",
      endDate: "2024-04-19",
    },
    {
      id: "spam-2024-06",
      name: "June 2024 spam update",
      kind: "spam",
      startDate: "2024-06-20",
      endDate: "2024-06-27",
    },
    {
      id: "core-2024-08",
      name: "August 2024 core update",
      kind: "core",
      startDate: "2024-08-15",
      endDate: "2024-09-03",
    },
    {
      id: "core-2024-11",
      name: "November 2024 core update",
      kind: "core",
      startDate: "2024-11-11",
      endDate: "2024-12-05",
    },
    {
      id: "core-2024-12",
      name: "December 2024 core update",
      kind: "core",
      startDate: "2024-12-12",
      endDate: "2024-12-18",
    },
    {
      id: "spam-2024-12",
      name: "December 2024 spam update",
      kind: "spam",
      startDate: "2024-12-19",
      endDate: "2024-12-26",
    },
    {
      id: "core-2025-03",
      name: "March 2025 core update",
      kind: "core",
      startDate: "2025-03-13",
      endDate: "2025-03-27",
    },
    {
      id: "core-2025-06",
      name: "June 2025 core update",
      kind: "core",
      startDate: "2025-06-30",
      endDate: "2025-07-17",
    },
  ],
};

/**
 * The span the decline is known to have happened inside.
 *
 * Not a date. `peak` is the last high week and `mid` is the first low week, so
 * the turn happened somewhere between the end of one and the end of the other.
 * Every consumer gets the width along with the bounds so it cannot present
 * this as a day.
 */
export interface EventWindow {
  readonly startDate: string;
  readonly endDate: string;
  readonly dayCount: number;
}

export function eventWindowFor(
  windows: readonly ComparisonWindowLike[],
): EventWindow | null {
  const peak = windows.find((window) => window.id === "peak");
  const mid = windows.find((window) => window.id === "mid");
  if (peak === undefined || mid === undefined) return null;

  return {
    startDate: peak.endDate,
    endDate: mid.endDate,
    dayCount: daysBetween(peak.endDate, mid.endDate) + 1,
  };
}

export interface RankingUpdateOverlap {
  readonly update: RankingUpdate;
  readonly overlapStart: string;
  readonly overlapEnd: string;
  readonly overlapDays: number;
  /**
   * The rollout had no announced completion date.
   *
   * The overlap is then computed against the start day alone, which
   * understates it. Said out loud rather than silently assumed either way.
   */
  readonly rolloutEndUnannounced: boolean;
}

export type CoreUpdateTimelineUnavailableReason =
  /** No peak/mid pair, so there is no event to place on a timeline. */
  | "no_event_window"
  /**
   * The event is more recent than the last time the table was checked.
   * Reporting "no update found" here would be reporting our own staleness as
   * a fact about the visitor's site.
   */
  | "table_not_verified_through_event";

export type CoreUpdateTimeline =
  | {
      readonly kind: "not_available";
      readonly reason: CoreUpdateTimelineUnavailableReason;
      readonly tableVersion: string;
      readonly verifiedThrough: string;
    }
  | {
      readonly kind: "compared";
      readonly eventWindow: EventWindow;
      /** Empty means no announced update overlaps. It does NOT mean "not an algorithm change". */
      readonly overlapping: readonly RankingUpdateOverlap[];
      readonly tableVersion: string;
      readonly verifiedThrough: string;
    };

function later(a: string, b: string): string {
  return a >= b ? a : b;
}

function earlier(a: string, b: string): string {
  return a <= b ? a : b;
}

function overlapOf(
  update: RankingUpdate,
  window: EventWindow,
): RankingUpdateOverlap | null {
  // An unannounced completion is treated as a single day, not an open
  // interval. Widening it to "still running" would make one 2023 entry overlap
  // every decline since.
  const rolloutEnd = update.endDate ?? update.startDate;
  const start = later(update.startDate, window.startDate);
  const end = earlier(rolloutEnd, window.endDate);
  if (start > end) return null;

  return {
    update,
    overlapStart: start,
    overlapEnd: end,
    overlapDays: daysBetween(start, end) + 1,
    rolloutEndUnannounced: update.endDate === null,
  };
}

/**
 * Place the event window on the published update timeline.
 *
 * Returns every overlapping entry rather than the "best" one: two updates can
 * overlap the same window, and picking one would invent a ranking between them
 * that the dates do not support.
 */
export function compareToRankingUpdates(
  windows: readonly ComparisonWindowLike[],
  table: RankingUpdateTable = RANKING_UPDATE_TABLE,
): CoreUpdateTimeline {
  const stamp = {
    tableVersion: table.version,
    verifiedThrough: table.verifiedThrough,
  } as const;

  const eventWindow = eventWindowFor(windows);
  if (eventWindow === null) {
    return { kind: "not_available", reason: "no_event_window", ...stamp };
  }

  if (eventWindow.endDate > table.verifiedThrough) {
    return {
      kind: "not_available",
      reason: "table_not_verified_through_event",
      ...stamp,
    };
  }

  const overlapping = table.updates
    .map((update) => overlapOf(update, eventWindow))
    .filter((entry): entry is RankingUpdateOverlap => entry !== null);

  return { kind: "compared", eventWindow, overlapping, ...stamp };
}
