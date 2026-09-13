/**
 * Every number the week page and its weekly report print (plan Task 8 Steps
 * 1-3; rulings Q9 / Q10 / Q17 / Q18 / Q20 / Q21). One producer, so the cards,
 * the summary row, the next steps and the report cannot disagree.
 *
 * Unknown is `null`, never 0 (repo CLAUDE.md, Q10): no completed audit, no
 * completed visibility run (or one that returned nothing), no knowledge base,
 * no GSC row with a usable position. A zero is only ever a count that was
 * taken. `kbGaps` is `kbGapCount`, the sidebar badge's own count, so the two
 * cannot drift (jsx W16).
 *
 * Completed runs only: `lastAudit` / `lastVis`, never the in-flight `audit` /
 * `visResults` (Q20, jsx W3/W5). "Previous" is the last archived entry, which
 * the reducer never makes equal to the latest (`archive` in reducer.ts); its
 * stamp travels with it, because it may be a day or months old and the page
 * says 「较上次（{at}）」, not "last week".
 *
 * The mention-rate delta is in rounded points: the difference of the two shares
 * as `formatShare` rounds them, so `+6pt` next to 35% reads against the 29% the
 * report prints for the earlier run.
 *
 * Borderline queries are GSC rows at positions 11-30, by `gscStatus` and with
 * `nearCount`'s unknown rule (`mock/profile.ts`), read from the imported rows
 * themselves: the card's footnote says "positions in the latest GSC import".
 * They are a list, not a movement (Q17) — the store keeps no position history.
 */
import { countBySeverity, diffAudits } from "@/lib/workbench/mock/audit";
import type {
  WeekEvent,
  WeekHealth,
  WeekMention,
  WeeklyReportInput,
} from "@/lib/workbench/mock/builders/week";
import { gscStatus } from "@/lib/workbench/mock/gsc";
import { kbGapCount } from "@/lib/workbench/mock/kb";
import { daysAgo, formatLocalStamp, stampDate } from "@/lib/workbench/mock/time";
import { missedPrompts } from "@/lib/workbench/mock/visibility";
import type { WorkbenchPageId } from "@/lib/workbench/routes";
import { formatShare } from "@/lib/workbench/store/selectors";
import type {
  GscRow,
  VisResult,
  VisSnapshot,
  WorkbenchProjectState,
} from "@/lib/workbench/types";
import { WEEK_WINDOW_DAYS, artifactsWithinDays, weekFeed } from "./week-feed.ts";

export interface BorderlineQuery {
  readonly query: string;
  readonly position: number;
}

export interface WeekSummary {
  /** Nothing to show at all: the page renders its empty state and the report cannot be saved. */
  readonly empty: boolean;
  readonly health: WeekHealth | null;
  readonly mention: WeekMention | null;
  readonly borderline: readonly BorderlineQuery[] | null;
  readonly artifactsThisWeek: number;
  readonly answerGaps: number | null;
  readonly kbGaps: number | null;
  readonly highFindings: number | null;
  readonly auditTaskTitles: readonly string[];
  readonly events: readonly WeekEvent[];
}

export type WeekSummaryState = Pick<
  WorkbenchProjectState,
  | "lastAudit"
  | "auditHistory"
  | "lastVis"
  | "visHistory"
  | "profileDoc"
  | "kb"
  | "artifacts"
  | "gscRows"
>;

export type WeekStepId = "fixHigh" | "answerGaps" | "borderline" | "kbGaps" | "keepGoing";

export interface WeekNextStep {
  readonly id: WeekStepId;
  /** `null` only for `keepGoing`, which has no count. */
  readonly count: number | null;
  readonly target: WorkbenchPageId;
}

export function weekRange(now: Date): { readonly from: string; readonly to: string } {
  return {
    from: stampDate(daysAgo(now, WEEK_WINDOW_DAYS)),
    to: stampDate(formatLocalStamp(now)),
  };
}

function health(state: WeekSummaryState): WeekHealth | null {
  const latest = state.lastAudit;
  if (latest === null) return null;
  const earlier = state.auditHistory.at(-1) ?? null;
  const delta = diffAudits(latest, earlier);
  return {
    at: latest.at,
    score: latest.score,
    previous:
      delta === null || earlier === null
        ? null
        : {
            at: earlier.at,
            scoreDelta: delta.score,
            noLonger: delta.fixed.map((finding) => finding.t),
            newly: delta.added.map((finding) => finding.t),
          },
  };
}

