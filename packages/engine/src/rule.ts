/**
 * Diagnostic rule contract (spec §8.3). Rules are PURE, replayable logic: no
 * network, no DB, no LLM, no clock. They read a frozen `DiagnosticContext` and
 * return a `RuleResult`. Rule metadata (ruleFamily/intent/severity policy) lives
 * in the versioned `registry`, never in the rule body — a rule only decides
 * WHETHER it triggers and on WHICH subjects, plus the evidence.
 */

import type { DiagnosticContext } from "./context.ts";

export type DiagnosticDomain =
  | "technical_seo"
  | "search_performance"
  | "content_intent"
  | "conversion_journey"
  | "geo_ai";

export type RuleId =
  | "TECH-HTTP-001"
  | "TECH-CANONICAL-002"
  | "TECH-LINKGRAPH-005"
  | "SEARCH-CTR-004"
  | "SEARCH-DECAY-002"
  | "CONTENT-COVERAGE-001"
  | "CONTENT-GAP-011"
  | "CRO-PATH-001"
  | "CRO-LANDING-003"
  | "GEO-ENTITY-001"
  | "GEO-CRAWLER-002";

export type Dataset = "crawl" | "gsc" | "ga4" | "csv" | "icp";

export interface DatasetRequirement {
  readonly dataset: Dataset;
  /** When true, absence makes the rule `skipped`; when false it is advisory. */
  readonly required: boolean;
}

export type Severity = "critical" | "high" | "medium" | "low";

export type EvidenceOrigin =
  | "first_party"
  | "direct_public"
  | "vendor_observation"
  | "user_provided"
  | "derived"
  | "generated";
export type EvidenceMethod = "observed" | "computed" | "inferred" | "generated";
export type EvidenceGrade = "A" | "B" | "C";
export type EvidenceAvailability = "available" | "partial" | "unavailable";
export type EvidenceSupport = "supports" | "contradicts" | "context";

/** An evidence record a rule attaches to a candidate (persisted per §7.7). */
export interface EvidenceDraft {
  readonly sourceProvider: string;
  readonly origin: EvidenceOrigin;
  readonly method: EvidenceMethod;
  readonly grade: EvidenceGrade;
  readonly availability: EvidenceAvailability;
  readonly support: EvidenceSupport;
  readonly subjectRefs: readonly string[];
  readonly claim: string;
  readonly observedAt: string;
  readonly limitation: string;
}

/**
 * A finding candidate. `subjectRefs` are the stable aggregation keys (canonical
 * subjectUrl or a `page_set:*` / `keyword_cluster:*` / `http_status:*` key). The
 * pipeline attaches ruleFamily/intent/titleKey from the registry and derives
 * confidence — the rule never sets confidence or priority (spec §8.7).
 */
export interface FindingCandidate {
  readonly subjectRefs: readonly string[];
  readonly severity: Severity;
  readonly titleArgs: Record<string, string | number>;
  readonly metrics: Record<string, number | string | null>;
  readonly evidence: readonly EvidenceDraft[];
}

export type RuleResult =
  | { readonly status: "pass"; readonly metrics: Record<string, number | string | null> }
  | { readonly status: "candidate"; readonly candidates: readonly FindingCandidate[] }
  | {
      readonly status: "skipped";
      readonly reason: "missing_dataset" | "unsupported_language" | "not_applicable";
    }
  | {
      readonly status: "inconclusive";
      readonly reason: string;
      readonly evidence?: readonly EvidenceDraft[];
    };

export interface DiagnosticRule {
  readonly id: RuleId;
  readonly version: 1;
  readonly domain: DiagnosticDomain;
  readonly requiredDatasets: readonly DatasetRequirement[];
  evaluate(ctx: DiagnosticContext): RuleResult | Promise<RuleResult>;
}
