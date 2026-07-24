import type { QaClaim, QaEvaluationInput } from "../types.ts";

/**
 * Structure checks (SC1-SC10: word count, heading shape, internal links, FAQ,
 * Sources, CTA) ported from the pinned Flow tooling.
 *
 * Slice 2 Task 4 lands the INTERFACE only; the real gating judgement is Task 6.
 * An empty claim list means "not evaluated", never "passed".
 */

export interface StructureCheck {
  readonly id: string;
  readonly title: string;
}

/** The frozen structure vocabulary the Task 6 judgement will populate. */
export const STRUCTURE_CHECKS: readonly StructureCheck[] = [];

export function evaluateStructure(
  _input: QaEvaluationInput,
): readonly QaClaim[] {
  return [];
}
