// @input  -- whatever the visitor typed or pasted into the competitor field, plus what is already accepted
// @output -- the full accepted list, or the first reason a piece of it cannot be accepted
// @pos    -- the parse behind the Marketing competitor gap form's comma-separated competitor field

// The barrel, matching the form component that is this module's only caller.
// There is no `/validation` subpath in the package's exports, and the form
// already pulls both of these through the barrel in the same bundle.
import {
  COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS,
  normalizeCompetitorKeywordGapDomain,
} from "@sf/public-tools/competitor-keyword-gap";

/**
 * Every character people actually separate a list of domains with.
 *
 * The full-width comma is not optional: this form is used in Chinese, where it
 * is the comma the keyboard produces, and treating it as part of a hostname
 * would reject the whole line with "not a domain". Newlines, tabs, semicolons
 * and plain spaces come free with a paste out of a spreadsheet or a chat
 * message, so they separate too rather than failing validation.
 */
const SEPARATORS = /[,，、;；\s]+/u;

export type CompetitorInputParse =
  | { readonly ok: true; readonly domains: readonly string[] }
  | { readonly ok: false; readonly validationKey: string };

/**
 * Fold what was typed into what is already accepted.
 *
 * The FIRST failure stops the batch and nothing is added. The form has one
 * validation line, so it can name one reason; accepting three of five and
 * silently dropping two would leave the visitor to work out which two, from a
 * chip list they never saw complete.
 *
 * Blank input is not a failure. It is the ordinary state of this field once the
 * chips are made -- blurring it, pressing enter in it, or submitting the form
 * all reach here with nothing pending, and none of those is an error.
 */
export function parseCompetitorInput(
  input: string,
  accepted: readonly string[],
  siteDomain: string,
): CompetitorInputParse {
  const pieces = input
    .split(SEPARATORS)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
  if (pieces.length === 0) return { ok: true, domains: accepted };

  const site = normalizeCompetitorKeywordGapDomain(siteDomain);
  const domains = [...accepted];
  for (const piece of pieces) {
    const domain = normalizeCompetitorKeywordGapDomain(piece);
    if (domain === null) {
      return { ok: false, validationKey: "validation.competitorInvalid" };
    }
    if (site !== null && domain === site) {
      return { ok: false, validationKey: "validation.competitorSelf" };
    }
    if (domains.includes(domain)) {
      return { ok: false, validationKey: "validation.competitorDuplicate" };
    }
    if (domains.length >= COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS) {
      return { ok: false, validationKey: "validation.competitorLimit" };
    }
    domains.push(domain);
  }
  return { ok: true, domains };
}
