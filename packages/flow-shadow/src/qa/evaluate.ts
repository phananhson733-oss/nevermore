import type {
  QaClaim,
  QaClaimStatus,
  QaEvaluation,
  QaEvaluationInput,
  QaVerdict,
} from "../types.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import { buildQaContext } from "./context.ts";
import { briefCoverageClaim, QA_BRIEF_OUTLINE_CLAIM_ID } from "./coverage.ts";
import {
  citabilityRule,
  scoreCitability,
  CITABILITY_BASIS,
  CITABILITY_CAVEAT,
  CITABILITY_METHOD,
  type CitabilityScore,
} from "./citability.ts";
import { evaluateRedLineRules } from "./red-lines.ts";
import { evaluateStructureRules } from "./structure-checks.ts";
import {
  claimIdForRule,
  qaRuleKind,
  unevaluable,
  QA_RULE_ORDER,
  QA_RULE_SEVERITY,
  type QaRuleId,
  type QaRuleResult,
} from "./rule-types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";

/**
 * The Content Shadow QA gate.
 *
 * Three properties hold by construction, and each exists because its absence
 * caused a specific failure in the tooling this is ported from:
 *
 * 1. **Pure and deterministic.** No clock, no randomness, no filesystem, no
 *    environment, no locale-sensitive API. The same frozen draft plus the same
 *    frozen pack always produces byte-identical claims — which is what makes
 *    `flow_shadow_qa_gates`' replay comparison meaningful rather than a source
 *    of spurious conflicts.
 * 2. **Never fails open.** A rule that cannot be judged reports `unevaluable`,
 *    and an unevaluable gating rule forces `needs_review`. The ported
 *    plagiarism check returned `pass: true` whenever its corpus was missing,
 *    which silently converted "we did not look" into "we found nothing".
 * 3. **Advisory never gates.** Advisory rules are excluded from the verdict AND
 *    from `failed` claim status. The persisted claim carries no severity field,
 *    so a `failed` advisory claim would read to every consumer — and to
 *    `clampVerdictToFailedClaims` — as a real defect.
 *
 * `blocked` is a judgement about the CONTENT, never about the run: the run
 * still completes, the draft revision is still minted (it is the evidence a
 * reviewer needs), and nothing is ever marked ready or published.
 */

export interface QaEvaluationReport extends QaEvaluation {
  /** The pinned adapter version whose rules and thresholds produced this. */
  readonly adapterVersion: string;
  readonly rules: readonly QaRuleResult[];
  /** Advisory. The verdict computation never reads this field. */
  readonly citability: CitabilityScore;
}

const EMPTY_CITABILITY: CitabilityScore = Object.freeze({
  score: 0,
  rationale: "Not scored: the draft could not be read.",
  method: CITABILITY_METHOD,
  basis: CITABILITY_BASIS,
  caveat: CITABILITY_CAVEAT,
  features: Object.freeze({}),
  normalized: Object.freeze({}),
  weakFeatures: Object.freeze([]) as readonly string[],
});

const MAX_DETAIL_CHARS = 2_000;

