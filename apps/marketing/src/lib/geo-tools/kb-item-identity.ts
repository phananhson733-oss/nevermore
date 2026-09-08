// @input -- v3 knowledge item content, never its evidence or generation lineage
// @output -- content-only normalisation, item key parts and a wording-drift score
// @pos -- client-safe pure text; the digest itself lives in the server-only key module

/**
 * Item identity is content, not provenance. A fact keeps its key when the page
 * that evidenced it changes, so an owner's correction or exclusion survives the
 * next update. The v1/v2 pack derived a fact id from its source id instead
 * (`kb-knowledge-pack.ts`), which made every re-crawl a new item.
 */

/**
 * Words dropped before comparing wording. Kept deliberately small: an
 * aggressive stop list makes distinct statements collide, and a collision here
 * silently merges two owner decisions.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "of", "for", "to", "in", "on", "at", "by", "with",
  "is", "are", "was", "were", "be", "been", "and", "or",
]);

/**
 * Identity normalisation. It folds away only what is definitionally not
 * content: Unicode case, compatibility forms, control/format code points and
 * whitespace runs. Punctuation, symbols and every word are kept.
 *
 * Anything more aggressive collides. Dropping `+` makes the Pro and Pro+ plans
 * one item, so a correction to one plan's price silently rewrites the other's;
 * dropping `and`/`or` makes "requires macOS and Linux" and "requires macOS or
 * Linux" one statement. The opposite failure -- the same claim re-punctuated
 * between two updates producing a new key -- costs the owner a second decision
 * on an item that reappears as pending. Losing a decision is recoverable;
 * merging two claims asserts something nobody approved.
 *
 * Folding away `\p{C}` is also what keeps the separators below impossible
 * inside a part, so ["ab","c"] and ["a","bc"] cannot hash alike.
 */
export function normalizeGeoIdentityText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/\p{C}/gu, " ")
    .split(/\s+/u)
    .filter((token) => token !== "")
    .join(" ");
}

/**
 * Similarity normalisation, used ONLY to decide whether to *ask* the owner
 * whether two items are the same. It is deliberately lossy -- punctuation and
 * symbols become spaces, stop words go -- which is exactly why it must never
 * reach an item key: two genuinely different claims routinely normalise alike
 * here, and a key collision merges owner decisions without anyone deciding.
 */
export function normalizeGeoSimilarityText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[\p{P}\p{S}\p{C}]/gu, " ")
    .split(/\s+/u)
    .filter((token) => token !== "" && !STOP_WORDS.has(token))
    .join(" ");
}

/** Similarity tokens of a value, duplicates removed, input order kept. */
export function geoItemTokens(value: string): readonly string[] {
  const normalized = normalizeGeoSimilarityText(value);
  return normalized === "" ? [] : [...new Set(normalized.split(" "))];
}

/**
 * Jaccard overlap of normalised tokens. This only ever produces a *prompt* for
 * the owner. Two scope statements differing by one word reach 0.9 easily, so
 * inheriting a decision automatically at any threshold would make the other
 * statement disappear without anyone deciding that.
 */
export function geoItemSimilarity(left: string, right: string): number {
  const a = new Set(geoItemTokens(left)), b = new Set(geoItemTokens(right));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** At or above this, the owner is *asked* whether it is the same item. */
export const GEO_ITEM_SIMILARITY_PROMPT = 0.75;

/**
 * Joins key parts. Normalisation removes every `\p{C}` code point, so this can
 * never occur inside a part: ["ab","c"] and ["a","bc"] stay distinct keys.
 */
export const GEO_ITEM_KEY_SEPARATOR = "\u001f";

/**
 * Joins the qualifier set *inside* one key part. A separate separator keeps a
 * fixed-arity basis unambiguous even if a future part is added after it.
 */
export const GEO_ITEM_QUALIFIER_SEPARATOR = "\u001e";

/** The identity-defining parts of each reviewable item kind. */
export type GeoItemKeyParts =
  | { readonly module: "facts"; readonly type: string; readonly subject: string; readonly attribute: string; readonly qualifiers: readonly string[] }
  | { readonly module: "qa"; readonly intent: string; readonly canonicalQuestion: string }
  | { readonly module: "comparisons"; readonly competitorKey: string; readonly dimension: string }
  | { readonly module: "scope"; readonly kind: string; readonly statement: string }
  | { readonly module: "entity"; readonly field: string };

/**
 * The exact strings hashed for an item key, in a fixed order. Returned as text
 * so the client can reason about identity (for merge prompts) without pulling
 * a Node crypto import into the browser bundle.
 */
export function geoItemKeyBasis(parts: GeoItemKeyParts): readonly string[] {
  switch (parts.module) {
    case "facts":
      return [
        "facts",
        normalizeGeoIdentityText(parts.type),
        normalizeGeoIdentityText(parts.subject),
        normalizeGeoIdentityText(parts.attribute),
        // A set, sorted: qualifier order is not identity and neither is a
        // repeated qualifier, but a differing qualifier *set* is -- one plan's
        // correction must never reach another plan's price. Without the dedupe,
        // an extractor emitting ["Pro"] once and ["Pro","pro"] the next time
        // would lose the saved decision.
        [...new Set(parts.qualifiers.map(normalizeGeoIdentityText))]
          .filter((value) => value !== "")
          .sort()
          .join(GEO_ITEM_QUALIFIER_SEPARATOR),
      ];
    case "qa":
      return ["qa", normalizeGeoIdentityText(parts.intent), normalizeGeoIdentityText(parts.canonicalQuestion)];
    case "comparisons":
      return ["comparisons", normalizeGeoIdentityText(parts.competitorKey), normalizeGeoIdentityText(parts.dimension)];
    case "scope":
      return ["scope", normalizeGeoIdentityText(parts.kind), normalizeGeoIdentityText(parts.statement)];
    case "entity":
      // Entity fields are addressed by name; their value is what the owner edits.
      return ["entity", parts.field];
  }
}
