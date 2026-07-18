/**
 * `intent_match.v1` (spec §8.4). English-only. A target (offer / use case /
 * cluster key) is "covered" when ALL of its core tokens appear in at least one
 * page field (URL path, title, or H1). Tokenization: Unicode NFKC → lowercase →
 * punctuation → space → drop built-in stopwords. Empty target tokens, non-English
 * projects, or pages without a title/H1 return `inconclusive`, never a defect.
 * A version bump is required if the stopword list or normalization changes.
 */

export const INTENT_MATCH_VERSION = "intent_match.v1";

const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "or", "the", "of", "for", "to", "in", "on", "at", "by",
  "with", "from", "as", "is", "are", "be", "your", "our", "you", "we", "it",
  "this", "that", "these", "those", "how", "what", "why", "best", "top", "vs",
]);

/** NFKC → lowercase → punctuation→space → split → drop stopwords + <2 char. */
export function intentTokens(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  return normalized
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export type IntentMatch = "covered" | "uncovered" | "inconclusive";

/**
 * Whether `target` is covered by at least one of the candidate page field sets.
 * `pageFields` is a list of already-tokenized field bags (one per candidate page,
 * each bag the union of its URL/title/H1 tokens). A page contributed to the bag
 * only if it had a title or H1 (else it is excluded upstream and the caller
 * decides inconclusive).
 */
export function matchIntent(
  target: string,
  pageFieldBags: readonly ReadonlySet<string>[],
): IntentMatch {
  const targetTokens = intentTokens(target);
  if (targetTokens.length === 0) return "inconclusive";
  if (pageFieldBags.length === 0) return "inconclusive";
  for (const bag of pageFieldBags) {
    if (targetTokens.every((t) => bag.has(t))) return "covered";
  }
  return "uncovered";
}

/** Build a field token bag for a page from its URL path, title and headings. */
export function pageFieldBag(input: {
  urlPath: string;
  title: string | null;
  h1: readonly string[];
}): ReadonlySet<string> | null {
  // A page with neither title nor H1 cannot be judged (spec §8.4) → null.
  if (!input.title && input.h1.length === 0) return null;
  const bag = new Set<string>();
  for (const t of intentTokens(input.urlPath)) bag.add(t);
  if (input.title) for (const t of intentTokens(input.title)) bag.add(t);
  for (const heading of input.h1) for (const t of intentTokens(heading)) bag.add(t);
  return bag;
}
