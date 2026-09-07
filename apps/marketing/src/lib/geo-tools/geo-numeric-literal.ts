// @input -- arbitrary claim or evidence-excerpt text
// @output -- the numeric literals that text asserts; never fetches, generates, or persists
// @pos -- the single reading of a number shared by every GEO knowledge guard

/**
 * How the GEO knowledge guards read numbers, shared by the accepted-fact guard
 * (`./kb-knowledge-pack.ts`), the pack-integrity guard
 * (`./kb-knowledge-pack-contract.ts`), the narrative guard
 * (`./kb-knowledge-synthesis-contract.ts`) and the role/question synthesis guard
 * (`./kb-synthesis-contract.ts`).
 *
 * All four ask the same question -- does every number this claim asserts occur
 * in text that was actually observed? -- so they must not answer it differently.
 * They previously each carried a byte-identical hand-written `[$€£¥]` class, and
 * a guard that knows only the currencies somebody remembered to type is not a
 * guard: ₩, ₹, ₽, ₺, ₪, ฿, ₫, ₴ and every other sign fell outside it and was
 * silently dropped, so a won price and a bare number read as the same literal
 * and a model could attach a unit the evidence never showed. Living in one file
 * is the point: none of the four can learn a currency the others have not.
 */

/**
 * The numeric literals `value` asserts, sign included.
 *
 * The currency sign is part of the returned token rather than metadata beside
 * it, because that is what the callers compare: they put excerpt tokens in a
 * `Set` and ask whether each claim token is in it. `₩100` and `100` are
 * therefore different literals, which is the whole fix -- and `₩100` and `¥100`
 * are different literals too, which is the same rule applied consistently.
 *
 * `\p{Sc}` rather than an enumeration: which currencies a guard recognizes must
 * be Unicode's answer, not a list that goes stale the first time a customer
 * prices in a currency nobody on the team thought of.
 *
 * The regex is built per call rather than shared, so no caller can leave a
 * `lastIndex` behind for another.
 */
export function geoNumericLiterals(value: string): readonly string[] {
  return value.match(/[+-]?(?:\p{Sc}\s*)?\p{N}+(?:[.,:/-]\p{N}+)*(?:\s*[%％])?/gu) ?? [];
}

/**
 * Whether every numeric literal in `claims` occurs somewhere in `evidence`.
 *
 * Deliberately not normalized any further. NFKC would fold ￥ onto ¥ and
 * fullwidth ９９００ onto 9900, which are compatibility spellings of the same
 * number, and the artifact-side guard in `packages/artifacts/src/llm/` does
 * exactly that -- but it tokenizes with `\d`, where `½` and `²` are invisible
 * today, so folding them in only ever adds a check. Here the tokenizer is
 * `\p{N}`, which already reads `½` and `2²` as literals, and NFKC rewrites them
 * into `1⁄2` and `22`. A claim of `½` cited to an excerpt that merely says `1`
 * and `2` would start passing. That is the one direction this guard may not
 * move, so the width folding waits for a tokenizer that narrows the digit class
 * first -- a larger question than which currencies are recognized.
 */
export function geoNumbersSupported(claims: readonly string[], evidence: readonly string[]): boolean {
  const allowed = new Set(evidence.flatMap(geoNumericLiterals));
  return claims.flatMap(geoNumericLiterals).every(literal => allowed.has(literal));
}
