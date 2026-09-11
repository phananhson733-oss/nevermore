import {
  ARTIFACT_LIMIT,
  HISTORY_LIMIT,
  type Artifact,
  type AuditReport,
  type Connections,
  type DemoPayload,
  type GscRow,
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
  | { readonly type: "setGscRows"; readonly rows: readonly GscRow[] }
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

const DEFAULT_NOTIFY: NotifyPrefs = { weekly: true, drop: true, mention: false, gsc: true };

export function initialProjectState(seed: ProjectSeed): WorkbenchProjectState {
  return {
    profile: { url: seed.url, brand: seed.brand, market: seed.market, positioning: "", features: "", competitors: "" },
    profileDoc: null,
    conns: { GSC: false, GA4: false },
    gscRows: [],
    seeds: "",
    built: false,
    saved: [],
    audit: null,
    auditHistory: [],
    lastAudit: null,
    visResults: [],
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

function archive<T>(history: readonly T[], item: T | null): readonly T[] {
  if (item === null) return history;
  return [...history, item].slice(-HISTORY_LIMIT);
}

function mergeSaved(previous: readonly SavedKeyword[], next: readonly SavedKeyword[]): readonly SavedKeyword[] {
  return next.map((entry) => previous.find((p) => p.q === entry.q) ?? entry);
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
      return { ...state, gscRows: action.rows };
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
        auditHistory: archive(state.auditHistory, state.lastAudit),
      };
    case "auditCancel":
      return { ...state, audit: state.lastAudit };
    case "visStart":
      return { ...state, visResults: [] };
    case "visProgress":
      return { ...state, visResults: action.results };
    case "visComplete":
      return {
        ...state,
        visResults: action.results,
        lastVis: { at: action.at, results: action.results },
        visHistory: archive(state.visHistory, state.lastVis),
      };
    case "visCancel":
      return { ...state, visResults: state.lastVis?.results ?? [] };
    case "addArtifact":
      return { ...state, artifacts: [action.artifact, ...state.artifacts].slice(0, ARTIFACT_LIMIT) };
    case "removeArtifact":
      return { ...state, artifacts: state.artifacts.filter((a) => a.id !== action.id) };
    case "clearArtifacts":
      return { ...state, artifacts: [] };
    case "loadDemo":
      return { ...state, ...action.payload, demo: true };
    case "clearDemo": {
      const blank = initialProjectState({ url: state.profile.url, brand: state.profile.brand, market: state.profile.market });
      return { ...state, ...demoFields(blank), demo: false };
    }
    case "loadPersisted":
      return action.state;
    case "reset":
      return initialProjectState(action.seed);
  }
}

/** The exact field set `loadDemo` writes, so `clearDemo` can undo it symmetrically. */
function demoFields(s: WorkbenchProjectState): DemoPayload {
  return {
    conns: s.conns, gscRows: s.gscRows, seeds: s.seeds, built: s.built, saved: s.saved,
    audit: s.audit, auditHistory: s.auditHistory, lastAudit: s.lastAudit,
    visResults: s.visResults, visHistory: s.visHistory, lastVis: s.lastVis,
    compData: s.compData, plans: s.plans, targets: s.targets, kb: s.kb, artifacts: s.artifacts, profileDoc: s.profileDoc,
  };
}

/** After hydration: an interrupted run persisted `audit = null` / `visResults = []` (design §6.4). */
export function normalizeInterrupted(state: WorkbenchProjectState): WorkbenchProjectState {
  const audit = state.audit === null && state.lastAudit ? state.lastAudit : state.audit;
  const visResults = state.visResults.length === 0 && state.lastVis ? state.lastVis.results : state.visResults;
  if (audit === state.audit && visResults === state.visResults) return state;
  return { ...state, audit, visResults };
}
