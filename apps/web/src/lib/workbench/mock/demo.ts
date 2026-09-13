/**
 * The sample site (jsx:2719-2763, R8-R11). Both levels share one setup: GSC
 * connected (GA4 never: the sample has no analytics), sample GSC rows, the
 * keyword matrix, saved keywords and the current audit. `full` adds every other
 * module on top of that same data. Nothing here reads the clock: `deps.now` is
 * the only time source and every id is fixed. The payload is a fresh literal
 * with exactly the `DemoPayload` keys, so `loadDemo` can never write `profile`,
 * `notify` or anything else.
 *
 * Honesty rules the sample keeps (demo-honesty.test.ts): the AI profile and
 * knowledge-base fills are bracketed placeholders built from the profile, never
 * GenGrowth's own facts; a fill is an unchecked AI draft, not a manual entry;
 * competitors are the names entered, never invented domains; the profile crawl
 * is the sample audit's; and with GSC connected, our gap rank is GSC's or null.
 */
import type {
  AuditReport,
  Connections,
  DemoPayload,
  GapRow,
  GscRow,
  KbEntry,
  KeywordRow,
  KnowledgeBase,
  Profile,
  ProfileDoc,
  SavedKeyword,
  VisSnapshot,
} from "../types.ts";
import { plansFor } from "./answers.ts";
import { runAudit } from "./audit.ts";
import { buildCompData, comparedCompetitors, keywordGap } from "./competitors.ts";
import { demoArtifacts } from "./demo-artifacts.ts";
import { demoGsc } from "./demo-gsc.ts";
import { buildRows } from "./keywords.ts";
import { fillFirstKbGap, seedKb } from "./kb.ts";
import { DEFAULT_LINK_TYPES, mockLinks } from "./links.ts";
import { brandOrPlaceholder, crawlSignals, demoAiDoc, gscSignals } from "./profile.ts";
import { normQ, splitList } from "./text.ts";
import { daysAgo } from "./time.ts";
import { VIS_PROMPT_LIMIT, localPromptSet, missedPrompts, mockVisibility } from "./visibility.ts";

export const DEMO_LEVEL = "full" as const;
/** Non-empty tuple: `DEMO_SEEDS[0]` stays a `string` under `noUncheckedIndexedAccess`. */
export const DEMO_SEEDS = ["ai visibility", "geo optimization", "content brief", "llm seo"] as const satisfies readonly [
  string,
  ...string[],
];
export type DemoLevel = "full" | "basic";
export interface DemoDeps {
  readonly now: Date;
  /** Localised provenance line for an artifact stamped at `at` (the caller owns next-intl). */
  readonly provenanceLine: (at: string) => string;
}

type ModuleFields = Pick<
  DemoPayload,
  "auditHistory" | "visResults" | "visHistory" | "lastVis" | "compData" | "plans" | "targets" | "kb" | "artifacts" | "profileDoc"
>;
type KbPatch = Pick<KbEntry, "statement" | "evidence" | "source" | "from">;

interface SharedInit {
  readonly conns: Connections;
  readonly gscRows: readonly GscRow[];
  readonly rows: readonly KeywordRow[];
  readonly saved: readonly SavedKeyword[];
  readonly audit: AuditReport;
}

interface DemoVisibility {
  readonly lastVis: VisSnapshot;
  readonly history: readonly VisSnapshot[];
}

const MATRIX_SAVED_LIMIT = 4;
const TOP_TEN = 10;
const PLAN_LIMIT = 2;
const SAMPLE_FILL_EVIDENCE = "示例，未核对";

/* ---------------- shared ---------------- */

function gapSaved(row: GapRow, now: Date): SavedKeyword {
  const inTopTen = row.ranks.filter((rank) => rank !== null && rank <= TOP_TEN).length;
  const entry: SavedKeyword = { q: row.q, addedAt: daysAgo(now, 1, 10), source: "gap" };
  return inTopTen > 0 ? { ...entry, note: `竞品 ${inTopTen} 家在前 10` } : entry;
}

/** The first four borderline matrix rows, then the first gap row not already saved (unique by `normQ`). */
function savedKeywords(profile: Profile, seedQueries: readonly string[], shared: Pick<SharedInit, "rows" | "gscRows">, now: Date): readonly SavedKeyword[] {
  const matrix = shared.rows
    .filter((row) => row.gscStatus === "borderline")
    .slice(0, MATRIX_SAVED_LIMIT)
    .map((row, i): SavedKeyword => ({ q: row.q, addedAt: daysAgo(now, 3 + i, 15), source: "matrix" }));
  const taken = new Set(matrix.map((entry) => normQ(entry.q)));
  const gap = keywordGap(profile, seedQueries, shared.gscRows).rows.find((row) => !taken.has(normQ(row.q)));
  return gap === undefined ? matrix : [...matrix, gapSaved(gap, now)];
}

function sharedInit(profile: Profile, seedQueries: readonly string[], now: Date): SharedInit {
  const gscRows = demoGsc(profile, seedQueries);
  const rows = buildRows(seedQueries, profile, gscRows);
  return {
    conns: { GSC: true, GA4: false },
    gscRows,
    rows,
    saved: savedKeywords(profile, seedQueries, { rows, gscRows }, now),
    audit: runAudit(profile, { at: daysAgo(now, 0, 9), salt: "demo-cur" }),
  };
}

