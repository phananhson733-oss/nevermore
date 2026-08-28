// @input  -- raw HTML exactly as a non-JavaScript client receives it, and an optional target question
// @output -- the text projections and derived question terms every citability rule reads
// @pos    -- the one place HTML becomes text for this tool; rules never touch markup directly

import type { CitabilityContext } from "./citability-contract.ts";

/**
 * Marker left where an anchor was.
 *
 * Stripping tags also strips `href`, which is how a "does this number cite a
 * source" rule ends up unable to see the citation link sitting right next to
 * the number. The marker keeps the fact that a link existed in the sentence
 * without keeping the URL in the text projection. It is spelled with letters
 * rather than a control byte on purpose: a control byte makes the file
 * invisible to grep and unreadable in a diff.
 */
export const LINK_MARKER = "@@LINK@@";

/** End of a block: a sentence boundary, so two list items are two claims. */
const BLOCK_END =
  /<\/(p|div|section|article|li|tr|h[1-6]|td|th|blockquote|figcaption|dd|dt)>/gi;

function decodeCommonEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) && point > 0 && point < 0x110000
        ? String.fromCodePoint(point)
        : " ";
    })
    .replace(/&amp;/gi, "&");
}

/**
 * Remove a paired element by scanning, not by matching `<tag>[\s\S]*?</tag>`.
 *
 * That pattern has to scan to the end of the document from every unclosed
 * opening tag, which is quadratic: 1.5 MB of `<script>` with no closing tag
 * was measured at 114 seconds, against a route budgeted for 60. A page can
 * contain whatever it likes, so the parser has to be the thing that does not
 * blow up.
 */
function stripPaired(html: string, tag: string): string {
  const open = `<${tag}`;
  const close = `</${tag}`;
  const lower = html.toLowerCase();
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = lower.indexOf(open, cursor);
    if (start < 0) break;
    const after = lower.charAt(start + open.length);
    // `<script` must not match `<scriptish`; a tag name ends at a space, a
    // slash or the closing bracket.
    if (after !== "" && !/[\s/>]/.test(after)) {
      out += html.slice(cursor, start + open.length);
      cursor = start + open.length;
      continue;
    }
    const end = lower.indexOf(close, start + open.length);
    out += `${html.slice(cursor, start)} `;
    if (end < 0) {
      // Unclosed: everything after the opening tag belongs to it, which is
      // also what a browser does.
      return out;
    }
    const tail = lower.indexOf(">", end);
    cursor = tail < 0 ? lower.length : tail + 1;
  }
  return out + html.slice(cursor);
}

/**
 * Markup with comments removed and everything else intact.
 *
 * Structured data lives inside `<script type="application/ld+json">`, so the
 * projection that strips scripts cannot be the one JSON-LD is read from - but
 * a block commented out during a migration still must not count as declared.
 */
export function uncommentedMarkup(html: string): string {
  return stripComments(html);
}

function stripComments(html: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = html.indexOf("<!--", cursor);
    if (start < 0) break;
    out += `${html.slice(cursor, start)} `;
    const end = html.indexOf("-->", start + 4);
    if (end < 0) return out;
    cursor = end + 3;
  }
  return out + html.slice(cursor);
}

/**
 * Markup with everything a crawler would not read as content removed.
 *
 * The markup rules read this rather than the raw HTML. Reading the raw HTML is
 * how a canonical link that was commented out during a migration wins over the
 * live one, and how a `<template>` full of example markup counts as the page's
 * own structure.
 */
export function contentMarkup(html: string): string {
  return ["script", "style", "template", "noscript"].reduce(
    (current, tag) => stripPaired(current, tag),
    stripComments(html),
  );
}

/** Content markup with the regions a reader skips removed as well. */
export function bodyMarkup(html: string): string {
  return ["nav", "footer", "aside"].reduce(
    (current, tag) => stripPaired(current, tag),
    contentMarkup(html),
  );
}

function collapse(value: string): string {
  return value.replace(/[\s\u00a0\u3000]+/gu, " ").trim();
}

