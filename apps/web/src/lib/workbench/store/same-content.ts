/**
 * Whether two values the store holds are the same content: the same reference
 * (checked first, and the common case, since the reducer keeps every reference
 * an action does not write), or else the same canonical JSON, meaning every
 * object's keys in sorted order and every array in its own order.
 *
 * Why content (codex S6r3 #2): the store persists through JSON, and a `storage`
 * event re-parses the whole state, so a write another tab made to an unrelated
 * field hands back every value as a new reference with the same content. A
 * confirmation compared by reference alone was refused, and the same box asked
 * again with nothing to say why.
 *
 * Why sorted keys (S6r3 C): that re-parse goes through `schema.ts`, and zod's
 * `strictObject` rebuilds each object in the schema's key order, not the order
 * the producer wrote. Plain `JSON.stringify` then differed wherever a producer
 * and the schema disagree on order, and #2 came back on the real path. Key
 * order carries nothing the operator sees. Array order does (rows, the basket,
 * history), so arrays are compared as they are.
 *
 * A key holding `undefined` is the same as a missing key, as in JSON: persisted
 * bytes cannot hold `undefined`, so after one save and load the store itself
 * cannot tell the two apart (the reducer writes an artifact's dropped
 * `filename` as `undefined`, and it comes back missing). JSON also turns `NaN`
 * and `Infinity` into `null` and `-0` into `0`, and those compare equal for the
 * same reason; `schema.ts` rejects `NaN` and `Infinity` on load. A value JSON
 * cannot encode (a bigint, a cycle) throws, except on the reference path;
 * `types.ts` describes JSON-shaped state with neither.
 *
 * Used by every confirmation the reducer checks: `sameDemoFields` per field,
 * `clearGscRows` for the rows and their source.
 */
export function sameContent(left: unknown, right: unknown): boolean {
  return left === right || canonicalJson(left) === canonicalJson(right);
}

/** `JSON.stringify` with each object's keys sorted; `toJSON` has run before the replacer sees a value. */
function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, sortedKeys);
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
}
