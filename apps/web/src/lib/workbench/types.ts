/**
 * Workbench domain types (design §6.1). Every enum is an id, never display
 * copy: labels come from `workbench.enums.*`. Shapes mirror the behavioural
 * prototype (.workbench-reference/geo-seo-workbench.jsx) so PR-2 can port the
 * mock functions without re-deciding them.
 */
export type Severity = "high" | "mid" | "low";
/** The prototype's `engine: ""` (weekly report, misc exports) maps to `"both"`; there is no "no engine" value. */
export type Engine = "seo" | "geo" | "both";
export type Level = "high" | "mid" | "low";
export type GscStatus = "ranked" | "borderline" | "gap" | "unknown";
export type Intent =
  | "navigational"
  | "informational"
  | "commercial"
  | "transactional";
export type Stage = "TOFU" | "MOFU" | "BOFU";
export type PageType =
  | "landing"
  | "blog"
  | "comparison"
  | "listicle"
  | "tool"
  | "glossary"
  | "answer-page";
export type KeywordSource = "gsc" | "generated";
export type SavedSource = "matrix" | "manual" | "gap";
export type PromptKind =
  | "discover"
  | "compare"
  | "verify"
  | "alternative"
  | "scenario";
export type KbCategory =
  | "definition"
  | "capability"
  | "boundary"
  | "pricing"
  | "comparison"
  | "data"
  | "faq";
export type KbOrigin = "crawl" | "gap" | "aiDraft" | "manual";
export type LinkType = "dir" | "agg" | "comm" | "rev" | "media" | "swap";
export type ArtifactType = "csv" | "prompt" | "md" | "json";
export type ModuleId =
  | "audit"
  | "visibility"
  | "keywords"
  | "keywordLibrary"
  | "competitors"
  | "links"
  | "content"
  | "kb"
  | "answers"
  | "profile"
  | "week";

export interface Profile {
  readonly url: string;
  readonly brand: string;
  readonly positioning: string;
  readonly features: string;
  readonly competitors: string;
  readonly market: string;
}

export interface GscRow {
  readonly query: string;
  readonly clicks: number | null;
  readonly impressions: number | null;
  readonly ctr: number | null;
  readonly position: number | null;
}

export interface Finding {
  readonly id: string;
  readonly cat: string;
  readonly t: string;
  readonly sev: Severity;
  readonly eng: Engine;
  readonly found: string;
  readonly expect: string;
  readonly fix: string;
  readonly w: number;
  readonly page: string;
}

export interface AuditCrawl {
  readonly pages: number;
  readonly indexable: number;
  readonly blocked: number;
  readonly orphan: number;
  readonly lcp: string;
  readonly schema: number;
  readonly llmReadable: number;
}

export interface AuditPageRow {
  readonly url: string;
  readonly status: number;
  readonly h1: number;
  readonly hasSchema: boolean;
  readonly lcp: string;
  readonly issues: number;
}

export interface AuditReport {
  readonly at: string;
  readonly score: number;
  readonly findings: readonly Finding[];
  readonly crawl: AuditCrawl;
  readonly pageRows: readonly AuditPageRow[];
}

export interface VisResult {
  readonly p: string;
  readonly platform: string;
  readonly hit: boolean;
  readonly rank: number | null;
  readonly brands: readonly string[];
  readonly domains: readonly string[];
  readonly real: false;
}

export interface VisSnapshot {
  readonly at: string;
  readonly results: readonly VisResult[];
}

export interface KeywordRow {
  readonly q: string;
  readonly seed: string;
  readonly intent: Intent;
  readonly stage: Stage;
  readonly page: PageType;
  readonly engine: Engine;
  readonly source: KeywordSource;
  readonly clicks?: number | null;
  readonly impressions?: number | null;
  readonly position?: number | null;
  readonly gscStatus?: GscStatus;
  readonly volume: number;
  readonly kd: number;
  readonly cpc: string;
  readonly aio: boolean;
  readonly score: number;
  readonly slug: string;
}

export interface SavedKeyword {
  readonly q: string;
  readonly addedAt: string;
  readonly source: SavedSource;
  readonly note?: string | undefined;
}

export interface DomainStats {
  readonly domain: string;
  readonly traffic: number;
  readonly kws: number;
  readonly dr: number;
  readonly refdomains: number;
  readonly topPages: readonly {
    readonly path: string;
    readonly share: number;
  }[];
}

export interface GapRow {
  readonly q: string;
  readonly volume: number;
  readonly kd: number;
  readonly cpc: string;
  readonly aio: boolean;
  readonly ranks: readonly (number | null)[];
  readonly ours: number | null;
  readonly page: PageType;
}

