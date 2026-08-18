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
  /**
   * True when this unit is the merged remainder of a chunk that also held CJK.
   *
   * `SEO工具checker` counts as three units, and the non-CJK half is one of them
   * — but that half is `SEOchecker`, two pieces of the source that are not next
   * to each other. Any phrase built across it is a phrase the page never shows,
   * so these are counted as vocabulary and kept out of every longer table.
   */
  readonly merged: boolean;
}

/**
 * Code points counted one unit each, as numbers rather than as characters.
 *
 * This runs per character, and a regex `test` per character measured as the
 * single largest cost in the whole parse. It is also the safer spelling: the
 * character-class form was copied here carrying U+8C48 in place of U+F900 —
 * identical on screen, twenty-seven thousand code points apart — which silently
 * classified Yi, private-use and Latin Extended-D as CJK. A test walks every
 * code point in the range and compares this against the frozen counter in
 * `@sf/public-tools`, which is the definition it has to match.
 */
export function isCjkUnit(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

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

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const ALPHANUMERIC_EDGES = /^[\p{L}\p{N}][\s\S]*[\p{L}\p{N}]$|^[\p{L}\p{N}]$/u;

/**
 * Strip the punctuation a word carries at either end, and lower-case it.
 *
 * The edge test runs first because most words have no punctuation to strip and
 * the replace is the expensive half.
 */
function normaliseWord(value: string): string {
  const lowered = value.toLocaleLowerCase("en-US");
  return ALPHANUMERIC_EDGES.test(lowered)
    ? lowered
    : lowered.replace(EDGE_PUNCTUATION, "");
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
    let sawCjk = false;
    const pending: Unit[] = [];
    for (const char of chunk) {
      if (isCjkUnit(char.codePointAt(0) ?? 0)) {
        sawCjk = true;
        pending.push({ text: char, cjk: true, merged: false });
        continue;
      }
      if (remainderAt === -1) {
        remainderAt = pending.length;
        pending.push({ text: "", cjk: false, merged: false });
      }
      remainder += char;
    }
    if (remainderAt !== -1) {
      pending[remainderAt] = {
        text: normaliseWord(remainder),
        cjk: false,
        merged: sawCjk,
      };
    }
    units.push(...pending);
  }
  return units;
}

/**
 * The top repeated phrases of every length from one unit to five.
 *
 * One pass over the stream, extending each phrase in place rather than slicing
 * a window per length. The sliced version measured 7.3 ms on a 50 KB body — 85%
 * of the whole parse — and this runs for every page a crawl collects while only
 * the submitted page's table is ever read. Under a millisecond is the
 * difference between a second of CPU across a large crawl and eight.
 *
 * Densities are deliberately not computed here. The denominator is the body's
 * unit total, which is published once; deriving both percentages where they are
 * displayed keeps one number behind them.
 */
export function buildTermFrequencyTables(
  text: string,
): readonly TermFrequencyTable[] {
  const units = unitStream(text);
  const usable = units.map((unit) => unit.text !== "");
  const stop = units.map((unit) => STOP_UNITS.has(unit.text));
  const counts = Array.from(
    { length: TERM_TABLE_LIMITS.maxPhraseUnits },
    () => new Map<string, number>(),
  );

  for (let start = 0; start < units.length; start += 1) {
    if (!usable[start]) continue;
    let phrase = "";
    let allStop = true;
    let hasMerged = false;
    for (let size = 1; size <= TERM_TABLE_LIMITS.maxPhraseUnits; size += 1) {
      const at = start + size - 1;
      const unit = units[at];
      // An unusable unit ends every longer phrase from this start too: there is
      // no phrase that reads across a run of punctuation.
      if (unit === undefined || !usable[at]) break;
      // A merged remainder is two pieces of the source that are not adjacent,
      // so a phrase reading across one is a phrase the page never shows. It
      // counts as vocabulary at size one and ends every longer phrase that
      // would touch it — whether it starts the window or lands inside it.
      hasMerged = hasMerged || unit.merged;
      if (hasMerged && size > 1) break;
      const previous = units[at - 1];
      phrase +=
        size === 1 || unit.cjk || (previous !== undefined && previous.cjk)
          ? unit.text
          : ` ${unit.text}`;
      allStop = allStop && stop[at] === true;
      // One stop word is only uninteresting when it is the whole phrase.
      if (allStop) continue;
      if (phrase.length > TERM_TABLE_LIMITS.maxPhraseChars) break;
      const table = counts[size - 1];
      if (table !== undefined) table.set(phrase, (table.get(phrase) ?? 0) + 1);
    }
  }

  const tables: TermFrequencyTable[] = [];
  for (const [index, table] of counts.entries()) {
    const rows = [...table.entries()]
      // Count first, then the phrase itself, so two runs over one page produce
      // the same table rather than whichever order the map happened to hold.
      .sort(([leftPhrase, left], [rightPhrase, right]) =>
        right - left || (leftPhrase < rightPhrase ? -1 : 1),
      )
      .slice(0, TERM_TABLE_LIMITS.rowsPerSize)
      .map(([phrase, count]) => ({ phrase, count }));
    if (rows.length > 0) tables.push({ size: index + 1, rows });
  }
  return tables;
}
