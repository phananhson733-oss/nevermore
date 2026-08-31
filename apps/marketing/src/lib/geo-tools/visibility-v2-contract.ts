// @input -- immutable questions and engine-specific observations
// @output -- versioned multi-engine report; v1 remains a separate readable contract
// @pos -- shared V2 vocabulary, safe to import from browser components
import type { GeoKbCompetitor } from "./kb-contract.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import type { VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
import type { GeoGap } from "./gap-contract.ts";
import type { VisibilitySovEstimate, VisibilitySovComparison, VisibilitySovCluster } from "./visibility-sov.ts";
import type { VisibilityCitedDomain, VisibilityMetrics, VisibilityQuestionResult, VisibilityReport, VisibilityRunManifest, VisibilitySample } from "./visibility-contract.ts";

export const GEO_VISIBILITY_V2 = "marketing-geo-visibility.v2";
export const VISIBILITY_ENGINES = ["chatgpt", "perplexity"] as const;
/** Portable/store metadata budget; an additional exact preflight checks frozen text. */
export const VISIBILITY_MAX_PLAN_SLOTS = 1_000;
export type VisibilityEngine = (typeof VISIBILITY_ENGINES)[number];
export interface VisibilityEngineConfig {
  readonly engine: VisibilityEngine;
  readonly modelRequested: string;
  readonly surface: string;
  readonly wordingCalibration: "chatgpt_registry" | "unmeasured";
}
export interface VisibilityContextV2 {
  readonly officialName: string;
  readonly aliases: readonly string[];
  readonly competitors: readonly GeoKbCompetitor[];
  readonly targetHost: string;
  readonly marketCode: string;
  readonly language: string;
}
export interface VisibilityPlanItemV2 {
  readonly engine: VisibilityEngine;
  readonly question: GeoQuestion;
  readonly sampleIndex: number;
  readonly slotId: string;
}
export interface VisibilitySampleV2 extends VisibilitySample {
  readonly engine: VisibilityEngine;
  readonly slotId: string;
  readonly modelRequested: string;
  readonly modelObserved: string | null;
  readonly providerTaskId: string | null;
  /** Only extracted from an actual ordered product list; prose order is not rank. */
  readonly listPosition: number | null;
  /** Normalized actual answer prefix, independent of whether this brand appears. */
  readonly answerExcerpt: string | null;
  readonly answerExcerptTruncated: boolean | null;
  /** Structural headings/lead-ins from the full answer, not from either excerpt. */
  readonly subtopics: readonly string[] | null;
  readonly subtopicsOmitted: number | null;
  readonly competitorPositions: readonly { readonly brandName: string; readonly position: number }[] | null;
  /** Retained list length + omitted count is the original observed count. */
  readonly citedDomainsOmitted: number | null;
  readonly citedUrlsOmitted: number | null;
  readonly excerptOmitted: boolean;
}
export interface VisibilityMetricsV2 extends VisibilityMetrics {
  readonly promptCoverage: VisibilityMetrics["questionsMentioned"];
  readonly shareOfVoice: VisibilitySovEstimate & {
    readonly brandScope: "confirmed_brand_subset";
    readonly confirmedCompetitorCount: number;
  };
  readonly meanPosition: { readonly value: number | null; readonly observations: number };
  readonly byLayer: readonly (VisibilityMetrics["byLayer"][number] & { readonly plannedSamples: number; readonly answeredSamples: number; readonly meanPosition: { readonly value: number | null; readonly observations: number } })[];
}
export interface VisibilityQuestionResultV2 extends VisibilityQuestionResult {
  readonly definition: GeoQuestion;
  readonly samples: readonly VisibilitySampleV2[];
}
export interface VisibilityEngineAggregate {
  readonly metrics: VisibilityMetricsV2;
  readonly questions: readonly VisibilityQuestionResultV2[];
  readonly citedDomains: readonly VisibilityCitedDomain[];
}
export interface VisibilityEngineResult extends VisibilityEngineAggregate {
  readonly engine: VisibilityEngine;
  readonly calls: number;
  readonly answered: number;
  readonly successRatio: number;
  readonly status: VisibilityRunManifest["status"];
}
export interface VisibilityRunManifestV2 extends Omit<VisibilityRunManifest, "schemaVersion" | "model" | "surface"> {
  readonly schemaVersion: typeof GEO_VISIBILITY_V2;
  readonly runId: string;
  readonly language: string;
  readonly engines: readonly VisibilityEngineConfig[];
  readonly discardedSlots: number;
  readonly costKnownCalls: number;
}
export interface VisibilityReportV2 extends VisibilityEngineAggregate {
  readonly siteEvidence: VisibilitySiteEvidenceV1 | null;
  readonly gaps: readonly GeoGap[];
  readonly manifest: VisibilityRunManifestV2;
  readonly context: VisibilityContextV2;
  /** Pooled samples, question-level inference. Never an invented mixed model. */
  readonly aggregate: VisibilityEngineAggregate;
  readonly byEngine: readonly VisibilityEngineResult[];
  readonly limits: readonly string[];
  readonly comparison: VisibilityComparisonV2 | null;
}
export interface VisibilityComparisonV2 extends NonNullable<VisibilityReport["comparison"]> {
  readonly shareOfVoice: { readonly baseClusters: readonly VisibilitySovCluster[]; readonly comparison: VisibilitySovComparison };
}
export type AnyVisibilityComparison = NonNullable<VisibilityReport["comparison"]> | VisibilityComparisonV2;
export type AnyVisibilityReport = VisibilityReport | VisibilityReportV2;
export function isVisibilityReportV2(report: AnyVisibilityReport): report is VisibilityReportV2 {
  return report.manifest.schemaVersion === GEO_VISIBILITY_V2;
}