/** The initial values of every module field: `basic` stops after the shared setup. */
function basicModules(): ModuleFields {
  return {
    auditHistory: [],
    visResults: [],
    visHistory: [],
    lastVis: null,
    compData: null,
    plans: {},
    targets: null,
    kb: null,
    artifacts: [],
    profileDoc: null,
  };
}

/* ---------------- full ---------------- */

function demoVisibility(profile: Profile, rows: readonly KeywordRow[], now: Date): DemoVisibility {
  const prompts = localPromptSet(profile, rows)
    .map((seed) => seed.q)
    .slice(0, VIS_PROMPT_LIMIT);
  return {
    lastVis: { at: daysAgo(now, 0, 11), results: mockVisibility(profile, prompts, "demo-cur") },
    history: [{ at: daysAgo(now, 7, 11), results: mockVisibility(profile, prompts, "demo-prev") }],
  };
}

/** The crawl takes the sample audit, so pages, indexed and page flags agree with it; the third-party estimate stays generated. */
function demoProfileDoc(profile: Profile, shared: SharedInit, now: Date): ProfileDoc {
  return {
    crawl: crawlSignals(profile, "crawl", shared.audit),
    gsc: gscSignals(profile, shared.gscRows),
    third: crawlSignals(profile, "third"),
    ai: demoAiDoc(profile),
    at: daysAgo(now, 3, 15),
  };
}

function sampleFill(statement: string): KbPatch {
  return { statement, evidence: SAMPLE_FILL_EVIDENCE, source: "", from: "aiDraft" };
}

/** A competitor the user entered that is not the brand or the own site; never a placeholder. */
function comparisonRival(profile: Profile): string | undefined {
  return splitList(profile.competitors).length === 0 ? undefined : comparedCompetitors(profile)[0];
}

/** `seedKb`, then unchecked sample drafts in the pricing, boundary and (with a real competitor) comparison gaps. */
function demoKb(profile: Profile, doc: ProfileDoc, at: string): KnowledgeBase {
  const brand = brandOrPlaceholder(profile.brand);
  const priced = fillFirstKbGap(
    seedKb(profile, doc),
    "pricing",
    sampleFill(`[示例] ${brand} 的免费档与付费档分别包含什么（待补定价页原句）`),
    "kb-demo-pricing",
  );
  const bounded = fillFirstKbGap(priced, "boundary", sampleFill(`[示例] 不适合 ${brand} 的团队或场景（待补）`), "kb-demo-boundary");
  const rival = comparisonRival(profile);
  const entries =
    rival === undefined
      ? bounded
      : fillFirstKbGap(bounded, "comparison", sampleFill(`[示例] 与 ${rival} 相比，${brand} 的差别（待补对比页原句）`), "kb-demo-comparison");
  return { entries, at };
}

function fullModules(profile: Profile, seedQueries: readonly string[], shared: SharedInit, deps: DemoDeps): ModuleFields {
  const { now } = deps;
  const visibility = demoVisibility(profile, shared.rows, now);
  const profileDoc = demoProfileDoc(profile, shared, now);
  const kb = demoKb(profile, profileDoc, daysAgo(now, 2, 16));
  const { lastVis } = visibility;
  return {
    auditHistory: [
      runAudit(profile, { at: daysAgo(now, 14, 10), salt: "demo-prev2" }),
      runAudit(profile, { at: daysAgo(now, 7, 10), salt: "demo-prev" }),
    ],
    visResults: lastVis.results,
    visHistory: visibility.history,
    lastVis,
    compData: buildCompData(profile, seedQueries, shared.gscRows, daysAgo(now, 2, 14)),
    plans: plansFor(missedPrompts(lastVis.results).slice(0, PLAN_LIMIT), profile),
    targets: mockLinks(profile, DEFAULT_LINK_TYPES),
    kb,
    artifacts: demoArtifacts({ profile, rows: shared.rows, audit: shared.audit, kb, lastVis, fallbackTarget: DEMO_SEEDS[0], deps }),
    profileDoc,
  };
}

/* ---------------- payload ---------------- */

export function makeDemoSite(profile: Profile, level: DemoLevel, seedQueries: readonly string[], deps: DemoDeps): DemoPayload {
  const shared = sharedInit(profile, seedQueries, deps.now);
  const modules = level === "full" ? fullModules(profile, seedQueries, shared, deps) : basicModules();
  const seedText = seedQueries.join("\n");
  return {
    conns: shared.conns,
    gscRows: shared.gscRows,
    seeds: seedText,
    built: true,
    saved: shared.saved,
    audit: shared.audit,
    auditHistory: modules.auditHistory,
    lastAudit: shared.audit,
    visResults: modules.visResults,
    visHistory: modules.visHistory,
    lastVis: modules.lastVis,
    compData: modules.compData,
    plans: modules.plans,
    targets: modules.targets,
    kb: modules.kb,
    artifacts: modules.artifacts,
    profileDoc: modules.profileDoc,
  };
}
