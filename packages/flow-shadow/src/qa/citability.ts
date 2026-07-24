import type { QaEvaluationInput } from "../types.ts";

/**
 * GEO citability scoring, clean-room derived from public research.
 *
 * This signal is ADVISORY and must never gate a draft: it informs the human
 * reviewer, it does not block or pass. Slice 2 Task 4 lands the interface and
 * returns `null` ("not scored"); the ported scoring arrives in Task 6.
 */

export interface CitabilityScore {
  /** 0-100 advisory score. Never a pass/fail gate. */
  readonly score: number;
  readonly rationale: string;
}

export function scoreCitability(
  _input: QaEvaluationInput,
): CitabilityScore | null {
  return null;
}
