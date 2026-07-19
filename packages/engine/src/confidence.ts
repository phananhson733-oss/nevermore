import type { EvidenceDraft } from "./rule.ts";

/**
 * Confidence derivation (spec §8.7). The engine — never a rule or an LLM — sets
 * confidence from the candidate's evidence:
 *  - high: ≥1 A/B observed supporting evidence, all key evidence available, no
 *    contradiction, not resting on inferred/C-grade signal.
 *  - medium: the key conclusion includes C-grade / inferred evidence, or a partial
 *    limitation that does not change direction.
 *  - low: only generated, or a single C-grade support. First release forces these
 *    candidates to `needs_more_data` — they cannot create a ready Action.
 */

export type Confidence = "high" | "medium" | "low";

export interface ConfidenceOptions {
  /** An unresolved provider conflict overlaps the finding/evidence subjects. */
  readonly hasDiscrepancy?: boolean;
}

export function deriveConfidence(
  evidence: readonly EvidenceDraft[],
  options: ConfidenceOptions = {},
): Confidence {
  const supporting = evidence.filter((e) => e.support === "supports");
  if (supporting.length === 0) return "low";

  // §8.7: contradiction, or a key supporting fact that is unavailable, must not
  // yield a confirmable high/medium finding — route to low → needs_more_data.
  const hasContradiction = evidence.some((e) => e.support === "contradicts");
  const keyUnavailable = supporting.some(
    (e) => e.availability === "unavailable",
  );
  if (hasContradiction || keyUnavailable) return "low";

  const allGenerated = supporting.every((e) => e.method === "generated");
  if (allGenerated) return "low";
  if (supporting.length === 1 && supporting[0]!.grade === "C") return "low";

  const hasStrongObserved = supporting.some(
    (e) => (e.grade === "A" || e.grade === "B") && e.method === "observed",
  );
  const restsOnInferred = supporting.some(
    (e) => e.method === "inferred" || e.grade === "C",
  );
  const hasPartial = evidence.some((e) => e.availability === "partial");

  if (hasStrongObserved && !restsOnInferred && !hasPartial) {
    // A provider discrepancy is not itself model evidence and cannot turn a
    // finding low; it removes the "no discrepancy" prerequisite for high.
    return options.hasDiscrepancy ? "medium" : "high";
  }
  return "medium";
}

/** Low-confidence candidates auto-route to `needs_more_data` (spec §8.7). */
export function autoReviewState(
  confidence: Confidence,
): "unreviewed" | "needs_more_data" {
  return confidence === "low" ? "needs_more_data" : "unreviewed";
}
