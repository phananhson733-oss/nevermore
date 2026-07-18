/**
 * `cluster_key.v1` (spec §7.5). Derives a stable cluster key from a keyword so
 * that near-identical keywords land in the same `keyword_cluster` subject.
 *
 * Algorithm (identical input MUST give identical key — pure, no ambient state):
 *   1. Unicode NFKC normalize
 *   2. lowercase
 *   3. remove punctuation (collapse non-letter/number runs to a single space)
 *   4. remove built-in English stopwords
 *   5. keep the FIRST TWO tokens of length >= 3, in original order, joined by a
 *      single space; if fewer than two such tokens exist, use ALL remaining
 *      tokens instead.
 * A keyword that yields NO tokens after this processing is rejected (`null`).
 *
 * Any change to this algorithm MUST bump the version suffix (spec §7.5).
 */

export const CLUSTER_KEY_VERSION = "cluster_key.v1";

/** Minimum token length that qualifies for the "first two" selection. */
const MIN_TOKEN_LENGTH = 3;

/**
 * A small built-in English stopword set. Function words only — never removes
 * content words that carry topical meaning.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "the", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "am", "this", "that", "these", "those", "it", "its", "i", "you", "he", "she",
  "we", "they", "my", "your", "his", "her", "our", "their", "me", "him", "us",
  "them", "do", "does", "did", "done", "has", "have", "had", "having", "will",
  "would", "shall", "can", "could", "should", "may", "might", "must", "not",
  "no", "nor", "so", "if", "then", "than", "too", "very", "just", "about",
  "into", "onto", "over", "under", "up", "out", "off", "down", "again", "once",
  "here", "there", "all", "any", "some", "such", "own", "same", "s", "t", "re",
  "ve", "ll", "d", "m", "o",
]);

/**
 * Compute the `cluster_key.v1` for a keyword, or `null` when the keyword yields
 * no usable tokens (a reject signal for the caller).
 */
export function clusterKey(keyword: string): string | null {
  const cleaned = keyword
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (cleaned === "") return null;

  const tokens = cleaned.split(/\s+/).filter((token) => !STOPWORDS.has(token));
  if (tokens.length === 0) return null;

  const longTokens = tokens.filter((token) => token.length >= MIN_TOKEN_LENGTH);
  const chosen = longTokens.length >= 2 ? longTokens.slice(0, 2) : tokens;
  return chosen.join(" ");
}
