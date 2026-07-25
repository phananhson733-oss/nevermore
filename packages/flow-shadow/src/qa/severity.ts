import { QA_BRIEF_OUTLINE_CLAIM_ID } from "./coverage.ts";
import {
  claimIdForRule,
  QA_RULE_ORDER,
  QA_RULE_SEVERITY,
  type QaSeverity,
} from "./rule-types.ts";

/**
 * What one persisted claim costs, resolved from its `claimId`.
 *
 * The persisted claim carries no severity of its own, so every consumer that
 * wants to tell "the draft asserts something we cannot support" apart from "the
 * paragraphs are long" has to answer that question somehow. Before this module
 * the only way to answer it outside the package was to copy the three blocking
 * rule ids into the reader — and a copy drifts in the one direction that costs
 * the most: a reader that believes a blocking rule is advisory shows a reviewer
 * a draft that looks safe to accept.
 *
 * So the answer is derived here, from `QA_RULE_SEVERITY` itself, and nowhere
 * else. A second literal table anywhere downstream is the bug this file exists
 * to prevent.
 */
const CLAIM_SEVERITY: ReadonlyMap<string, QaSeverity> = new Map<
  string,
  QaSeverity
>([
  ...QA_RULE_ORDER.map(
    (ruleId) => [claimIdForRule(ruleId), QA_RULE_SEVERITY[ruleId]] as const,
  ),
  /**
   * The coverage claim is not one of the ported rules, so it has no entry in
   * `QA_RULE_SEVERITY`. `review` is not a guess: `coverageAdjusted` moves the
   * verdict to `needs_review` whenever this claim is not `passed`, and never to
   * `blocked` — which is exactly what `review` means for a rule.
   */
  [QA_BRIEF_OUTLINE_CLAIM_ID, "review"],
]);

/**
 * The severity reported for a claim id this build does not know.
 *
 * `review` rather than `advisory`, because the two mistakes are not
 * symmetrical. An unknown claim shown as advisory disappears from a reviewer's
 * attention; an unknown claim shown as needing a human costs one extra look.
 * A gate row is append-only, so a claim minted by an older adapter version can
 * outlive the rule that produced it and reach this lookup for real.
 */
export const QA_UNKNOWN_CLAIM_SEVERITY: QaSeverity = "review";

/** The severity of one persisted claim, from the one severity table. */
export function qaSeverityForClaimId(claimId: string): QaSeverity {
  return CLAIM_SEVERITY.get(claimId) ?? QA_UNKNOWN_CLAIM_SEVERITY;
}
