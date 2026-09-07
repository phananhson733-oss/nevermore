// @input  -- the run's primary and supporting keywords, plus one observed source string
// @output -- language-aware weighted match terms and a bounded relevance score
// @pos    -- shared by crawl-time segment selection and prompt-time sampling; no clock, network or model
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why one term builder.
 *
 * Two consumers rank observed text against the same keywords: the extractor
 * chooses which excerpts of a page survive its 12-segment ceiling, and the
 * prompt sampler chooses which retained excerpts survive the byte budget. A
 * second implementation drifts the moment one tokenizes CJK and the other
 * does not, and the two stages then disagree about what "relevant" means.
 *
 * The scorer is deliberately not a search engine. It separates three kinds of
 * evidence so one exact phrase cannot also vote as each of its own tokens:
 * the whole phrase is the strongest signal, a word token is weaker, and a CJK
 * bigram — which exists only because unsegmented scripts have no word
 * boundaries — is weakest. Each term votes at most once per field.
 */

/** Scripts written without spaces, where `\p{L}+` returns one long token. */
const UNSEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const UNSEGMENTED_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]+/gu;
const WORD = /[\p{L}\p{N}]+/gu;

/** Mirrors the prompt sampler's original list; function words carry no topic. */
const STOP: ReadonlySet<string> = new Set([
  "the", "and", "for", "are", "what", "does", "how", "why", "when", "which", "with",
  "from", "your", "that", "this", "have", "can", "you", "our", "was", "were", "its",
]);

export type TermWeight = 3 | 1 | 0.5;

export interface RelevanceTerm {
  /** Already NFKC-normalized and lower-cased; compare against text in the same form. */
  readonly value: string;
  readonly weight: TermWeight;
  /**
   * True when the term is one Latin word, which must match a whole word.
   *
   * Substring matching reads "cat" inside "education", and a page of
   * education prose then scores exactly as well as the one paragraph about
   * cats — and outranks it, because it is longer. A phrase carries its own
   * boundaries in its spaces, and an unsegmented script has none to carry, so
   * only this case needs the check.
   */
  readonly word: boolean;
}

function fold(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

/** Two-character windows over each unsegmented run; a one-character run is kept whole. */
function bigrams(value: string): string[] {
  const out: string[] = [];
  for (const run of value.match(UNSEGMENTED_RUN) ?? []) {
    const chars = [...run];
    if (chars.length === 1) {
      out.push(chars[0]!);
      continue;
    }
    for (let index = 0; index + 1 < chars.length; index += 1) {
      out.push(chars[index]! + chars[index + 1]!);
    }
  }
  return out;
}

/**
 * Build the weighted term set for one run's keywords.
 *
 * A term appears once, at its strongest weight: a phrase that is also a token
 * of another phrase stays a phrase. Terms are returned in descending weight so
 * a bounded consumer can truncate without losing the strongest signals.
 */
function isSingleLatinWord(value: string): boolean {
  return !UNSEGMENTED.test(value) && /^[\p{L}\p{N}]+$/u.test(value);
}

export function relevanceTerms(phrases: readonly string[]): readonly RelevanceTerm[] {
  const byValue = new Map<string, TermWeight>();
  const add = (raw: string, weight: TermWeight): void => {
    const value = fold(raw).trim();
    if (value === "") return;
    const existing = byValue.get(value);
    if (existing === undefined || weight > existing) byValue.set(value, weight);
  };
  for (const phrase of phrases) {
    const folded = fold(phrase).trim();
    if (folded === "") continue;
    add(folded, 3);
    for (const token of folded.match(WORD) ?? []) {
      // A single unsegmented run is not a word; it is the phrase again.
      if (UNSEGMENTED.test(token)) continue;
      if (token.length >= 3 && !STOP.has(token)) add(token, 1);
    }
    for (const gram of bigrams(folded)) add(gram, 0.5);
  }
  return [...byValue.entries()]
    .map(([value, weight]): RelevanceTerm => ({ value, weight, word: isSingleLatinWord(value) }))
    .sort((a, b) => b.weight - a.weight || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/**
 * Score one observed excerpt. A heading match counts double because a heading
 * states what its section is about; body text only shows the words occur.
 * Each term votes once per field, so repeating a keyword cannot inflate a
 * thin excerpt past a substantive one.
 */
export function relevanceScore(
  text: string,
  heading: string | null,
  terms: readonly RelevanceTerm[],
): number {
  const body = fold(text);
  const title = heading === null ? "" : fold(heading);
  const bodyWords = new Set(body.match(WORD) ?? []);
  const titleWords = new Set(title.match(WORD) ?? []);
  const found = (haystack: string, words: ReadonlySet<string>, term: RelevanceTerm): boolean =>
    term.word ? words.has(term.value) : haystack.includes(term.value);
  let score = 0;
  for (const term of terms) {
    if (title !== "" && found(title, titleWords, term)) score += term.weight * 2;
    if (found(body, bodyWords, term)) score += term.weight;
  }
  return score;
}
