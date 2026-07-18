import type { DiagnosticDomain, RuleId } from "./rule.ts";

/**
 * Versioned static finding registry (spec §8.4). Metadata is fixed here, never
 * produced by a model. `ruleFamily` + `intent` participate in the cross-run
 * finding key; `titleKey` addresses the deterministic i18n title template.
 * Changing any of these requires bumping `RULE_SET_VERSION` and the rule version.
 */

export const RULE_SET_VERSION = "mvp.rules.0.2.0";
export const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";

export interface FindingMeta {
  readonly ruleFamily: string;
  readonly intent: string;
  readonly domain: DiagnosticDomain;
  readonly titleKey: string;
}

export const FINDING_REGISTRY: Record<RuleId, FindingMeta> = {
  "TECH-HTTP-001": {
    ruleFamily: "http-status",
    intent: "restore_or_redirect",
    domain: "technical_seo",
    titleKey: "finding.http_status",
  },
  "TECH-CANONICAL-002": {
    ruleFamily: "canonical-conflicts",
    intent: "normalize_canonical",
    domain: "technical_seo",
    titleKey: "finding.canonical",
  },
  "TECH-LINKGRAPH-005": {
    ruleFamily: "internal-link-equity",
    intent: "strengthen_internal_links",
    domain: "technical_seo",
    titleKey: "finding.internal_links",
  },
  "SEARCH-CTR-004": {
    ruleFamily: "search-ctr",
    intent: "improve_search_snippet",
    domain: "search_performance",
    titleKey: "finding.search_ctr",
  },
  "SEARCH-DECAY-002": {
    ruleFamily: "search-decay",
    intent: "recover_search_demand",
    domain: "search_performance",
    titleKey: "finding.search_decay",
  },
  "CONTENT-COVERAGE-001": {
    ruleFamily: "intent-coverage",
    intent: "cover_priority_intent",
    domain: "content_intent",
    titleKey: "finding.content_coverage",
  },
  "CONTENT-GAP-011": {
    ruleFamily: "keyword-gap",
    intent: "create_decision_content",
    domain: "content_intent",
    titleKey: "finding.content_gap",
  },
  "CRO-PATH-001": {
    ruleFamily: "conversion-path",
    intent: "connect_conversion_path",
    domain: "conversion_journey",
    titleKey: "finding.cro_path",
  },
  "CRO-LANDING-003": {
    ruleFamily: "landing-conversion",
    intent: "improve_landing_conversion",
    domain: "conversion_journey",
    titleKey: "finding.cro_landing",
  },
  "GEO-ENTITY-001": {
    ruleFamily: "entity-proof",
    intent: "build_entity_and_proof",
    domain: "geo_ai",
    titleKey: "finding.geo_entity",
  },
  "GEO-CRAWLER-002": {
    ruleFamily: "crawler-blocked-ai",
    intent: "review_ai_crawler_access",
    domain: "geo_ai",
    titleKey: "finding.geo_crawler",
  },
};
