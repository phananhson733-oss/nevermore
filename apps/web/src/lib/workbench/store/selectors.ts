/** Derived views over WorkbenchProjectState (design §6.3). Pure: no clock, no id generation. */
import { kbGapCount } from "../mock/kb.ts";
import { buildRows } from "../mock/keywords.ts";
import { mentionRate } from "../mock/visibility.ts";
import type { DemoPayload, KeywordRow, KnowledgeBase, VisResult, WorkbenchProjectState } from "../types.ts";

/** Seed text as typed: comma- or newline-separated, each entry trimmed, blank entries dropped. */
export function splitSeeds(seeds: string): readonly string[] {
  return seeds
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function seedList(state: WorkbenchProjectState): readonly string[] {
  return splitSeeds(state.seeds);
}

/**
 * Keyword matrix rows, ungated (R13).
 *
 * Not for render paths: this rebuilds the whole matrix on every call and
 * returns a new array each time. Components read `useWorkbench().keywordRows`
 * (memoized by `WorkbenchProvider` on its four inputs) and gate on
 * `state.built` themselves. This is for tests and non-render code.
 */
export function keywordRows(state: WorkbenchProjectState): readonly KeywordRow[] {
  return buildRows(seedList(state), state.profile, state.gscRows);
}

/**
 * The rows a view may show: none until the matrix has been built.
 *
 * Not for render paths, for the same reason as `keywordRows`: it rebuilds on
 * every call. Components read `useWorkbench().keywordRows` and gate on
 * `state.built`.
 */
export function gatedRows(state: WorkbenchProjectState): readonly KeywordRow[] {
  return state.built ? keywordRows(state) : [];
}

export function savedQueries(state: WorkbenchProjectState): readonly string[] {
  return state.saved.map((entry) => entry.q);
}

/** Sidebar badge values (design §4.3). `null` = no badge; zero is never shown. */
export interface WorkbenchCounts {
  readonly audit: string | null;
  readonly visibility: string | null;
  readonly keywords: string | null;
  readonly keywordLibrary: string | null;
  readonly competitors: string | null;
  readonly links: string | null;
  readonly kb: string | null;
  readonly artifacts: string | null;
  readonly dataSources: string | null;
}

function countOrNull(n: number): string | null {
  return n > 0 ? String(n) : null;
}

/**
 * R15, and the one share every surface prints (Q9): the sidebar badge, the
 * overview mention-rate card and the week tile all call this, so they cannot
 * round the same run differently.
 *
 * Zero hits is a measured result, so it shows "0%". A non-zero share never
 * reads "0%" and a share with misses never reads "100%". Both the thresholds
 * and the rounding use the exact share `hits * 100 / total`: going through the
 * rate loses halves, `(23 / 40) * 100` is 57.49999999999999.
 */
export function formatShare(hits: number, total: number): string {
  if (hits === 0) return "0%";
  if (hits * 100 < total) return "<1%";
  if (hits < total && hits * 100 > total * 99) return ">99%";
  return `${Math.round((hits * 100) / total)}%`;
}

function visibilityBadge(results: readonly VisResult[]): string | null {
  // `mentionRate` owns "nothing probed, no rate"; the badge needs the counts behind it.
  if (mentionRate(results) === null) return null;
  return formatShare(results.filter((r) => r.hit).length, results.length);
}

/** KB badge = entries still to be written (blank or pending placeholder), design §4.3. */
function kbBadge(kb: KnowledgeBase | null): string | null {
  const gaps = kbGapCount(kb);
  return gaps === null ? null : countOrNull(gaps);
}

export function selectCounts(
  state: WorkbenchProjectState,
  keywordRowCount: number | null,
): WorkbenchCounts {
  return {
    audit: state.audit ? String(state.audit.score) : null,
    visibility: visibilityBadge(state.visResults),
    keywords: keywordRowCount === null ? null : countOrNull(keywordRowCount),
    keywordLibrary: countOrNull(state.saved.length),
    competitors: state.compData ? countOrNull(state.compData.gap.rows.length) : null,
    links: state.targets ? countOrNull(state.targets.length) : null,
    kb: kbBadge(state.kb),
    artifacts: countOrNull(state.artifacts.length),
    dataSources: countOrNull(state.gscRows.length),
  };
}

/**
 * Whether loading the sample site would overwrite something (design §6.7, Q11).
 *
 * BY VALUE, never by reference: `initialProjectState` builds a new `[]` / `{}`
 * on every call and hydration replaces every object with one JSON.parse made,
 * so `state.gscRows !== blank.gscRows` is true for every project that ever
 * existed — a reference comparison would make an untouched project prompt for
 * confirmation while still passing every "one field changed" case.
 *
 * One predicate per field `loadDemo` writes, in a `Record` keyed by
 * `keyof DemoPayload`: a field added to the payload without a predicate here is
 * a compile error rather than a silent hole in the confirm dialog. `profile` and
 * `notify` are not payload fields (the sample never writes them), and
 * `gscRowsSource` is not user content on its own — it is non-null only when
 * `gscRows` is non-empty, which this table already asks about.
 */
const DEMO_FIELD_IS_BLANK: Readonly<Record<keyof DemoPayload, (state: WorkbenchProjectState) => boolean>> = {
  conns: (s) => s.conns.GSC === false && s.conns.GA4 === false,
  gscRows: (s) => s.gscRows.length === 0,
  seeds: (s) => s.seeds.trim() === "",
  built: (s) => s.built === false,
  saved: (s) => s.saved.length === 0,
  audit: (s) => s.audit === null,
  auditHistory: (s) => s.auditHistory.length === 0,
  lastAudit: (s) => s.lastAudit === null,
  visResults: (s) => s.visResults.length === 0,
  visHistory: (s) => s.visHistory.length === 0,
  lastVis: (s) => s.lastVis === null,
  compData: (s) => s.compData === null,
  plans: (s) => Object.keys(s.plans).length === 0,
  targets: (s) => s.targets === null,
  kb: (s) => s.kb === null,
  artifacts: (s) => s.artifacts.length === 0,
  profileDoc: (s) => s.profileDoc === null,
};

export function hasDemoOverwrite(state: WorkbenchProjectState): boolean {
  return Object.values(DEMO_FIELD_IS_BLANK).some((isBlank) => !isBlank(state));
}
