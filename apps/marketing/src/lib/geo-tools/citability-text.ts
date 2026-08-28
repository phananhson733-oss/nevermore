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

function stripNonContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
}

function collapse(value: string): string {
  return value.replace(/[\s\u00a0\u3000]+/gu, " ").trim();
}

/** Visible text as a client that does not run JavaScript would read it. */
export function extractCitabilityText(html: string): string {
  return collapse(
    decodeCommonEntities(
      stripNonContent(html)
        .replace(BLOCK_END, ". ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/** Same projection, with {@link LINK_MARKER} standing in for every anchor. */
export function extractCitabilityTextWithLinks(html: string): string {
  return collapse(
    decodeCommonEntities(
      stripNonContent(html)
        .replace(/<a\b[^>]*\shref\s*=/gi, ` ${LINK_MARKER} <a `)
        .replace(BLOCK_END, ". ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/** Total bytes of inline and referenced `<script>` elements on the page. */
export function scriptBytesOf(html: string): number {
  let bytes = 0;
  for (const match of html.matchAll(/<script[\s\S]*?<\/script>/gi)) {
    bytes += Buffer.byteLength(match[0], "utf8");
  }
  for (const match of html.matchAll(/<script\b[^>]*\/>/gi)) {
    bytes += Buffer.byteLength(match[0], "utf8");
  }
  return bytes;
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
export const MAX_QUESTION_TERMS = 8;

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

  for (const match of normalized.matchAll(CJK_RUN)) {
    const run = match[0];
    if (run.length < MIN_CJK_TERM_CHARS) continue;
    if (CJK_STOPWORDS.has(run)) continue;
    push(run);
  }
  for (const match of normalized.matchAll(LATIN_TOKEN)) {
    const token = match[0].replace(/^[.'-]+/, "").replace(/[.'-]+$/, "");
    if (token.length < MIN_LATIN_TERM_CHARS) continue;
    if (LATIN_STOPWORDS.has(token)) continue;
    push(token);
  }
  return terms.slice(0, MAX_QUESTION_TERMS);
}

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
