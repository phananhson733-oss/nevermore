import type { SeoAuditRecord } from "../seo-audit/types.ts";

export type AgentAuditAgent = "seo" | "tech";
export type AgentAuditScope = "site" | "page";
export type AgentAuditResultState =
  | "blocker"
  | "warning"
  | "tip"
  | "pass"
  | "excluded";
export type AgentAuditEngineState =
  | "ready"
  | "needs-integration"
  | "needs-supplement"
  | "not-integrated"
  | "access-required";
export type AgentAuditTruthState =
  | "observed"
  | "not-observed"
  | "documented"
  | "inferred"
  | "partial"
  | "source-gated"
  | "unavailable"
  | "illustrative";
export type AgentAuditThresholdAuthority =
  | "official"
  | "industry"
  | "sop"
  | "judgment";

export interface AgentAuditLocalizedText {
  readonly en: string;
  readonly zh: string;
}

export interface AgentAuditCheckDefinition {
  readonly id: string;
  readonly scope: AgentAuditScope;
  readonly groupId: string;
  readonly title: AgentAuditLocalizedText;
  readonly impact: AgentAuditLocalizedText;
  readonly howToFix: AgentAuditLocalizedText;
  readonly threshold: AgentAuditLocalizedText;
  readonly thresholdAuthority: AgentAuditThresholdAuthority;
  readonly dataSource: AgentAuditLocalizedText;
  readonly scoreWeight: number;
  readonly scored: boolean;
  readonly blocking: boolean;
  readonly blockerEvidenceRecordIds: readonly string[];
  readonly failureResult: Exclude<AgentAuditResultState, "blocker" | "pass" | "excluded">;
  readonly primaryAgent: AgentAuditAgent;
  readonly inventoryReady: boolean;
  readonly engine: AgentAuditEngineState;
  readonly evidenceRecordIds: readonly string[];
  readonly boundary: AgentAuditLocalizedText;
}

export interface AgentAuditGroupDefinition {
  readonly id: string;
  readonly scope: AgentAuditScope;
  readonly title: AgentAuditLocalizedText;
  readonly weight: number | null;
  readonly checks: readonly AgentAuditCheckDefinition[];
}

export interface AgentAuditEvaluatedCheck {
  readonly check: AgentAuditCheckDefinition;
  readonly result: AgentAuditResultState;
  readonly engine: AgentAuditEngineState;
  readonly truth: AgentAuditTruthState;
  readonly measurement: AgentAuditLocalizedText | null;
  readonly evidenceRecordIds: readonly string[];
  readonly scoreValue: number | null;
  readonly scoreContribution: number | null;
}

export interface AgentAuditEvaluatedGroup {
  readonly group: AgentAuditGroupDefinition;
  readonly checks: readonly AgentAuditEvaluatedCheck[];
  readonly health: number | null;
}

export interface AgentAuditEvaluation {
  readonly scope: AgentAuditScope;
  readonly groups: readonly AgentAuditEvaluatedGroup[];
  readonly checks: readonly AgentAuditEvaluatedCheck[];
  readonly blockers: number;
  readonly health: number | null;
  readonly evaluated: number;
  readonly excluded: number;
  readonly enginesReady: number;
}

export interface AgentAuditEvidenceInput {
  readonly records: readonly SeoAuditRecord[];
  readonly availability: "available" | "partial" | "unavailable";
  /** Normalized crawl entry URL. Required to attribute page-level observations. */
  readonly targetUrl?: string;
}

export type AgentAuditPageType = "homepage" | "product" | "tool" | "guide";

export interface AgentAuditHeadingPreset {
  readonly pageType: AgentAuditPageType;
  readonly h2: { readonly min: number; readonly max: number };
  readonly h3: { readonly min: number; readonly max: number };
  readonly substanceWords: number;
  readonly blocker: false;
}
