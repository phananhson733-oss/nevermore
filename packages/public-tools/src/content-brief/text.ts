// @input  -- a string a model or a third-party page produced
// @output -- the one cleaned, code-point-bounded form both producer and parser accept
// @pos    -- the single model-text decoder; LLM validation and parse-brief must not diverge from it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why one decoder.
 *
 * The LLM validator (producer side) and the draft-side parser both bound the
 * model's free text. Two implementations drift the moment one counts UTF-16
 * units and the other counts code points, or one strips angle brackets and
 * the other does not — and the handler's self-check then rejects a brief the
 * producer just validated. Both call this.
 */

// eslint-disable-next-line no-control-regex -- the point is to strip control characters
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/gu;
const ANGLE_BRACKETS = /[<>]/gu;

export interface ModelTextFailure {
  readonly ok: false;
  readonly reason: "empty" | "too_long";
}

export type ModelTextResult = { readonly ok: true; readonly value: string } | ModelTextFailure;

/** Code points, not UTF-16 units: an emoji is one character to everyone who reads it. */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _char of value) count += 1;
  return count;
}

/**
 * Cleans and bounds model-produced free text. Cleaning is idempotent, so a
 * value that passed here once passes again unchanged on the parser side.
 */
export function boundedModelText(value: string, maxCodePoints: number): ModelTextResult {
  const cleaned = value
    .replace(CONTROL_CHARS, "")
    .replace(ANGLE_BRACKETS, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (codePointLength(cleaned) > maxCodePoints) return { ok: false, reason: "too_long" };
  return { ok: true, value: cleaned };
}

/** True when `value` is already in its cleaned form and within bound. */
export function isBoundedModelText(value: string, maxCodePoints: number): boolean {
  const result = boundedModelText(value, maxCodePoints);
  return result.ok && result.value === value;
}
