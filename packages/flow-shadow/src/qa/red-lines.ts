import type { QaClaim, QaEvaluationInput } from "../types.ts";

/**
 * Red-line checks (RL1-RL12) ported from the pinned Flow tooling.
 *
 * Slice 2 Task 4 lands the INTERFACE only. The real judgement — notably RL8
 * (a scientific endorsement with no supporting source is a FAIL) and RL12 (a
 * hallucinated citation is a FAIL), which together are the unsupported-claim
 * core — is Task 6. Returning an empty claim list here is deliberate: an
 * unimplemented check must never manufacture a passing claim, so the caller
 * keeps the draft at `needs_review`.
 */

export interface RedLineCheck {
  readonly id: string;
  readonly title: string;
}

/** The frozen red-line vocabulary the Task 6 judgement will populate. */
export const RED_LINE_CHECKS: readonly RedLineCheck[] = [];

export function evaluateRedLines(
  _input: QaEvaluationInput,
): readonly QaClaim[] {
  return [];
}
