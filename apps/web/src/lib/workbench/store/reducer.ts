import {
  ARTIFACT_CONTENT_MAX,
  ARTIFACT_FILENAME_PATTERN,
  ARTIFACT_LIMIT,
  ARTIFACT_TITLE_MAX,
  HISTORY_LIMIT,
  type Artifact,
  type AuditReport,
  type Connections,
  type DemoPayload,
  type GscRow,
  type GscRowsSource,
  type KnowledgeBase,
  type LinkTarget,
  type NotifyPrefs,
  type Profile,
  type ProfileDoc,
  type SavedKeyword,
  type VisResult,
  type WorkbenchProjectState,
  type CompData,
  type AnswerPlan,
} from "../types.ts";
import { truncateUtf16 } from "../truncate.ts";

/** Fields mirrored from the real project (design §6.7). Never edited by mock pages. */
export interface ProjectSeed {
  readonly url: string;
  readonly brand: string;
  readonly market: string;
}

export type WorkbenchAction =
  | { readonly type: "patchProfile"; readonly patch: Partial<Pick<Profile, "positioning" | "features" | "competitors">> }
  | { readonly type: "setProfileDoc"; readonly doc: ProfileDoc | null }
  | { readonly type: "setConns"; readonly conns: Connections }
  // `source` is required, not optional (Q6): a caller that forgets where the
  // rows came from would otherwise leave the label from the previous import in
  // place, which is exactly the flip the snapshot field exists to prevent.
  | { readonly type: "setGscRows"; readonly rows: readonly GscRow[]; readonly source: GscRowsSource }
  | { readonly type: "setSeeds"; readonly seeds: string }
  | { readonly type: "setBuilt"; readonly built: boolean }
  | { readonly type: "setSaved"; readonly saved: readonly SavedKeyword[] }
  | { readonly type: "setCompData"; readonly data: CompData | null }
  | { readonly type: "setPlans"; readonly plans: Readonly<Record<string, AnswerPlan>> }
  | { readonly type: "setTargets"; readonly targets: readonly LinkTarget[] | null }
  | { readonly type: "setKb"; readonly kb: KnowledgeBase | null }
  | { readonly type: "setNotify"; readonly notify: NotifyPrefs }
  | { readonly type: "auditStart" }
  | { readonly type: "auditComplete"; readonly report: AuditReport }
  | { readonly type: "auditCancel" }
  | { readonly type: "visStart" }
  | { readonly type: "visProgress"; readonly results: readonly VisResult[] }
  | { readonly type: "visComplete"; readonly results: readonly VisResult[]; readonly at: string }
  | { readonly type: "visCancel" }
  | { readonly type: "addArtifact"; readonly artifact: Artifact }
  | { readonly type: "removeArtifact"; readonly id: string }
  | { readonly type: "clearArtifacts" }
  | { readonly type: "loadDemo"; readonly payload: DemoPayload }
  | { readonly type: "clearDemo" }
  | { readonly type: "loadPersisted"; readonly state: WorkbenchProjectState }
  | { readonly type: "reset"; readonly seed: ProjectSeed };

/** Exported for the settings page: it renders these when `notify` is untouched. */
export const DEFAULT_NOTIFY: NotifyPrefs = { weekly: true, drop: true, mention: false, gsc: true };

/**
 * Rows and their provenance move together (Q6): no rows, no source. Written in
 * one place so `setGscRows` and `loadDemo` cannot disagree, and so no surface
 * can read a source that belongs to rows that are gone.
 */
function sourceFor(rows: readonly GscRow[], source: GscRowsSource): GscRowsSource | null {
  return rows.length === 0 ? null : source;
}

export function initialProjectState(seed: ProjectSeed): WorkbenchProjectState {
  return {
    profile: { url: seed.url, brand: seed.brand, market: seed.market, positioning: "", features: "", competitors: "" },
    profileDoc: null,
    conns: { GSC: false, GA4: false },
    gscRows: [],
    gscRowsSource: null,
    seeds: "",
    built: false,
    saved: [],
    audit: null,
    auditHistory: [],
    lastAudit: null,
    visResults: [],
    visPartial: false,
    visHistory: [],
    lastVis: null,
    compData: null,
    plans: {},
    targets: null,
    kb: null,
    artifacts: [],
    notify: DEFAULT_NOTIFY,
    demo: false,
  };
}

