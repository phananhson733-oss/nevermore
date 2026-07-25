import type {
  QaClaim,
  QaEvaluation,
  QaEvaluationInput,
  QaVerdict,
} from "../types.ts";
import { evaluateRedLines } from "./red-lines.ts";
import { evaluateStructure } from "./structure-checks.ts";
import { scoreCitability } from "./citability.ts";

export { RED_LINE_CHECKS, evaluateRedLines } from "./red-lines.ts";
export type { RedLineCheck } from "./red-lines.ts";
export { STRUCTURE_CHECKS, evaluateStructure } from "./structure-checks.ts";
export type { StructureCheck } from "./structure-checks.ts";
export { scoreCitability } from "./citability.ts";
export type { CitabilityScore } from "./citability.ts";

/**
 * The Content Shadow QA gate (Slice 2 Task 4 skeleton).
 *
 * Task 4 wires the pipeline end to end; the gate therefore records an honest
 * `needs_review` verdict with an explicit `unevaluated` claim rather than
 * pretending an unimplemented check passed. Task 6 replaces the placeholder
 * with the ported red-line/structure judgement (an unsupported claim becomes
 * `blocked` or `needs_review`) while citability stays advisory.
 *
 * `needs_review` deliberately does not block: no downstream stage is gated on
 * it in Task 4, and nothing here ever marks an artifact ready or published
 * (Slice 2 red line D).
 */

export const QA_PENDING_CLAIM_ID = "content-shadow.qa.pending";

const PENDING_CLAIM: QaClaim = {
  claimId: QA_PENDING_CLAIM_ID,
  kind: "coverage",
  status: "unevaluated",
  detail:
    "Red-line, structure and citability judgement is not implemented yet; this draft revision requires human review.",
};

export const QA_BRIEF_OUTLINE_CLAIM_ID = "content-shadow.qa.brief-outline";

/**
 * The brief -> draft causal-chain claim (decision O-4).
 *
 * `failed` when the pinned brief produced no machine-readable outline: that is
 * a VERIFIED fact, not an unimplemented check, and it means this draft was not
 * brief-guided at all. When an outline does exist the claim is `unevaluated`,
 * because whether the draft actually COVERS those topics is the Task 6
 * judgement — reporting `passed` here would claim a check that has not run.
 *
 * A PARTIAL loss (the brief carried more sections than the outline cap admits)
 * stays `unevaluated` — `failed` is the treatment total failure earns — but it
 * is SAID. "The brief contributed 12 coverage topic(s)" over a brief that
 * committed to 19 is a true sentence that reads as a complete one, and that is
 * the silent-partial-pass shape decision O-4's principle rules out.
 */
function briefOutlineClaim(input: QaEvaluationInput): QaClaim {
  const sections = input.pack.briefOutline.briefSections;
  if (sections.length === 0) {
    return {
      claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
      kind: "coverage",
      status: "failed",
      detail:
        "The pinned content brief revision carried no machine-readable outline, so this draft was not guided by the brief. Review it against the brief by hand.",
    };
  }
  const { briefSectionCount, projectedSectionCount } = input.briefOutlineStats;
  const dropped = briefSectionCount - projectedSectionCount;
  const shortfall =
    dropped > 0
      ? ` The pinned brief carried ${briefSectionCount} distinct section heading(s); ${dropped} were dropped by the outline cap and never reached the prompt.`
      : "";
  return {
    claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
    kind: "coverage",
    status: "unevaluated",
    detail: `The brief contributed ${sections.length} coverage topic(s) to the draft prompt; whether the draft covers them is judged by the Task 6 coverage check.${shortfall}`,
  };
}

/**
 * A verdict may never read as `passed` while a claim is `failed`. Task 4's
 * skeleton verdict is already `needs_review`, so today this is a no-op — it
 * exists so the Task 6 judgement cannot regress decision O-4 by returning
 * `passed` over a broken brief -> draft chain.
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

export function evaluateDraftQa(input: QaEvaluationInput): QaEvaluation {
  const checks: QaClaim[] = [
    ...evaluateRedLines(input),
    ...evaluateStructure(input),
  ];
  // Advisory only: a citability score never contributes a gating claim.
  void scoreCitability(input);
  if (checks.length === 0) checks.push(PENDING_CLAIM);
  const claims = [...checks, briefOutlineClaim(input)];
  return {
    verdict: clampVerdictToFailedClaims("needs_review", claims),
    claims,
  };
}

/** The claim list as plain JSON for the `claims` jsonb column. */
export function qaClaimsToJson(
  claims: readonly QaClaim[],
): readonly Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(claims)) as Record<string, unknown>[];
}
