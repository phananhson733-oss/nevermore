// @input  -- the raw text of the supporting-keyword field
// @output -- how many pieces it names, and the cleaned list or the first refusal
// @pos    -- the parse behind the Marketing content brief form's supporting field
//
// Same shape as competitor-keyword-gap-competitor-input.ts: the field IS the
// list, nothing commits on a separator, and the parse happens when the visitor
// runs. The separator set differs because these are keywords, not hostnames:
// a space is part of "approval workflow", so only commas, semicolons, the
// CJK enumeration comma and line breaks separate.

import { SUPPORTING_KEYWORDS_MAX } from "@sf/public-tools/content-brief/constants";

const SEPARATORS = /[,，、;；\r\n]+/u;

export type SupportingInputParse =
  | { readonly ok: true; readonly keywords: readonly string[] }
  | { readonly ok: false; readonly validationKey: string };

function splitSupportingInput(input: string): readonly string[] {
  return input
    .split(SEPARATORS)
    .map((piece) => piece.replace(/\s+/gu, " ").trim())
    .filter((piece) => piece !== "");
}

/**
 * How many supporting keywords the field currently names.
 *
 * Counts SEPARATED PIECES, not accepted keywords: this feeds the "n / max"
 * line under a box someone is still typing in. A duplicate or a piece over
 * the limit is still a piece they wrote; running the tool is what names the
 * reason one of them cannot be used.
 */
export function countSupportingInput(input: string): number {
  return splitSupportingInput(input).length;
}

/**
 * The cleaned supporting keywords, or the first reason the field cannot run.
 *
 * Exact duplicates (after whitespace folding and case folding) collapse to
 * one entry rather than refusing: two spellings of the same phrase are one
 * keyword to the outline model, and the count line already told the visitor
 * how many pieces they typed. The cap is checked on the collapsed list, and
 * the API checks it again on its own side.
 */
export function parseSupportingInput(input: string): SupportingInputParse {
  const pieces = splitSupportingInput(input);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const piece of pieces) {
    const key = piece.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(piece);
  }
  if (keywords.length > SUPPORTING_KEYWORDS_MAX) {
    return { ok: false, validationKey: "validation.supportingLimit" };
  }
  return { ok: true, keywords };
}