/** Re-apply the real project mirror after hydration (design §6.7). */
export function withProjectSeed(state: WorkbenchProjectState, seed: ProjectSeed): WorkbenchProjectState {
  return { ...state, profile: { ...state.profile, url: seed.url, brand: seed.brand, market: seed.market } };
}

/**
 * Clamp an incoming artifact to the persisted bounds (types.ts). The schema
 * rejects a stored envelope that exceeds them, and a rejected envelope resets
 * the whole project on the next load — so an oversized producer must be cut
 * down here, on the way in, never let through to be discarded later. Content
 * and title are truncated; a filename that is not a bare, short file name is
 * dropped (the drawer then names the download after the title).
 */
function boundArtifact(artifact: Artifact): Artifact {
  const filename =
    artifact.filename !== undefined && ARTIFACT_FILENAME_PATTERN.test(artifact.filename)
      ? artifact.filename
      : undefined;
  return {
    ...artifact,
    title: truncateUtf16(artifact.title, ARTIFACT_TITLE_MAX),
    content: truncateUtf16(artifact.content, ARTIFACT_CONTENT_MAX),
    filename,
  };
}

/** Archive the previous entry. `current` keeps a repeated dispatch of the same object out of the history. */
function archive<T>(history: readonly T[], item: T | null, current: T | null): readonly T[] {
  if (item === null || item === current) return history;
  return [...history, item].slice(-HISTORY_LIMIT);
}

/** `setSaved` semantics (design §6.4): incoming entries win, except `addedAt` / `source` of words already saved; duplicates in `next` collapse to the first. */
function mergeSaved(previous: readonly SavedKeyword[], next: readonly SavedKeyword[]): readonly SavedKeyword[] {
  // Indexed once; a `find` per incoming entry made the merge O(previous × next).
  // Built first-wins so a repeated `q` in `previous` resolves to its first copy.
  const prevByQ = new Map<string, SavedKeyword>();
  for (const p of previous) if (!prevByQ.has(p.q)) prevByQ.set(p.q, p);
  const seen = new Set<string>();
  const merged: SavedKeyword[] = [];
  for (const entry of next) {
    if (seen.has(entry.q)) continue;
    seen.add(entry.q);
    const prev = prevByQ.get(entry.q);
    merged.push(prev ? { ...entry, addedAt: prev.addedAt, source: prev.source } : entry);
  }
  return merged;
}

