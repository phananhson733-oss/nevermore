/**
 * Whether two values the store holds are the same content: the same reference
 * (checked first, and the common case, since the reducer keeps every reference
 * an action does not write), or else equal once JSON-encoded.
 *
 * Why JSON (codex S6r3 #2): the store persists through JSON, and a `storage`
 * event re-parses the whole state, so a write another tab made to an unrelated
 * field hands back every value as a new reference with the same content. A
 * confirmation compared by reference alone was refused, and the same box asked
 * again with nothing to say why. Equal under JSON is all the store itself can
 * tell apart, so the same content is the same authorisation.
 *
 * Which way it errs. Key order is part of the encoding, so the same content
 * with its keys in another order compares unequal: that asks again, the safe
 * side. What JSON collapses compares equal: `undefined` and a missing key,
 * `NaN` / `Infinity` and `null`, `-0` and `0`. Those are the same value once the
 * state has been persisted and loaded once, too. A value JSON cannot encode (a
 * bigint, a cycle) throws, except on the reference path; `types.ts` describes
 * JSON-shaped state with neither.
 *
 * Used by every confirmation the reducer checks: `sameDemoFields` per field,
 * `clearGscRows` for the rows and their source.
 */
export function sameContent(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
