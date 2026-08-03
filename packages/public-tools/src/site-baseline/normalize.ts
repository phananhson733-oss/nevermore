// @input  -- raw Search Console query strings and the visitor's brand terms
// @output -- normalized queries and a brand / non-brand partition
// @pos    -- shared query normalization for the CTR curve and future coverage filters
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { GscQueryRow } from "./types.ts";

/**
 * Lowercase and collapse runs of whitespace.
 *
 * Deliberately does nothing else. Stripping punctuation or accents would make
 * two visibly different queries compare equal, and every downstream use of
 * this value is shown back to the visitor next to the number computed from it.
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Whether a brand term appears in the query as a whole word sequence.
 *
 * Matching is on token boundaries rather than substrings. A substring match
 * would pull "gengrowthly reviews" out of the curve as a brand query, and a
 * brand filter that silently removes non-brand rows moves the whole baseline
 * without leaving a trace the visitor could check. Multi-word terms have to
 * appear adjacent and in order.
 *
 * Blank terms are ignored: an empty string is "contained" in every query and
 * would otherwise empty the curve in one step.
 */
export function isBrandQuery(
  query: string,
  brandTerms: readonly string[],
): boolean {
  const tokens = normalizeQuery(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return false;

  for (const term of brandTerms) {
    const termTokens = normalizeQuery(term).split(" ").filter(Boolean);
    if (termTokens.length === 0) continue;
    if (containsSequence(tokens, termTokens)) return true;
  }
  return false;
}

function containsSequence(
  tokens: readonly string[],
  sequence: readonly string[],
): boolean {
  const last = tokens.length - sequence.length;
  for (let start = 0; start <= last; start += 1) {
    let matched = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (tokens[start + offset] !== sequence[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

export interface BrandQuerySplit {
  readonly brand: readonly GscQueryRow[];
  readonly nonBrand: readonly GscQueryRow[];
}

/**
 * Partition rows into brand and non-brand.
 *
 * Both sides are kept. The brand side is not analysed in v1, but its size is
 * reported so a visitor who sees an implausible count can correct the brand
 * terms rather than wonder why their curve looks the way it does.
 */
export function splitBrandQueries(
  rows: readonly GscQueryRow[],
  brandTerms: readonly string[],
): BrandQuerySplit {
  const brand: GscQueryRow[] = [];
  const nonBrand: GscQueryRow[] = [];

  for (const row of rows) {
    if (isBrandQuery(row.query, brandTerms)) brand.push(row);
    else nonBrand.push(row);
  }

  return { brand, nonBrand };
}
