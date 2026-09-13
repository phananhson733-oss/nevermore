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
 * A change is only given between two measurements of the same thing (codex
 * S7a #1 / #2); the latest value is shown either way. Two audits are compared
 * only when they list the same checked pages (`pageRows` URLs; an audit that
 * lists none cannot be shown to match), so a page the latest check never looked
 * at is not counted as better, and the report names the earlier check it did
 * not compare (`incomparableAt`). Two visibility runs are compared only when
 * they asked the same prompts on the same platforms, repeats counted, so
 * dropping a platform that missed does not read as a rise.
 *
 * The mention-rate delta is in whole points: the difference of the two shares
 * as `formatShare` rounds them, so `+6pt` next to 35% reads against the 29% the
 * report prints for the earlier run. When either share prints as a band
 * (`<1%` / `>99%`) there is no whole-point difference to give: the earlier run
 * keeps its stamp and share, and `deltaPt` is `null` (codex S7a #7).
 *
 * The date range is `weekWindow` (`week-feed.ts`), the same one the subtitle,
 * the artifact count and the feed use (codex S7a #9). The cards show the latest
 * check however old, so `healthInWindow` / `mentionInWindow` say whether that
 * check ran inside the range; the cards print its stamp and, when it did not,
 * that the range holds no newer check (S7a #6).
 *
 * Borderline queries are GSC rows at positions 11-30, by `gscStatus` and with
 * `nearCount`'s unknown rule (`mock/profile.ts`), read from the imported rows
 * themselves: the card's footnote says "positions in the latest GSC import".
 * They are a list, not a movement (Q17) — the store keeps no position history.
 */
import { countBySeverity, diffAudits } from "@/lib/workbench/mock/audit";
import type {
  WeekAuditComparison,
  WeekEvent,
  WeekHealth,
  WeekMention,
  WeeklyReportInput,
} from "@/lib/workbench/mock/builders/week";
import { gscStatus } from "@/lib/workbench/mock/gsc";
import { kbGapCount } from "@/lib/workbench/mock/kb";
import { missedPrompts } from "@/lib/workbench/mock/visibility";
import type { WorkbenchPageId } from "@/lib/workbench/routes";
import { formatShare } from "@/lib/workbench/store/selectors";
import type {
  AuditReport,
  GscRow,
  VisResult,
  VisSnapshot,
  WorkbenchProjectState,
} from "@/lib/workbench/types";
import { artifactsInWeek, inWeekWindow, weekFeed, weekWindow } from "./week-feed.ts";

export interface BorderlineQuery {
  readonly query: string;
  readonly position: number;
}

export interface WeekSummary {
  /** Nothing to show at all: the page renders its empty state and the report cannot be saved. */
  readonly empty: boolean;
  readonly health: WeekHealth | null;
  /** The audit behind `health` ran inside the date range; `false` when there is none. */
  readonly healthInWindow: boolean;
  readonly mention: WeekMention | null;
  /** The visibility run behind `mention` ran inside the date range; `false` when there is none. */
  readonly mentionInWindow: boolean;
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

/** The subtitle's and the report title's dates: `weekWindow`, the range every count here uses. */
export function weekRange(now: Date): { readonly from: string; readonly to: string } {
  const { from, to } = weekWindow(now);
  return { from, to };
}

/** Code-unit order, not `localeCompare`: whether two runs match must not depend on the browser's locale. */
function sortedKeys(keys: readonly string[]): readonly string[] {
  return keys.toSorted();
}

/** Same keys, each as many times: two `sortedKeys` lists compared position by position. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function checkedPages(report: AuditReport): readonly string[] {
  return sortedKeys(report.pageRows.map((row) => row.url));
}

function comparableAudits(latest: AuditReport, earlier: AuditReport): boolean {
  const pages = checkedPages(latest);
  return pages.length > 0 && sameKeys(pages, checkedPages(earlier));
}

function auditComparison(latest: AuditReport, earlier: AuditReport): WeekAuditComparison | null {
  const delta = comparableAudits(latest, earlier) ? diffAudits(latest, earlier) : null;
  if (delta === null) return null;
  return {
    at: earlier.at,
    scoreDelta: delta.score,
    noLonger: delta.fixed.map((finding) => finding.t),
    newly: delta.added.map((finding) => finding.t),
  };
}

function health(state: WeekSummaryState): WeekHealth | null {
  const latest = state.lastAudit;
  if (latest === null) return null;
  const earlier = state.auditHistory.at(-1) ?? null;
  const previous = earlier === null ? null : auditComparison(latest, earlier);
  return {
    at: latest.at,
    score: latest.score,
    previous,
    incomparableAt: earlier !== null && previous === null ? earlier.at : null,
  };
}

function hitCount(results: readonly VisResult[]): number {
  return results.filter((result) => result.hit).length;
}

function roundedShare(results: readonly VisResult[]): number {
  return Math.round((hitCount(results) * 100) / results.length);
}

/** Each result's prompt and platform, as JSON so no separator lets two different pairs collide. */
function askedProbes(results: readonly VisResult[]): readonly string[] {
  return sortedKeys(results.map((result) => JSON.stringify([result.p, result.platform])));
}

/** A share `formatShare` prints as a whole percentage, not as the `<1%` / `>99%` band. */
const WHOLE_SHARE = /^\d+%$/u;

function previousMention(
  latest: readonly VisResult[],
  latestShare: string,
  earlier: VisSnapshot | null,
): WeekMention["previous"] {
  // An earlier run that returned nothing asked nothing, so it never matches a latest run that did.
  if (earlier === null || !sameKeys(askedProbes(latest), askedProbes(earlier.results))) return null;
  const share = formatShare(hitCount(earlier.results), earlier.results.length);
  const whole = WHOLE_SHARE.test(share) && WHOLE_SHARE.test(latestShare);
  return {
    at: earlier.at,
    share,
    deltaPt: whole ? roundedShare(latest) - roundedShare(earlier.results) : null,
  };
}

function mention(state: WeekSummaryState): WeekMention | null {
  const latest = state.lastVis;
  if (latest === null || latest.results.length === 0) return null;
  const hits = hitCount(latest.results);
  const total = latest.results.length;
  const share = formatShare(hits, total);
  return {
    at: latest.at,
    share,
    hits,
    total,
    previous: previousMention(latest.results, share, state.visHistory.at(-1) ?? null),
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
  const range = weekWindow(now);
  const latestHealth = health(state);
  const latestMention = mention(state);
  return {
    empty: isEmpty(state),
    health: latestHealth,
    healthInWindow: latestHealth !== null && inWeekWindow(latestHealth.at, range),
    mention: latestMention,
    mentionInWindow: latestMention !== null && inWeekWindow(latestMention.at, range),
    borderline: borderline(state.gscRows),
    artifactsThisWeek: artifactsInWeek(state.artifacts, range).length,
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
