/**
 * The SEO/GEO + factual-review gate for one evaluated draft revision.
 *
 * Everything under `qa/` is a pure function of its arguments: no clock, no
 * randomness, no filesystem, no `process.env`, no `Intl`, and no runtime import
 * of the sibling `gengrowth-flow-mvp` repository (Slice 2 red line D). The gate
 * is the one place a reproducible run makes a factual assertion about model
 * output, so anything that could make the same frozen inputs judge differently
 * on a second machine is excluded by construction, not by convention.
 */

export {
  clampVerdictToFailedClaims,
  evaluateDraftQa,
  evaluateQaRules,
  qaClaimsToJson,
  type QaEvaluationReport,
} from "./evaluate.ts";

export { QA_BRIEF_OUTLINE_CLAIM_ID, briefCoverageClaim } from "./coverage.ts";

export { buildQaContext, type QaContext } from "./context.ts";

export {
  BLOCKING_RULE_IDS,
  QA_RULE_ORDER,
  QA_RULE_SEVERITY,
  claimIdForRule,
  qaRuleKind,
  type QaRuleId,
  type QaRuleResult,
  type QaSeverity,
} from "./rule-types.ts";

export { QA_THRESHOLDS, type QaThresholds } from "./thresholds.ts";

export {
  BANNED_AUTHOR_TOKENS,
  RED_LINE_CHECKS,
  evaluateRedLineRules,
  type RedLineCheck,
} from "./red-lines.ts";

export {
  STRUCTURE_CHECKS,
  evaluateStructureRules,
  type StructureCheck,
} from "./structure-checks.ts";

export {
  CITABILITY_BASIS,
  CITABILITY_CAVEAT,
  CITABILITY_METHOD,
  scoreCitability,
  type CitabilityScore,
} from "./citability.ts";

export {
  buildSourceIndex,
  extractAttributions,
  findUnsupportedClaims,
  locatedAttributions,
  resolveAssertionSupport,
  resolveAttribution,
  resolveLinkProvenance,
  type AssertionSupport,
  type Attribution,
  type LinkProvenance,
  type Resolution,
  type SourceIdentity,
  type SourceIndex,
  type SourceRole,
} from "./claims.ts";
