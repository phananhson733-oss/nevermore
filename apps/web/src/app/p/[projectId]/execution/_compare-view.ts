/**
 * Reading the brief and the draft side by side.
 *
 * The two panes are what a reviewer actually compares: the topics the frozen
 * brief committed to, and the body that was written against them. The only
 * machine judgement available about that relationship is the gate's coverage
 * claim, and it is used strictly as far as it goes:
 *
 * - `failed` names the uncovered topics VERBATIM, in quotes, so the annotation
 *   is a quotation rather than a re-derivation. Re-running the matcher in the
 *   browser would put a second, drifting copy of a safety-relevant heuristic in
 *   the reader.
 * - A quoted string that is not one of the frozen committed topics is dropped.
 *   Under-marking costs a reviewer one manual comparison; mis-marking sends
 *   them to rewrite a topic the gate never faulted.
 * - `unevaluated` annotates nothing. "We did not judge this" is not "this is
 *   missing", and colouring it would perform exactly the substitution the
 *   gate's third state exists to prevent.
 */

import type { QaClaimView } from "./_qa-view.ts";

/** The gate's own id for the brief coverage judgement. */
const COVERAGE_CLAIM_ID = "content-shadow.qa.brief-outline";

export function coverageClaimOf(
  claims: readonly QaClaimView[],
): QaClaimView | null {
  return claims.find((claim) => claim.claimId === COVERAGE_CLAIM_ID) ?? null;
}

export type CoverageVerdict = "covered" | "missing" | "unevaluated";

export function coverageVerdict(claim: QaClaimView | null): CoverageVerdict {
  if (claim === null) return "unevaluated";
  if (claim.status === "failed") return "missing";
  if (claim.status === "passed") return "covered";
  return "unevaluated";
}

/** Every double-quoted span in the claim detail, in order. */
function quotedSpans(detail: string): readonly string[] {
  return [...detail.matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "");
}

/**
 * The committed topics the gate reported as not visibly covered.
 *
 * Returns a subset of `committed`, in the frozen checklist's own order, so the
 * caller can annotate rows it is already rendering without re-ordering them.
 */
export function uncoveredTopics(
  claim: QaClaimView | null,
  committed: readonly string[],
): readonly string[] {
  if (claim === null || claim.status !== "failed") return [];
  const named = new Set(quotedSpans(claim.detail));
  return committed.filter((topic) => named.has(topic));
}