export interface CompData {
  readonly domains: readonly DomainStats[];
  readonly gap: {
    readonly comps: readonly string[];
    readonly rows: readonly GapRow[];
  };
  readonly at: string;
}

export interface AnswerPlan {
  readonly url: string;
  readonly h1: string;
  readonly lead: string;
  readonly subq: readonly string[];
  readonly facts: readonly string[];
  readonly dims: readonly string[];
  readonly faq: readonly string[];
  readonly internal: readonly string[];
  readonly schema: string;
  readonly beat: string;
}

export interface LinkTarget {
  readonly type: LinkType;
  readonly site: string;
  readonly domain: string;
  readonly dr: number;
  readonly relevance: Level;
  readonly difficulty: Level;
  readonly action: string;
  readonly asset: string;
}

export interface KbEntry {
  readonly id: string;
  readonly cat: KbCategory;
  readonly statement: string;
  readonly evidence: string;
  readonly source: string;
  readonly from: KbOrigin;
}

export interface KnowledgeBase {
  readonly entries: readonly KbEntry[];
  readonly at: string;
}

export interface CrawlSignals {
  readonly pages: number;
  readonly lang: string;
  readonly stack: string;
  readonly h1: string;
  readonly hasPricing: boolean;
  readonly hasDocs: boolean;
  readonly hasBlog: boolean;
  readonly indexed: number;
  readonly traffic: number;
  readonly dr: number;
  readonly refdomains: number;
}

export interface GscSignals {
  readonly total: number;
  readonly brandQueries: number;
  readonly brandClicks: number;
  readonly nonBrandClicks: number;
  readonly top: readonly GscRow[];
  readonly near: number;
}

export interface IcpSegment {
  readonly seg: string;
  readonly role: string;
  readonly pain: string;
  readonly trigger: string;
  readonly objection: string;
}

export interface AiDoc {
  readonly summary: string;
  readonly icp: readonly IcpSegment[];
  readonly value_props: readonly string[];
  readonly diff: readonly string[];
  readonly pillars: readonly string[];
  readonly facts: readonly string[];
  readonly tone: string;
}

export interface ProfileDoc {
  readonly crawl: CrawlSignals | null;
  readonly gsc: GscSignals | null;
  readonly third: CrawlSignals | null;
  readonly ai: AiDoc;
  readonly at: string;
}

export interface Artifact {
  readonly id: string;
  readonly at: string;
  readonly module: ModuleId;
  readonly type: ArtifactType;
  readonly engine: Engine;
  readonly title: string;
  readonly content: string;
  readonly filename?: string | undefined;
}

export interface NotifyPrefs {
  readonly weekly: boolean;
  readonly drop: boolean;
  readonly mention: boolean;
  readonly gsc: boolean;
}

export interface Connections {
  readonly GSC: boolean;
  readonly GA4: boolean;
}

export interface WorkbenchProjectState {
  readonly profile: Profile;
  readonly profileDoc: ProfileDoc | null;
  readonly conns: Connections;
  readonly gscRows: readonly GscRow[];
  readonly seeds: string;
  readonly built: boolean;
  readonly saved: readonly SavedKeyword[];
  readonly audit: AuditReport | null;
  readonly auditHistory: readonly AuditReport[];
  readonly lastAudit: AuditReport | null;
  readonly visResults: readonly VisResult[];
  /** True while a visibility run is in flight. Persisted, so a reload can tell streamed partial results from a completed run (design §6.4). */
  readonly visPartial: boolean;
  readonly visHistory: readonly VisSnapshot[];
  readonly lastVis: VisSnapshot | null;
  readonly compData: CompData | null;
  readonly plans: Readonly<Record<string, AnswerPlan>>;
  readonly targets: readonly LinkTarget[] | null;
  readonly kb: KnowledgeBase | null;
  readonly artifacts: readonly Artifact[];
  readonly notify: NotifyPrefs;
  readonly demo: boolean;
}

export const ARTIFACT_LIMIT = 50;
export const HISTORY_LIMIT = 12;

/** What `makeDemoSite` (PR-2) produces and `loadDemo` writes — never `profile` or `notify` (design §6.4). */
export type DemoPayload = Pick<
  WorkbenchProjectState,
  | "conns"
  | "gscRows"
  | "seeds"
  | "built"
  | "saved"
  | "audit"
  | "auditHistory"
  | "lastAudit"
  | "visResults"
  | "visHistory"
  | "lastVis"
  | "compData"
  | "plans"
  | "targets"
  | "kb"
  | "artifacts"
  | "profileDoc"
>;