function boundedDetail(detail: string): string {
  const trimmed = detail.trim();
  if (trimmed.length === 0) return "No detail was recorded for this check.";
  if (trimmed.length <= MAX_DETAIL_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_DETAIL_CHARS - 1).trimEnd()}…`;
}

function claimStatus(rule: QaRuleResult): QaClaimStatus {
  if (!rule.evaluable) return "unevaluated";
  // An advisory rule can never move the verdict, so it must never persist a
  // `failed` claim either: the claim shape carries no severity, and a reader
  // (or the clamp) would otherwise treat a style note as a real defect.
  if (QA_RULE_SEVERITY[rule.ruleId] === "advisory") return "passed";
  return rule.pass ? "passed" : "failed";
}

function toClaim(rule: QaRuleResult): QaClaim {
  return {
    claimId: claimIdForRule(rule.ruleId),
    kind: qaRuleKind(rule.ruleId),
    status: claimStatus(rule),
    detail: boundedDetail(rule.detail),
  };
}

/** The verdict, derived from rules alone. Citability is never an input. */
export function evaluateQaRules(rules: readonly QaRuleResult[]): QaVerdict {
  let needsReview = false;
  for (const rule of rules) {
    const severity = QA_RULE_SEVERITY[rule.ruleId];
    if (severity === "advisory") continue;
    if (severity === "blocking" && rule.evaluable && !rule.pass)
      return "blocked";
    if (!rule.evaluable || !rule.pass) needsReview = true;
  }
  return needsReview ? "needs_review" : "passed";
}

/**
 * A verdict may never read as `passed` while a claim is `failed`.
 *
 * This was a no-op while Task 4's verdict was hard-coded to `needs_review`. Now
 * that a real judgement can return `passed`, it is the backstop that keeps a
 * broken brief -> draft chain (decision O-4) from being reported as a clean
 * pass — including for any future claim that is not one of the rules above.
 */
export function clampVerdictToFailedClaims(
  verdict: QaVerdict,
  claims: readonly QaClaim[],
): QaVerdict {
  if (verdict !== "passed") return verdict;
  return claims.some((claim) => claim.status === "failed")
    ? "needs_review"
    : verdict;
}

function unreadableDraft(
  reasonCode: string,
  detail: string,
): QaEvaluationReport {
  const rules = QA_RULE_ORDER.map((ruleId: QaRuleId) =>
    unevaluable(ruleId, reasonCode, detail),
  );
  const claims: QaClaim[] = [
    ...rules.map(toClaim),
    {
      claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
      kind: "coverage",
      status: "unevaluated",
      detail: boundedDetail(detail),
    },
  ];
  return {
    adapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    verdict: clampVerdictToFailedClaims(evaluateQaRules(rules), claims),
    claims,
    rules,
    citability: EMPTY_CITABILITY,
  };
}

export function evaluateDraftQa(input: QaEvaluationInput): QaEvaluationReport {
  if (input.draftMarkdown.trim().length === 0) {
    return unreadableDraft(
      "draft_empty",
      "The evaluated draft revision is empty, so nothing could be judged. This is reported as unevaluated, never as a pass.",
    );
  }
  if (input.draftMarkdown.length > QA_THRESHOLDS.maxDraftChars) {
    return unreadableDraft(
      "draft_oversized",
      `The evaluated draft revision is ${input.draftMarkdown.length} characters, past the ${QA_THRESHOLDS.maxDraftChars}-character bound the deterministic checks are guaranteed to terminate within. Nothing was judged.`,
    );
  }

  const context = buildQaContext(input);
  const citability = scoreCitability(context);
  const byId = new Map<QaRuleId, QaRuleResult>();
  for (const rule of [
    ...evaluateRedLineRules(context),
    ...evaluateStructureRules(context),
    citabilityRule(citability),
  ]) {
    byId.set(rule.ruleId, rule);
  }
  // Declaration order, not evaluation order: the persisted array must be stable.
  const rules = QA_RULE_ORDER.map(
    (ruleId) =>
      byId.get(ruleId) ??
      unevaluable(
        ruleId,
        "rule_not_run",
        "This rule produced no result for this draft.",
      ),
  );
  const claims: QaClaim[] = [
    ...rules.map(toClaim),
    briefCoverageClaim(context),
  ];
  const verdict = coverageAdjusted(evaluateQaRules(rules), claims);
  return {
    adapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    verdict: clampVerdictToFailedClaims(verdict, claims),
    claims,
    rules,
    citability,
  };
}

/**
 * The coverage claim is not one of the ported rules, so it needs its own path
 * into the verdict: an uncovered brief topic (or a coverage judgement that could
 * not run) is a human-review matter, exactly like a failing `review` rule.
 */
function coverageAdjusted(
  verdict: QaVerdict,
  claims: readonly QaClaim[],
): QaVerdict {
  if (verdict === "blocked") return verdict;
  const coverage = claims.find((claim) => claim.kind === "coverage");
  if (coverage && coverage.status !== "passed") return "needs_review";
  return verdict;
}

/** The claim list as plain JSON for the `claims` jsonb column. */
export function qaClaimsToJson(
  claims: readonly QaClaim[],
): readonly Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(claims)) as Record<string, unknown>[];
}
