import type { QaClaim, QaEvaluation, QaEvaluationInput } from "../types.ts";
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

export function evaluateDraftQa(input: QaEvaluationInput): QaEvaluation {
  const claims: QaClaim[] = [
    ...evaluateRedLines(input),
    ...evaluateStructure(input),
  ];
  // Advisory only: a citability score never contributes a gating claim.
  void scoreCitability(input);
  if (claims.length === 0) claims.push(PENDING_CLAIM);
  return { verdict: "needs_review", claims };
}

/** The claim list as plain JSON for the `claims` jsonb column. */
export function qaClaimsToJson(
  claims: readonly QaClaim[],
): readonly Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(claims)) as Record<string, unknown>[];
}
