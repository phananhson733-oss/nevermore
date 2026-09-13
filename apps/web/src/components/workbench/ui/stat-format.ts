/**
 * Display-layer conversion for a single number shown as a metric.
 *
 * It exists because the store speaks three different "no value" dialects —
 * `audit?.score` is `number | undefined`, `keywordRowCount` is `number | null`,
 * `artifacts.length` is a plain number — while `StatCard.value` is
 * `string | null`, where `null` means "unknown" and prints an em dash. Passing
 * the raw fields through does not type-check, and the two shortcuts that make
 * it type-check are both lies: `?? 0` claims a measurement of zero the
 * workbench never took, and mapping 0 to "unknown" (what `countOrNull` in
 * store/selectors.ts does for badges, on purpose, because a badge with 0 is
 * hidden) erases a real measured zero — "0 artifacts this session" is a fact
 * the overview has to be able to state (裁决 Q9 / Q10).
 *
 * So: unknown in, `null` out; a number in, its digits out, zero included.
 *
 * Counts are printed with `String`, without grouping separators, matching the
 * badges in store/selectors.ts. Nothing here is locale-dependent, so it is safe
 * on both sides of hydration.
 *
 * 一旦本文件被更新，务必更新开头注释
 */

/**
 * What a metric shows when its value is unknown. An em dash — never "0", and
 * never an empty cell (an empty cell reads as a rendering bug).
 */
export const UNKNOWN_TEXT = "—";

/**
 * A number for display, or `null` when there is no number to display.
 *
 * `null` / `undefined` are unknown. `NaN` and the infinities are also unknown:
 * they are not measurements, and "NaN" set at 36px in a card would read as a
 * value. Zero is a value and survives — `statValue(0) === "0"`.
 */
export function statValue(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n)) return null;
  // `-0 === 0`, so this normalises negative zero, whose `String` is "-0".
  return String(n === 0 ? 0 : n);
}
