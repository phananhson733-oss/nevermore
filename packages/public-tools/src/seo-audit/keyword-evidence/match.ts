// @input  -- a normalized query identity and one page field's text
// @output -- occurrence counts and URL coverage, by the query's own script
// @pos    -- the only matcher behind coverage states and density numerators
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { hasCjk, withoutCjk } from "./text-units.ts";
import { normalizeForMatch } from "./normalize.ts";

/**
 * Which matching branch a query takes.
 *
 * Chosen from the query's own characters, once, for every field it is compared
 * against. Deciding per field would let one query report coverage under two
 * different rules on the same page, and the reader has no way to see which
 * number came from which rule.
 */
export type QueryTokenization = "whitespace" | "cjk_chars" | "mixed";

/** Whether a field carried the query, or had no text to carry it at all. */
export type SlotState = "covered" | "not_covered" | "not_applicable";

export function tokenizationOf(identity: string): QueryTokenization {
  if (!hasCjk(identity)) return "whitespace";
  const remainder = withoutCjk(identity).replace(/\s+/gu, "");
  return remainder === "" ? "cjk_chars" : "mixed";
}

/**
 * Count non-overlapping occurrences of a token sequence.
 *
 * Token equality rather than substring containment, so "chart" does not count
 * itself inside "charter". Multi-token queries must appear adjacent and in
 * order. A match consumes its whole window before scanning resumes, so "a a"
 * is found twice in "a a a a" rather than three times.
 */
function countTokenSequence(
  tokens: readonly string[],
  sequence: readonly string[],
): number {
  if (sequence.length === 0 || tokens.length < sequence.length) return 0;

  let found = 0;
  let start = 0;
  const last = tokens.length - sequence.length;
  while (start <= last) {
    let matched = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (tokens[start + offset] !== sequence[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      found += 1;
      start += sequence.length;
    } else {
      start += 1;
    }
  }
  return found;
}

/**
 * Count non-overlapping occurrences of a literal substring.
 *
 * `indexOf` on plain strings, never a regular expression built from visitor
 * input: interpolating a query into a pattern would make `a.c` match `abc` and
 * would hand a stranger control of the matcher's running time.
 */
function countSubstring(haystack: string, needle: string): number {
  if (needle === "" || haystack === "") return 0;

  let found = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return found;
    found += 1;
    from = at + needle.length;
  }
}

/** Drop every whitespace character, for scripts that do not write word gaps. */
function dense(value: string): string {
  return value.replace(/\s+/gu, "");
}

/**
 * Count occurrences of a query inside one field's text.
 *
 * Latin-script queries are matched on token boundaries. Queries carrying CJK
 * are matched after whitespace is removed from both sides, so a heading that
 * breaks a compound across a space still counts. That is deliberately the
 * looser rule: a missed match reads as a missing keyword the visitor then
 * "fixes" on a page that already had it.
 */
export function countOccurrencesInText(
  identity: string,
  text: string,
  tokenization: QueryTokenization,
): number {
  const normalizedText = normalizeForMatch(text);
  if (identity === "" || normalizedText === "") return 0;

  if (tokenization === "whitespace") {
    return countTokenSequence(
      normalizedText.split(" ").filter(Boolean),
      identity.split(" ").filter(Boolean),
    );
  }
  return countSubstring(dense(normalizedText), dense(identity));
}

/**
 * Count occurrences across a list field, element by element.
 *
 * Never joins the elements first. Concatenating two headings would let a query
 * match an adjacency that exists only in our array, and report page structure
 * the visitor cannot find in their own markup.
 */
export function countOccurrencesInList(
  identity: string,
  texts: readonly string[],
  tokenization: QueryTokenization,
): number {
  let total = 0;
  for (const text of texts) {
    total += countOccurrencesInText(identity, text, tokenization);
  }
  return total;
}

/** Reduce to lowercase letters and digits, dropping every separator. */
function alphanumeric(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

/**
 * Whether the target URL carries the query.
 *
 * A URL is one whitespace token and writes its word gaps as hyphens, slashes
 * and dots, so the ordinary matcher answers "no" for every multi-word query
 * and for every slug. Comparing the letters and digits alone is the only way
 * this slot reports anything true: it is how an exact-match domain reads to a
 * person, and it is why occurrences are not counted here — the separators the
 * comparison drops carry no repetition worth reporting.
 */
export function urlCovered(identity: string, url: string): boolean {
  const needle = alphanumeric(identity);
  if (needle === "") return false;
  return alphanumeric(url).includes(needle);
}
