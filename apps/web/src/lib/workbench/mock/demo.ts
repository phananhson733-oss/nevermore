/**
 * The sample site (jsx:2719-2763, R8-R11). Both levels share one setup: GSC
 * connected (GA4 never: the sample has no analytics), sample GSC rows, the
 * keyword matrix, saved keywords and the current audit. `full` adds every other
 * module on top of that same data. Nothing here reads the clock: `deps.now` is
 * the only time source, every id is fixed, and no stamp lands after `now`. The
 * payload is a fresh literal with exactly the `DemoPayload` keys, so `loadDemo`
 * can never write `profile`, `notify` or anything else.
 *
 * Honesty rules the sample keeps (demo-honesty.test.ts): the AI profile and
 * knowledge-base fills are bracketed placeholders built from the profile, never
 * GenGrowth's own facts; a fill is an unchecked AI draft, not a manual entry;
 * competitors are the names entered, never invented domains, the brand or the
 * own site; the profile crawl is the sample audit's; and with GSC connected, our
 * gap rank is GSC's or null.
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
import { buildCompData, keywordGap } from "./competitors.ts";
import { demoArtifacts } from "./demo-artifacts.ts";
import type { DemoLevel } from "./demo-constants.ts";
import { demoGsc } from "./demo-gsc.ts";
import { buildRows } from "./keywords.ts";
import { enteredComparedCompetitors, fillFirstKbGap, seedKb } from "./kb.ts";
import { DEFAULT_LINK_TYPES, mockLinks } from "./links.ts";
import { brandOrPlaceholder, crawlSignals, demoAiDoc, gscSignals } from "./profile.ts";
import { normQ } from "./text.ts";
import { daysAgo, formatLocalStamp, parseLocalStamp } from "./time.ts";
import { VIS_PROMPT_LIMIT, localPromptSet, missedPrompts, mockVisibility } from "./visibility.ts";

export { DEMO_LEVEL, DEMO_SEEDS, type DemoLevel } from "./demo-constants.ts";

export interface DemoDeps {
  readonly now: Date;
  /** Localised provenance line for an artifact stamped at `at` (the caller owns next-intl). */
  readonly provenanceLine: (at: string) => string;
}

/** `daysBack` days before now at `hour`, never after now. */
type StampAt = (daysBack: number, hour: number) => string;

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

/* ---------------- stamps ---------------- */

/**
 * `daysAgo`, clamped to now. Before today's sample hour has passed (09:05 for
 * the audit, 11:05 for visibility), `daysAgo(now, 0, hour)` is later today, and
 * a future stamp falls outside every `withinDays` window.
 */
function stamperFor(now: Date): StampAt {
  const nowStamp = formatLocalStamp(now);
  const latest = parseLocalStamp(nowStamp);
  return (daysBack, hour) => {
    const stamp = daysAgo(now, daysBack, hour);
    const parsed = parseLocalStamp(stamp);
    const afterNow = latest !== null && (parsed === null || parsed.getTime() > latest.getTime());
    return afterNow ? nowStamp : stamp;
  };
}

/* ---------------- shared ---------------- */

/** The first gap row whose query is not already saved under any spelling (`normQ`). */
export function firstUnsavedGapRow(rows: readonly GapRow[], saved: readonly Pick<SavedKeyword, "q">[]): GapRow | undefined {
  const taken = new Set(saved.map((entry) => normQ(entry.q)));
  return rows.find((row) => !taken.has(normQ(row.q)));
}

/**
 * A saved gap row. The note counts competitors ranked in the top ten, and only
 * when real competitors were entered: a placeholder's sample rank is no claim
 * about anyone. Without a count the note key is absent, not empty.
 */
export function gapSavedEntry(row: GapRow, addedAt: string, namesRealCompetitors: boolean): SavedKeyword {
  const inTopTen = row.ranks.filter((rank) => rank !== null && rank <= TOP_TEN).length;
  const entry: SavedKeyword = { q: row.q, addedAt, source: "gap" };
  return namesRealCompetitors && inTopTen > 0 ? { ...entry, note: `竞品 ${inTopTen} 家在前 10` } : entry;
}

/** The first four borderline matrix rows, then the first gap row not already saved. */
function savedKeywords(
  profile: Profile,
  seedQueries: readonly string[],
  shared: Pick<SharedInit, "rows" | "gscRows">,
  at: StampAt,
): readonly SavedKeyword[] {
  const matrix = shared.rows
    .filter((row) => row.gscStatus === "borderline")
    .slice(0, MATRIX_SAVED_LIMIT)
    .map((row, i): SavedKeyword => ({ q: row.q, addedAt: at(3 + i, 15), source: "matrix" }));
  const gap = firstUnsavedGapRow(keywordGap(profile, seedQueries, shared.gscRows).rows, matrix);
  if (gap === undefined) return matrix;
  return [...matrix, gapSavedEntry(gap, at(1, 10), enteredComparedCompetitors(profile).length > 0)];
}