/** Visible text as a client that does not run JavaScript would read it. */
export function extractCitabilityText(html: string): string {
  return collapse(
    decodeCommonEntities(
      bodyMarkup(html)
        .replace(BLOCK_END, ". ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/** Same projection, with {@link LINK_MARKER} standing in for every anchor. */
export function extractCitabilityTextWithLinks(html: string): string {
  return collapse(
    decodeCommonEntities(
      bodyMarkup(html)
        .replace(/<a\b[^>]*\shref\s*=/gi, ` ${LINK_MARKER} <a `)
        .replace(BLOCK_END, ". ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/**
 * Bytes the page spends on script.
 *
 * Measured as the difference the script strip makes, so an unclosed `<script>`
 * counts as script rather than turning its own source into the page's visible
 * copy - which is what let a truncated app shell report 1.5 million characters
 * of body text.
 */
export function scriptBytesOf(html: string): number {
  const withoutScript = stripPaired(stripComments(html), "script");
  return Math.max(
    0,
    Buffer.byteLength(html, "utf8") - Buffer.byteLength(withoutScript, "utf8"),
  );
}

/** Visible characters, whitespace and link markers excluded. */
export function visibleCharCount(text: string): number {
  return text.split(LINK_MARKER).join("").replace(/\s+/g, "").length;
}

/* ------------------------------------------------------------------ */
/* Question terms                                                      */
/* ------------------------------------------------------------------ */

/**
 * Words too common to prove that a page answered anything.
 *
 * Deliberately short: the list only has to remove the words that would make
 * every page match, not to be a linguistics-grade stop list.
 */
const LATIN_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "can", "do",
  "does", "for", "from", "how", "in", "is", "it", "me", "my", "of", "on", "or",
  "our", "should", "so", "than", "that", "the", "their", "then", "there",
  "these", "they", "this", "to", "up", "us", "was", "we", "what", "when",
  "where", "which", "who", "why", "will", "with", "you", "your",
]);

const CJK_STOPWORDS = new Set([
  "的", "了", "是", "在", "和", "与", "或", "吗", "呢", "怎么", "如何", "什么",
  "哪些", "哪个", "为什么", "可以", "能否", "是否", "我们", "你们", "他们",
  "一个", "这个", "那个", "还有", "以及", "对于", "关于", "推荐", "有没有",
]);

const LATIN_TOKEN = /[\p{Script=Latin}\p{Nd}][\p{Script=Latin}\p{Nd}'.-]*/gu;
const CJK_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const MIN_LATIN_TERM_CHARS = 3;
const MIN_CJK_TERM_CHARS = 2;
/** Enough to identify the question; more only makes the check easier to pass. */
export const MAX_QUESTION_TERMS = 16;

/**
 * Content words from the visitor's target question.
 *
 * The rule this feeds asks whether the opening of the page is about the thing
 * that was asked. It cannot be handed `requiredEntities` from a frozen prompt
 * set, because the public checker has no prompt set and no account: the
 * question typed into the form is the only input there is.
 */
export function deriveQuestionTerms(question: string | null): string[] {
  if (!question) return [];
  const normalized = question.normalize("NFC").toLowerCase();
  const terms: string[] = [];
  const seen = new Set<string>();

  const push = (value: string): void => {
    if (seen.has(value)) return;
    seen.add(value);
    terms.push(value);
  };

  // Chinese, Japanese and Korean are written without spaces, so a run is a
  // phrase rather than a word. Taking the whole run as one term meant a page
  // had to repeat the question character for character - "如何提高网站转化率"
  // did not match "如何提高网站的转化率" - so every Chinese page failed this
  // check. Overlapping bigrams give the same phrase several chances to be
  // recognised without a dictionary.
  for (const match of normalized.matchAll(CJK_RUN)) {
    const run = match[0];
    if (run.length < MIN_CJK_TERM_CHARS) continue;
    if (run.length === MIN_CJK_TERM_CHARS) {
      if (!CJK_STOPWORDS.has(run)) push(run);
      continue;
    }
    for (let index = 0; index + 2 <= run.length; index += 1) {
      const gram = run.slice(index, index + 2);
      if (CJK_STOPWORDS.has(gram)) continue;
      push(gram);
    }
  }
  for (const match of normalized.matchAll(LATIN_TOKEN)) {
    const token = match[0].replace(/^[.'-]+/, "").replace(/[.'-]+$/, "");
    if (token.length < MIN_LATIN_TERM_CHARS) continue;
    if (LATIN_STOPWORDS.has(token)) continue;
    push(token);
  }
  return terms.slice(0, MAX_QUESTION_TERMS);
}

/**
 * How much of the question the text actually covers.
 *
 * A fraction rather than "any term matched": one bigram out of nine is a
 * coincidence, and requiring all of them is the whole-run rule that failed
 * every Chinese page.
 */
export function questionCoverage(
  text: string,
  terms: readonly string[],
): { readonly matched: readonly string[]; readonly ratio: number } {
  if (terms.length === 0) return { matched: [], ratio: 0 };
  const matched = terms.filter((term) => containsTerm(text, term));
  return { matched, ratio: matched.length / terms.length };
}

/** Half the question's terms. Below it, the opening is about something else. */
export const QUESTION_COVERAGE_FLOOR = 0.5;

const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{Nd}]/u;

/**
 * Whether a term appears in a text, on a word boundary for Latin scripts.
 *
 * A bare `includes` is how "linear" matches "nonlinear" and "is" matches
 * "this" - both of which turn a check that should fail into one that passes.
 */
export function containsTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  const lower = haystack.toLowerCase();
  const needle = term.toLowerCase();
  if (!LATIN_OR_DIGIT.test(needle)) return lower.includes(needle);
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : lower.charAt(at - 1);
    const after = lower.charAt(at + needle.length);
    const boundaryBefore = before === "" || !LATIN_OR_DIGIT.test(before);
    const boundaryAfter = after === "" || !LATIN_OR_DIGIT.test(after);
    if (boundaryBefore && boundaryAfter) return true;
    from = at + 1;
  }
}

/**
 * Split into sentences for both CJK and Latin text.
 *
 * CJK punctuation ends a sentence with no trailing space, which is why a
 * splitter that requires whitespace treats an entire Chinese page as one
 * sentence - and then one "source" anywhere on the page vouches for every
 * number on it.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；])\s*|(?<=[.!?;])\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function buildCitabilityContext(
  rawHtml: string,
  targetQuestion: string | null,
): CitabilityContext {
  const text = extractCitabilityText(rawHtml);
  return {
    text,
    textWithLinkMarkers: extractCitabilityTextWithLinks(rawHtml),
    textChars: visibleCharCount(text),
    scriptBytes: scriptBytesOf(rawHtml),
    questionTerms: deriveQuestionTerms(targetQuestion),
  };
}