function hitCount(results: readonly VisResult[]): number {
  return results.filter((result) => result.hit).length;
}

function roundedShare(results: readonly VisResult[]): number {
  return Math.round((hitCount(results) * 100) / results.length);
}

function previousMention(
  latest: readonly VisResult[],
  earlier: VisSnapshot | null,
): WeekMention["previous"] {
  if (earlier === null || earlier.results.length === 0) return null;
  return {
    at: earlier.at,
    share: formatShare(hitCount(earlier.results), earlier.results.length),
    deltaPt: roundedShare(latest) - roundedShare(earlier.results),
  };
}

function mention(state: WeekSummaryState): WeekMention | null {
  const latest = state.lastVis;
  if (latest === null || latest.results.length === 0) return null;
  const hits = hitCount(latest.results);
  const total = latest.results.length;
  return {
    at: latest.at,
    share: formatShare(hits, total),
    hits,
    total,
    previous: previousMention(latest.results, state.visHistory.at(-1) ?? null),
  };
}

function answerGaps(latest: VisSnapshot | null): number | null {
  if (latest === null || latest.results.length === 0) return null;
  return missedPrompts(latest.results).length;
}

function borderline(rows: readonly GscRow[]): readonly BorderlineQuery[] | null {
  // `every` is true for no rows too: nothing imported is as unknown as nothing usable.
  if (rows.every((row) => gscStatus(row) === "unknown")) return null;
  return rows
    .flatMap((row) =>
      gscStatus(row) === "borderline" && row.position !== null
        ? [{ query: row.query, position: row.position }]
        : [],
    )
    .toSorted((a, b) => a.position - b.position);
}

function isEmpty(state: WeekSummaryState): boolean {
  return (
    state.lastAudit === null &&
    state.lastVis === null &&
    state.profileDoc === null &&
    state.kb === null &&
    state.artifacts.length === 0 &&
    state.gscRows.length === 0
  );
}

export function weekSummary(state: WeekSummaryState, now: Date): WeekSummary {
  return {
    empty: isEmpty(state),
    health: health(state),
    mention: mention(state),
    borderline: borderline(state.gscRows),
    artifactsThisWeek: artifactsWithinDays(state.artifacts, WEEK_WINDOW_DAYS, now).length,
    answerGaps: answerGaps(state.lastVis),
    kbGaps: kbGapCount(state.kb),
    highFindings:
      state.lastAudit === null ? null : countBySeverity(state.lastAudit.findings).high,
    auditTaskTitles: state.artifacts
      .filter((artifact) => artifact.module === "audit" && artifact.type === "prompt")
      .map((artifact) => artifact.title),
    events: weekFeed(state, now),
  };
}

function borderlineCount(summary: WeekSummary): number | null {
  return summary.borderline === null ? null : summary.borderline.length;
}

/**
 * What to start with next week, in a fixed order, each with the page to do it
 * on (Q21: borderline queries go to `keywords`). A step appears only when its
 * count is known and above zero; with none, one `keepGoing` step.
 */
export function weekNextSteps(summary: WeekSummary): readonly WeekNextStep[] {
  const candidates: readonly (readonly [WeekStepId, number | null, WorkbenchPageId])[] = [
    ["fixHigh", summary.highFindings, "audit"],
    ["answerGaps", summary.answerGaps, "answers"],
    ["borderline", borderlineCount(summary), "keywords"],
    ["kbGaps", summary.kbGaps, "kb"],
  ];
  const steps = candidates.flatMap(([id, count, target]) =>
    count !== null && count > 0 ? [{ id, count, target }] : [],
  );
  return steps.length > 0 ? steps : [{ id: "keepGoing", count: null, target: "content" }];
}

/** The builder's input: the numbers this page shows, nothing recomputed. */
export function weeklyReportInput(
  summary: WeekSummary,
  brand: string,
  now: Date,
): WeeklyReportInput {
  return {
    brand,
    ...weekRange(now),
    health: summary.health,
    mention: summary.mention,
    artifactsThisWeek: summary.artifactsThisWeek,
    borderline: borderlineCount(summary),
    answerGaps: summary.answerGaps,
    kbGaps: summary.kbGaps,
    highFindings: summary.highFindings,
    auditTaskTitles: summary.auditTaskTitles,
    events: summary.events,
  };
}
