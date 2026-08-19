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

/**
 * How one evidence record becomes an issue for a check.
 *
 * Without a rule a record is an issue as soon as one unit is affected, which is
 * what the counting checks publish ("0 pages; above 0 is a Warning"). Checks
 * whose published threshold is a share or a per-observation limit carry a rule,
 * so the decision the evaluator executes is the one the check displays.
 */
export type AgentAuditIssueRule =
  | {
      readonly recordId: string;
      readonly kind: "affected-ratio";
      /** Affected share below which the record is not an issue. */
      readonly passBelow: number;
      /** Affected share above which the record takes the full failure result. */
      readonly failAbove?: number;
    }
  /**
   * The inclusive form, for a threshold that reads "at least 90% covered" —
   * which is satisfied at exactly 90%. Expressing it as the exclusive
   * `passBelow: 0.1` fails a site sitting precisely on its own published mark,
   * so the two bounds are separate kinds rather than one field plus a flag.
   */
  | {
      readonly recordId: string;
      readonly kind: "affected-ratio-at-most";
      /** Highest affected share that is still not an issue. */
      readonly passAtOrBelow: number;
      /** Affected share above which the record takes the full failure result. */
      readonly failAbove?: number;
    }
  | {
      readonly recordId: string;
      readonly kind: "observation-value-max";
      readonly label: string;
      /** Highest still-acceptable value for the named observation entry. */
      readonly max: number;
    }
  /**
   * A published threshold about the population as a whole rather than about
   * each affected unit: an average, or a share weighted by something other than
   * unit count. Average response time and impression share in positions 1-6 are
   * both of this shape, and neither can be expressed as "how many units are
   * affected" without changing what the check says it measures.
   *
   * The record carries one site-level observation whose named value is the
   * computed aggregate, so the number the engine compares is the number the
   * panel displays.
   */
  | {
      readonly recordId: string;
      readonly kind: "aggregate-max";
      readonly label: string;
      /** Aggregate at or below this passes. */
      readonly passAtOrBelow: number;
      /** Aggregate above this takes the full failure result. */
      readonly failAbove?: number;
    }
  | {
      readonly recordId: string;
      readonly kind: "aggregate-min";
      readonly label: string;
      /** Aggregate at or above this passes. */
      readonly passAtOrAbove: number;
      /** Aggregate below this takes the full failure result. */
      readonly failBelow?: number;
    };

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
  readonly issueRules: readonly AgentAuditIssueRule[];
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
  /**
   * Whether the target URL was collected as a 2xx HTML page. Only then does the
   * target's absence from an issue list mean the target is clean; otherwise the
   * page-level check stays unverified.
   */
  readonly targetInspected?: boolean;
  /**
   * The collected page that is the target, in the form its observations carry.
   * The submitted URL can differ from it after normalisation, and matching on
   * the submitted form would read a page's real problems as a clean pass.
   */
  readonly inspectedTargetUrl?: string | null;
}

export type AgentAuditPageType = "homepage" | "product" | "tool" | "guide";

export interface AgentAuditHeadingPreset {
  readonly pageType: AgentAuditPageType;
  readonly h2: { readonly min: number; readonly max: number };
  readonly h3: { readonly min: number; readonly max: number };
  readonly substanceWords: number;
  readonly blocker: false;
}
