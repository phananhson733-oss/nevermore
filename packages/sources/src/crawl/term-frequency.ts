/**
 * What a page repeats, counted in the units everything else is counted in.
 *
 * Built here rather than downstream because this is the only layer that still
 * holds the whole body text. The audit publishes 50 paragraphs capped at 1000
 * characters each, and counting there would give the leaderboard a different
 * denominator from the length and density figures printed beside it — one page,
 * two totals, no way for a reader to tell which is the real one.
 *
 * The unit is `text_units.v1`: a CJK code point counts one, and what remains of
 * a whitespace-separated chunk counts one. The stream below is that same
 * counting, kept in order so consecutive units can be read as phrases; a test
 * pins the two totals together over a real corpus.
 */

import { boundChars } from "./types.ts";

/** Rows kept per phrase length, and characters kept per phrase. */
export const TERM_TABLE_LIMITS = {
  rowsPerSize: 15,
  maxPhraseChars: 120,
  maxPhraseUnits: 5,
} as const;

export interface TermFrequencyRow {
  readonly phrase: string;
  readonly count: number;
}

export interface TermFrequencyTable {
  /** Phrase length in units: 1 through `maxPhraseUnits`. */
  readonly size: number;
  readonly rows: readonly TermFrequencyRow[];
}

interface Unit {
  /** Normalised text used for counting and display. Empty when unusable. */
  readonly text: string;
  readonly cjk: boolean;
}

const CJK_UNIT = /[㐀-鿿豈-﫿぀-ゟ゠-ヿ가-힯]/u;

/**
 * Words too common to rank, so the one-word table is about the page.
 *
 * Applied only where it changes what a reader learns: a one-unit table led by
 * "the" and "and" says nothing, while a three-word phrase containing "the" is
 * usually the phrase someone actually writes. Kept deliberately short and
 * closed — a long list starts deciding which real terms are uninteresting, and
 * an English page about "the North Face" has to keep its subject.
 *
 * A single Chinese function character is the same problem in the same place.
 */
const STOP_UNITS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "for", "from",
  "has", "have", "how", "i", "if", "in", "is", "it", "its", "of", "on", "or",
  "our", "so", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "to", "was", "we", "were", "what", "when", "which", "will", "with",
  "you", "your",
  "的", "了", "是", "在", "和", "也", "都", "就", "而", "与", "或", "及", "等",
  "被", "把", "从", "到", "对", "为", "以", "于", "并", "但", "个", "上", "中",
  "下", "不", "有", "会", "着", "过", "很", "更", "最", "你", "我", "他", "她",
  "它", "们", "这", "那", "其", "之", "地", "得",
]);

/** Strip the punctuation a word carries at either end, and lower-case it. */
function normaliseWord(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * The body as an ordered stream of `text_units.v1` units.
 *
 * A chunk mixing scripts — `SEO工具checker` — counts as its CJK characters plus
 * one unit for everything else in the chunk, which is exactly what the frozen
 * counter does when it removes the CJK code points and splits what is left. The
 * merged remainder takes the position of its first character, so a phrase read
 * off this stream is the phrase the page shows.
 */
export function unitStream(text: string): readonly Unit[] {
  const units: Unit[] = [];
  for (const chunk of text.split(/\s+/u)) {
    if (chunk === "") continue;
    let remainder = "";
    let remainderAt = -1;
    const pending: Unit[] = [];
    for (const char of chunk) {
      if (CJK_UNIT.test(char)) {
        pending.push({ text: char, cjk: true });
        continue;
      }
      if (remainderAt === -1) {
        remainderAt = pending.length;
        pending.push({ text: "", cjk: false });
      }
      remainder += char;
    }
    if (remainderAt !== -1) {
      pending[remainderAt] = { text: normaliseWord(remainder), cjk: false };
    }
    units.push(...pending);
  }
  return units;
}

/** Join units back into something a reader recognises. */
function phraseOf(window: readonly Unit[]): string {
  let phrase = "";
  for (const [index, unit] of window.entries()) {
    const previous = window[index - 1];
    const needsSpace =
      previous !== undefined && !previous.cjk && !unit.cjk && phrase !== "";
    phrase += needsSpace ? ` ${unit.text}` : unit.text;
  }
  return phrase;
}

/**
 * The top repeated phrases of every length from one unit to five.
 *
 * Densities are deliberately not computed here. The denominator is the body's
 * unit total, which is published once; deriving two percentages from it where
 * they are displayed keeps one number behind both.
 */
export function buildTermFrequencyTables(
  text: string,
): readonly TermFrequencyTable[] {
  const units = unitStream(text);
  const tables: TermFrequencyTable[] = [];

  for (let size = 1; size <= TERM_TABLE_LIMITS.maxPhraseUnits; size += 1) {
    const counts = new Map<string, number>();
    for (let start = 0; start + size <= units.length; start += 1) {
      const window = units.slice(start, start + size);
      // A window containing punctuation-only or empty text is not a phrase.
      if (window.some((unit) => unit.text === "")) continue;
      // One stop word is only uninteresting when it is the whole phrase.
      if (window.every((unit) => STOP_UNITS.has(unit.text))) continue;
      const phrase = boundChars(
        phraseOf(window),
        TERM_TABLE_LIMITS.maxPhraseChars,
      );
      if (phrase === "") continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }

    const rows = [...counts.entries()]
      // Count first, then the phrase itself, so two runs over one page produce
      // the same table rather than whichever order the map happened to hold.
      .sort(([leftPhrase, left], [rightPhrase, right]) =>
        right - left || (leftPhrase < rightPhrase ? -1 : 1),
      )
      .slice(0, TERM_TABLE_LIMITS.rowsPerSize)
      .map(([phrase, count]) => ({ phrase, count }));

    if (rows.length > 0) tables.push({ size, rows });
  }

  return tables;
}
