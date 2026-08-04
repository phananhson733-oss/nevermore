import type { DiagnosticRule } from "../rule.ts";
import { RULE_SET_VERSION } from "../registry.ts";
import { techHttpStatusRule } from "./tech-http-status.ts";
import { techCanonicalRule } from "./tech-canonical.ts";
import {
  createLegacyTechLinkgraphExecutor,
  techLinkgraphRule,
} from "./tech-linkgraph.ts";
import { searchCtrRule } from "./search-ctr.ts";
import { searchDecayRule } from "./search-decay.ts";
import { contentCoverageRule } from "./content-coverage.ts";
import { contentGapRule } from "./content-gap.ts";
import { croPathRule } from "./cro-path.ts";
import { croLandingRule } from "./cro-landing.ts";
import { geoEntityRule } from "./geo-entity.ts";
import { geoCrawlerRule } from "./geo-crawler.ts";

/**
 * The frozen 11-rule registry in fixed pipeline order (spec §8.4). Deterministic
 * rules only; the pipeline runs them in this exact order.
 */
export const ALL_RULES: readonly DiagnosticRule[] = [
  techHttpStatusRule,
  techCanonicalRule,
  techLinkgraphRule,
  searchCtrRule,
  searchDecayRule,
  contentCoverageRule,
  contentGapRule,
  croPathRule,
  croLandingRule,
  geoEntityRule,
  geoCrawlerRule,
];

/**
 * The last pre-governance rule set. Historical runs pinned to this version
 * must keep emitting CONTENT-GAP-011@1, even though the current implementation
 * also contains the governance-aware @2 path.
 */
export const LEGACY_RULE_SET_VERSION = "mvp.rules.0.2.1";
export const GOVERNED_LEGACY_RULE_SET_VERSION = "mvp.rules.0.2.2";

const legacyTechLinkgraphRule = createLegacyTechLinkgraphExecutor();

const legacyContentGapRule: DiagnosticRule = {
  ...contentGapRule,
  version: 1,
  evaluate(ctx) {
    if (ctx.governance !== null) {
      throw new Error(
        "CONTENT-GAP-011@1 cannot evaluate a governance-bearing context",
      );
    }
    return contentGapRule.evaluate(ctx);
  },
};

export const LEGACY_ALL_RULES: readonly DiagnosticRule[] = ALL_RULES.map(
  (rule) =>
    rule.id === "CONTENT-GAP-011"
      ? legacyContentGapRule
      : rule.id === "TECH-LINKGRAPH-005"
        ? legacyTechLinkgraphRule
        : rule,
);

export const GOVERNED_LEGACY_ALL_RULES: readonly DiagnosticRule[] =
  ALL_RULES.map((rule) =>
    rule.id === "TECH-LINKGRAPH-005" ? legacyTechLinkgraphRule : rule,
);

/**
 * Resolve only executors whose exact deterministic rule implementations remain
 * shipped. Unknown versions return null so callers can fail closed.
 */
export function rulesForRuleSetVersion(
  ruleSetVersion: string,
): readonly DiagnosticRule[] | null {
  if (ruleSetVersion === RULE_SET_VERSION) return ALL_RULES;
  if (ruleSetVersion === GOVERNED_LEGACY_RULE_SET_VERSION) {
    return GOVERNED_LEGACY_ALL_RULES;
  }
  if (ruleSetVersion === LEGACY_RULE_SET_VERSION) return LEGACY_ALL_RULES;
  return null;
}

export {
  techHttpStatusRule,
  techCanonicalRule,
  techLinkgraphRule,
  searchCtrRule,
  searchDecayRule,
  contentCoverageRule,
  contentGapRule,
  croPathRule,
  croLandingRule,
  geoEntityRule,
  geoCrawlerRule,
};