export function reduce(state: WorkbenchProjectState, action: WorkbenchAction): WorkbenchProjectState {
  switch (action.type) {
    case "patchProfile":
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case "setProfileDoc":
      return { ...state, profileDoc: action.doc };
    case "setConns":
      return { ...state, conns: action.conns };
    case "setGscRows":
      return { ...state, gscRows: action.rows, gscRowsSource: sourceFor(action.rows, action.source) };
    case "setSeeds":
      return { ...state, seeds: action.seeds };
    case "setBuilt":
      return { ...state, built: action.built };
    case "setSaved":
      return { ...state, saved: mergeSaved(state.saved, action.saved) };
    case "setCompData":
      return { ...state, compData: action.data };
    case "setPlans":
      return { ...state, plans: action.plans };
    case "setTargets":
      return { ...state, targets: action.targets };
    case "setKb":
      return { ...state, kb: action.kb };
    case "setNotify":
      return { ...state, notify: action.notify };
    case "auditStart":
      return { ...state, audit: null };
    case "auditComplete":
      return {
        ...state,
        audit: action.report,
        lastAudit: action.report,
        auditHistory: archive(state.auditHistory, state.lastAudit, action.report),
      };
    case "auditCancel":
      return { ...state, audit: state.lastAudit };
    case "visStart":
      return { ...state, visResults: [], visPartial: true };
    case "visProgress":
      return { ...state, visResults: action.results, visPartial: true };
    case "visComplete":
      return {
        ...state,
        visResults: action.results,
        visPartial: false,
        lastVis: { at: action.at, results: action.results },
        // The snapshot is built here, so it is never reference-equal to `lastVis`.
        visHistory: archive(state.visHistory, state.lastVis, null),
      };
    case "visCancel":
      return { ...state, visResults: state.lastVis?.results ?? [], visPartial: false };
    case "addArtifact":
      // Full means refused, never "evict the oldest": nothing in the design, the
      // plan or the copy lets a save silently delete an earlier artifact, and the
      // row that dispatched it would still say "saved". The same state object
      // comes back, so no new reducer state is produced; `useAddArtifact` reads
      // that outcome back and the row says why.
      if (state.artifacts.length >= ARTIFACT_LIMIT) return state;
      // An id already in the basket is that artifact saved again: a double click,
      // or a retry after a save whose answer could not be read back
      // (`useAddArtifact`). The same state comes back, so one artifact never
      // becomes two rows sharing an id.
      if (state.artifacts.some((a) => a.id === action.artifact.id)) return state;
      return {
        ...state,
        artifacts: [boundArtifact(action.artifact), ...state.artifacts].slice(0, ARTIFACT_LIMIT),
      };
    case "removeArtifact":
      return { ...state, artifacts: state.artifacts.filter((a) => a.id !== action.id) };
    case "clearArtifacts":
      return { ...state, artifacts: [] };
    case "loadDemo":
      return {
        ...state,
        ...action.payload,
        auditHistory: action.payload.auditHistory.slice(-HISTORY_LIMIT),
        visHistory: action.payload.visHistory.slice(-HISTORY_LIMIT),
        artifacts: action.payload.artifacts.slice(0, ARTIFACT_LIMIT).map(boundArtifact),
        gscRowsSource: sourceFor(action.payload.gscRows, "sample"),
        visPartial: false,
        demo: true,
      };
    case "clearDemo": {
      // Runs the announced wholesale clear only while the state is still in
      // sample mode; `demo` is a mode flag, not field-by-field proof of where
      // each value came from. A confirm raised over the sample can
      // still dispatch after another tab's real state has replaced it (a
      // `loadPersisted` queued ahead of the click, on a screen not yet
      // re-rendered), and clearing then would wipe the user's own GSC rows. The
      // component's render-time reset cannot recall an action already sent, so
      // the precondition lives here. Same object back: no new reducer state is
      // produced.
      if (!state.demo) return state;
      const blank = initialProjectState({ url: state.profile.url, brand: state.profile.brand, market: state.profile.market });
      return { ...state, ...demoFields(blank), visPartial: false, demo: false };
    }
    case "loadPersisted":
      // By identity, never a spread: the provider recognises "this state came from storage" as `state === remoteStateRef.current` and skips the write-back.
      return action.state;
    case "reset":
      return initialProjectState(action.seed);
  }
}

/**
 * The exact field set `loadDemo` writes, so `clearDemo` can undo it
 * symmetrically. `gscRowsSource` rides along although it is not part of
 * `DemoPayload` (the mock layer never sets it): it belongs to `gscRows`, and
 * clearing the rows while leaving "sample" behind would give any reader that
 * looks at the source with no rows a provenance for data that is gone. (It
 * would not reach the next paste: `setGscRows` always rewrites the source.)
 */
function demoFields(s: WorkbenchProjectState): DemoPayload & Pick<WorkbenchProjectState, "gscRowsSource"> {
  return {
    conns: s.conns, gscRows: s.gscRows, gscRowsSource: s.gscRowsSource, seeds: s.seeds, built: s.built, saved: s.saved,
    audit: s.audit, auditHistory: s.auditHistory, lastAudit: s.lastAudit,
    visResults: s.visResults, visHistory: s.visHistory, lastVis: s.lastVis,
    compData: s.compData, plans: s.plans, targets: s.targets, kb: s.kb, artifacts: s.artifacts, profileDoc: s.profileDoc,
  };
}

/**
 * After first hydration (design §6.4). An interrupted audit run persisted
 * `audit = null` (the report is all-or-nothing); an interrupted visibility
 * run persisted `visPartial = true` with whatever results had streamed in.
 * Both fall back to the last completed snapshot. Note: right after a
 * completed run `audit === lastAudit` and `visResults === lastVis.results`
 * by reference; that identity does not survive the JSON round-trip, so
 * nothing may depend on it.
 *
 * First hydration only: the cross-tab `storage` path must not settle runs
 * (another tab may be mid-run). The GSC-source rule is deliberately not here
 * for that reason — it has to reach both load paths, so it is applied where
 * persisted state is parsed (`classifyPersistedState` in schema.ts).
 */
export function normalizeInterrupted(state: WorkbenchProjectState): WorkbenchProjectState {
  const audit = state.audit === null && state.lastAudit ? state.lastAudit : state.audit;
  if (!state.visPartial) return audit === state.audit ? state : { ...state, audit };
  return { ...state, audit, visResults: state.lastVis?.results ?? [], visPartial: false };
}
