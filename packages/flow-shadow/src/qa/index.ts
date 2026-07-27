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

export { QA_UNKNOWN_CLAIM_SEVERITY, qaSeverityForClaimId } from "./severity.ts";

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

export { checkSourceOverlap } from "./source-overlap.ts";

export {
  checkBrandVoice,
  checkClaimRestrictions,
} from "./policy-rules.ts";

export {
  CITABILITY_BASIS,
  CITABILITY_CAVEAT,
  CITABILITY_METHOD,
  scoreCitability,
  type CitabilityScore,
} from "./citability.ts";

/**
 * `resolveAttribution` is deliberately absent.
 *
 * It answers "does the pack hold anything this attribution names?", and one
 * link to the customer's own site answers it yes — which is how a fabricated
 * study, a fabricated bibliography and an `et al.` citation each reached
 * `passed` on the strength of a call-to-action URL. A purity guard keeps the
 * rules from calling it, but that guard only walks this package's closure, so
 * re-exporting it here put the same mistake one import away for every future
 * consumer in `apps/`, outside the guard's reach. The two questions a caller
 * may ask are `resolveAssertionSupport` (may this support a claim? — its return
 * type has no first-party inhabitant) and `resolveLinkProvenance` (is this
 * address ours?).
 */
export {
  buildSourceIndex,
  extractAttributions,
  findUnsupportedClaims,
  locatedAttributions,
  resolveAssertionSupport,
  resolveFirstPartyAssertionSupport,
  resolveLinkProvenance,
  type AssertionSupport,
  type Attribution,
  type LinkProvenance,
  type Resolution,
  type SourceIdentity,
  type SourceIndex,
  type SourceRole,
} from "./claims.ts";