function sharedInit(profile: Profile, seedQueries: readonly string[], at: StampAt): SharedInit {
  const gscRows = demoGsc(profile, seedQueries);
  const rows = buildRows(seedQueries, profile, gscRows);
  return {
    conns: { GSC: true, GA4: false },
    gscRows,
    rows,
    saved: savedKeywords(profile, seedQueries, { rows, gscRows }, at),
    audit: runAudit(profile, { at: at(0, 9), salt: "demo-cur" }),
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

function demoVisibility(profile: Profile, rows: readonly KeywordRow[], at: StampAt): DemoVisibility {
  const prompts = localPromptSet(profile, rows)
    .map((seed) => seed.q)
    .slice(0, VIS_PROMPT_LIMIT);
  return {
    lastVis: { at: at(0, 11), results: mockVisibility(profile, prompts, "demo-cur") },
    history: [{ at: at(7, 11), results: mockVisibility(profile, prompts, "demo-prev") }],
  };
}

/** The crawl takes the sample audit, so pages, indexable and page flags agree with it; the third-party estimate stays generated. */
function demoProfileDoc(profile: Profile, shared: SharedInit, at: StampAt): ProfileDoc {
  return {
    crawl: crawlSignals(profile, "crawl", shared.audit),
    gsc: gscSignals(profile, shared.gscRows),
    // The sample site's rows are the sample's, frozen into the snapshot (Q6).
    gscSource: shared.gscRows.length === 0 ? null : "sample",
    third: crawlSignals(profile, "third"),
    ai: demoAiDoc(profile),
    at: at(3, 15),
  };
}

function sampleFill(statement: string): KbPatch {
  return { statement, evidence: SAMPLE_FILL_EVIDENCE, source: "", from: "aiDraft" };
}

/** `seedKb` (its AI facts as unchecked sample drafts), then unchecked sample drafts in the pricing, boundary and (with a real competitor) comparison gaps. */
function demoKb(profile: Profile, doc: ProfileDoc, at: string): KnowledgeBase {
  const brand = brandOrPlaceholder(profile.brand);
  const priced = fillFirstKbGap(
    seedKb(profile, doc, { aiEvidence: SAMPLE_FILL_EVIDENCE }),
    "pricing",
    sampleFill(`[示例] ${brand} 的定价方式与各档分别包含什么（待补定价页原句）`),
    "kb-demo-pricing",
  );
  const bounded = fillFirstKbGap(priced, "boundary", sampleFill(`[示例] 不适合 ${brand} 的团队或场景（待补）`), "kb-demo-boundary");
  const rival = enteredComparedCompetitors(profile)[0];
  const entries =
    rival === undefined
      ? bounded
      : fillFirstKbGap(bounded, "comparison", sampleFill(`[示例] 与 ${rival} 相比，${brand} 的差别（待补对比页原句）`), "kb-demo-comparison");
  return { entries, at };
}

function fullModules(profile: Profile, seedQueries: readonly string[], shared: SharedInit, deps: DemoDeps, at: StampAt): ModuleFields {
  const { lastVis, history } = demoVisibility(profile, shared.rows, at);
  const profileDoc = demoProfileDoc(profile, shared, at);
  const kb = demoKb(profile, profileDoc, at(2, 16));
  return {
    auditHistory: [
      runAudit(profile, { at: at(14, 10), salt: "demo-prev2" }),
      runAudit(profile, { at: at(7, 10), salt: "demo-prev" }),
    ],
    visResults: lastVis.results,
    visHistory: history,
    lastVis,
    compData: buildCompData(profile, seedQueries, shared.gscRows, at(2, 14)),
    plans: plansFor(missedPrompts(lastVis.results).slice(0, PLAN_LIMIT), profile),
    targets: mockLinks(profile, DEFAULT_LINK_TYPES),
    kb,
    artifacts: demoArtifacts({
      profile,
      seedQueries,
      rows: shared.rows,
      audit: shared.audit,
      kb,
      lastVis,
      keywordsAt: at(1, 14),
      briefAt: at(4, 10),
      provenanceLine: deps.provenanceLine,
    }),
    profileDoc,
  };
}

/* ---------------- payload ---------------- */

export function makeDemoSite(profile: Profile, level: DemoLevel, seedQueries: readonly string[], deps: DemoDeps): DemoPayload {
  const at = stamperFor(deps.now);
  const shared = sharedInit(profile, seedQueries, at);
  const modules = level === "full" ? fullModules(profile, seedQueries, shared, deps, at) : basicModules();
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
