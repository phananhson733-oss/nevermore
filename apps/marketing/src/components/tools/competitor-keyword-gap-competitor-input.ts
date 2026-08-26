// @input  -- the raw text of the competitor field
// @output -- the domains it names, or the first reason one of them cannot be used
// @pos    -- the parse behind the Marketing competitor gap form's comma-separated competitor field
//
// The field IS the list. Nothing here mutates what the visitor typed and there
// is no commit step: they fill the box, commas and all, and the parse happens
// when they run. An earlier version turned each piece into a chip the moment a
// separator arrived, which emptied the box under the cursor mid-sentence.

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

/** The separated, non-empty pieces of the field, before any of them is judged. */
function splitCompetitorInput(input: string): readonly string[] {
  return input
    .split(SEPARATORS)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
}

/**
 * How many competitors the field currently names.
 *
 * Counts SEPARATED PIECES, not valid domains: this feeds the "n / 5" line under
 * a box someone is still typing in, where half a hostname is a competitor they
 * are in the middle of writing rather than a competitor that does not count.
 * Whether each one is usable is what running the tool answers, in the one place
 * that can name a reason.
 */
export function countCompetitorInput(input: string): number {
  return splitCompetitorInput(input).length;
}

/**
 * Every domain the field names, or the first reason one of them cannot be used.
 *
 * The FIRST failure stops the whole thing and returns no domains. The form has
 * one validation line, so it can name one reason; accepting three of five and
 * silently dropping two would leave the visitor to work out which two, from a
 * field they can still see all five in.
 *
 * Blank input is not a failure -- an empty field is the ordinary starting
 * state, and "nothing typed yet" is a different message from "that is not a
 * domain". The caller decides whether empty is allowed at the point it asks.
 */
export function parseCompetitorInput(
  input: string,
  siteDomain: string,
): CompetitorInputParse {
  const pieces = splitCompetitorInput(input);
  if (pieces.length === 0) return { ok: true, domains: [] };

  const site = normalizeCompetitorKeywordGapDomain(siteDomain);
  const domains: string[] = [];
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
