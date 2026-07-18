/**
 * Proof-block detector (spec §8.4, GEO-ENTITY-001). A proof block is a paragraph
 * that contains BOTH a named organization/customer cue (a capitalized proper name
 * or a quoted name) AND a concrete number / percentage / currency amount. English
 * only — for non-English sites the detector returns `inconclusive` (never a
 * defect). A version bump is required if the heuristics change.
 */

export const PROOF_BLOCK_VERSION = "proof_block.v1";

const NUMERIC_CUE = /(\$\s?\d|\d+(?:\.\d+)?\s?%|\b\d{2,}\b|\b\d+(?:,\d{3})+\b)/;
// A capitalized multi-word proper name (e.g. "Acme Corp") or a quoted name.
const NAMED_CUE = /(["“][^"”]{2,}["”]|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b)/;

/** Whether a single paragraph qualifies as a proof block. */
export function isProofBlock(paragraph: string): boolean {
  return NAMED_CUE.test(paragraph) && NUMERIC_CUE.test(paragraph);
}

/** Whether any paragraph on the page is a proof block. */
export function hasProofBlock(paragraphs: readonly string[]): boolean {
  return paragraphs.some(isProofBlock);
}
