// @input  -- target queries as the visitor typed them, and page text to match against
// @output -- normalized display / identity pairs, or a rejection reason
// @pos    -- the one normalization pipeline both sides of a keyword match go through
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Maximum target queries accepted in one run, counted after deduplication.
 * Frozen by the keyword evidence contract; the request is rejected past it
 * rather than truncated, because silently dropping the sixth query would show
 * the visitor evidence for a question they did not ask.
 */
export const MAX_TARGET_QUERIES = 5;

/**
 * Maximum length of one normalized query, in UTF-16 code units.
 *
 * Matches the existing seed-length limit the keyword tools already enforce, so
 * a query that is legal in one surface is legal in the other.
 */
export const MAX_TARGET_QUERY_LENGTH = 80;

export interface NormalizedTargetQuery {
  /** What the visitor typed, cleaned up but with their casing intact. */
  readonly displayQuery: string;
  /** The lowercase form every comparison is made on. */
  readonly identity: string;
}

export type NormalizeTargetQueriesRejection =
  | "empty_after_normalization"
  | "query_too_long"
  | "too_many_queries";

export type NormalizeTargetQueriesResult =
  | { readonly ok: true; readonly queries: readonly NormalizedTargetQuery[] }
  | { readonly ok: false; readonly reason: NormalizeTargetQueriesRejection };

/**
 * Zero-width code points removed before whitespace is collapsed.
 *
 * Order matters. Collapsing first leaves the space on each side of a removed
 * ZWSP as a double space, so `a<ZWSP> b` and `a b` would carry different
 * identities and dodge deduplication.
 */
const ZERO_WIDTH_PATTERN = /\u200B|\u200C|\u200D|\uFEFF/gu;

/**
 * Shared cleanup: NFKC, drop zero-width, collapse whitespace, trim.
 *
 * Deliberately does not strip punctuation or accents. Two visibly different
 * queries must not compare equal, because the number computed from a query is
 * shown back to the visitor next to the query itself.
 */
function cleanup(value: string): string {
  // NFKC, drop zero-width, trim, collapse — the order the versioned algorithm
  // states. Trimming after collapsing is equivalent today, but the algorithm
  // is published with a version and read by people implementing against it, so
  // it is followed rather than approximated.
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH_PATTERN, "")
    .trim()
    .replace(/\s+/gu, " ");
}

/**
 * Normalize one query, or null when nothing usable is left.
 *
 * The length limit is applied to the normalized value, so padding a legal
 * query with whitespace does not make it illegal.
 */
export function normalizeTargetQuery(
  raw: string,
): NormalizedTargetQuery | null {
  const displayQuery = cleanup(raw);
  if (displayQuery === "") return null;
  return { displayQuery, identity: displayQuery.toLowerCase() };
}

/**
 * Normalize a submitted list into the queries evidence will be built for.
 *
 * Rejects the whole request rather than repairing it: an over-length query or
 * a sixth query is a mistake the visitor can see and fix, while a truncated
 * list is a silent substitution of the question being answered.
 */
export function normalizeTargetQueries(
  raw: readonly string[],
): NormalizeTargetQueriesResult {
  const accepted: NormalizedTargetQuery[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const normalized = normalizeTargetQuery(entry);
    if (normalized === null) continue;
    if (normalized.displayQuery.length > MAX_TARGET_QUERY_LENGTH) {
      return { ok: false, reason: "query_too_long" };
    }
    if (seen.has(normalized.identity)) continue;
    seen.add(normalized.identity);
    accepted.push(normalized);
  }

  if (accepted.length === 0) {
    return { ok: false, reason: "empty_after_normalization" };
  }
  if (accepted.length > MAX_TARGET_QUERIES) {
    return { ok: false, reason: "too_many_queries" };
  }
  return { ok: true, queries: accepted };
}

/**
 * Normalize page text for comparison against a query identity.
 *
 * Same pipeline as an identity, so a match is decided on two values that were
 * cleaned the same way. Anything else makes coverage depend on which side of
 * the comparison a character happened to be on.
 */
export function normalizeForMatch(text: string): string {
  return cleanup(text).toLowerCase();
}
