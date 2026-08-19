// @input  -- normalized page text and normalized target queries
// @output -- text_units.v1 counts and the basis that produced them
// @pos    -- the single counting unit behind every keyword density number
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The counting unit version. Any change to how units are derived is a new
 * version, because the number is published next to the density computed from
 * it and two runs labelled the same must be comparable.
 */
export const TEXT_UNITS_VERSION = "text_units.v1" as const;

/**
 * Which kind of text produced the units.
 *
 * Published alongside every count: a CJK page and a Latin page are both
 * measured, but the units are not the same thing, and a reader comparing the
 * two numbers has to be able to see that.
 */
export type TextUnitsBasis = "words" | "cjk_chars" | "mixed";

export interface TextUnits {
  readonly units: number;
  readonly basis: TextUnitsBasis;
}

/**
 * CJK code point ranges counted one unit per character.
 *
 * Deliberately not a dictionary segmenter: a wrong word boundary changes the
 * denominator of a published density, and a per-character count is wrong in a
 * way the reader can predict and we can state, rather than wrong in a way that
 * looks like a real word count.
 */
/**
 * Written as escapes, not as the characters themselves.
 *
 * The literal form was copied into three other modules and one of them arrived
 * carrying U+8C48 in place of U+F900 — two characters that render identically
 * and differ by twenty-seven thousand code points, which silently classified
 * Yi, private-use and Latin Extended-D as CJK. Escapes cannot be swapped by a
 * homoglyph. The set is unchanged: U+3400-U+9FFF, U+F900-U+FAFF, U+3040-U+309F,
 * U+30A0-U+30FF, U+AC00-U+D7AF.
 */
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu;

/**
 * Count text in `text_units.v1`.
 *
 * CJK code points count one unit each and are removed; what remains is split
 * on whitespace and each non-empty run counts one unit. Japanese kana and
 * Hangul are counted per character too, which overstates the denominator for
 * those scripts. That cost is stated in the published limitation rather than
 * hidden behind a segmenter we cannot defend.
 */
export function countTextUnits(text: string): TextUnits {
  const cjkMatches = text.match(CJK_PATTERN);
  const cjkUnits = cjkMatches === null ? 0 : cjkMatches.length;
  // Removed, not replaced with a space. The frozen unit takes the CJK code
  // points out and splits what is left, so `SEO工具checker` is three units.
  // Substituting a space would split that remainder in two and change every
  // density derived from it.
  const remainder = text.replace(CJK_PATTERN, "");
  const wordUnits = remainder.split(/\s+/u).filter(Boolean).length;

  const units = cjkUnits + wordUnits;
  if (cjkUnits > 0 && wordUnits > 0) return { units, basis: "mixed" };
  if (cjkUnits > 0) return { units, basis: "cjk_chars" };
  return { units, basis: "words" };
}

/**
 * The same units, assembled from counts someone else already took.
 *
 * The crawler measures the full body once, while it still has it, and publishes
 * three numbers instead of the text. This is where those numbers become the
 * same `text_units.v1` value `countTextUnits` would have returned from the text
 * itself — one definition of the unit, two ways in. `parse-page`'s counter and
 * this one are held to that by a test that drives both over a real corpus.
 */
export function textUnitsFromCounts(counts: {
  readonly cjkChars: number;
  readonly nonCjkWords: number;
}): TextUnits {
  const units = counts.cjkChars + counts.nonCjkWords;
  if (counts.cjkChars > 0 && counts.nonCjkWords > 0)
    return { units, basis: "mixed" };
  if (counts.cjkChars > 0) return { units, basis: "cjk_chars" };
  return { units, basis: "words" };
}

/** `cjkShare` for text that was counted elsewhere. Zero denominator reads 0. */
export function cjkShareFromCounts(counts: {
  readonly cjkChars: number;
  readonly denseChars: number;
}): number {
  return counts.denseChars === 0 ? 0 : counts.cjkChars / counts.denseChars;
}

/** Whether the string contains any code point counted as a CJK unit. */
export function hasCjk(text: string): boolean {
  return new RegExp(CJK_PATTERN.source, "u").test(text);
}

/** Drop every code point counted as a CJK unit, leaving the rest in place. */
export function withoutCjk(text: string): string {
  return text.replace(CJK_PATTERN, "");
}

/**
 * Share of non-whitespace code points that are CJK.
 *
 * Used to decide whether a whitespace-split word count is meaningful for a
 * page. Returns 0 for text with no countable characters, which keeps a blank
 * page out of the CJK branch.
 */
export function cjkShare(text: string): number {
  const dense = text.replace(/\s+/gu, "");
  // Code points, not UTF-16 units. One emoji is two units, so a code-unit
  // denominator reads a 43%-CJK page as 27% and publishes the word count this
  // share exists to withhold.
  const total = [...dense].length;
  if (total === 0) return 0;
  const matches = dense.match(CJK_PATTERN);
  return (matches === null ? 0 : matches.length) / total;
}
