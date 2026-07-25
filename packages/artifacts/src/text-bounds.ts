/**
 * Length bounds that cut between CHARACTERS, never between the two halves of
 * one.
 *
 * `String.prototype.slice` counts UTF-16 code units. Every character outside
 * the Basic Multilingual Plane — emoji, most CJK extension ideographs,
 * mathematical alphanumerics — occupies two of them, so a cut at a fixed count
 * can land inside a surrogate pair and leave a lone high surrogate at the end
 * of the string.
 *
 * That is not a cosmetic defect. `JSON.stringify` emits the orphan as
 * `"\ud83d"`, PostgreSQL's `jsonb` REJECTS unpaired surrogates, and the write
 * that carries the value throws. In this repository the affected values are
 * written into `flow_shadow_runs.frozen_input_manifest`, artifact
 * `content_json` and QA claim details — all `jsonb` — so the failure mode is a
 * run that produced a perfectly good result and then died on the insert.
 *
 * The gate package fixed its own two truncations
 * (`qa/text.ts:truncateExcerpt`, `qa/evaluate.ts:boundedDetail`) and this file
 * is the same fix for the artifact package's five, in one place so there is no
 * sixth to find later. `packages/sources` keeps its own copy of the primitive
 * because it must not depend on this package.
 */

/** The single-character marker every truncated value in this package ends with. */
const ELLIPSIS = "…";

/**
 * Cut `value` to at most `maxChars` CODE POINTS, marking the cut.
 *
 * The fast path compares UTF-16 length first: a string whose code-unit count
 * already fits cannot have more code points than that, so nothing needs to be
 * decomposed. Only a string that might be cut pays for the array.
 *
 * At `maxChars <= 1` there is no room for both a character and the marker, so
 * the value is cut to the bound and the marker is dropped rather than emitted
 * alone — a bare `…` says "there was something here" and names none of it.
 */
export function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const points = [...value];
  if (points.length <= maxChars) return value;
  if (maxChars <= 1) {
    return points.slice(0, Math.max(0, maxChars)).join("");
  }
  return `${points.slice(0, maxChars - 1).join("").trimEnd()}${ELLIPSIS}`;
}

/**
 * Cut `value` to at most `maxChars` code points with NO marker.
 *
 * For hard caps whose callers treat the value as an opaque bounded token rather
 * than as prose a person reads.
 */
export function boundChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const points = [...value];
  if (points.length <= maxChars) return value;
  return points.slice(0, Math.max(0, maxChars)).join("");
}
