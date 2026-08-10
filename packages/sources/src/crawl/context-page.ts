// @input  -- one fetched HTML document, its URL, and the page-value score of that URL
// @output -- the LLM-facing projection of that page: title, description, h1/h2/h3, bounded prose
// @pos    -- the per-page half of the context crawl; `context-profile.ts` owns the frontier
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why this file normalises HTML itself instead of reusing `parse-page.ts`.
 *
 * `parsePage` remains the authority for title, meta description and the link
 * frontier, and is used for exactly those below. It cannot supply the other two
 * things a context profile needs:
 *
 * - Heading LEVEL. `parsePage` returns one flat h1–h6 list. Level is how a
 *   reader — and the LLM downstream — tells a product claim from a footer link.
 * - An honestly-bounded body. Its paragraph projection is capped at 1,000
 *   characters per paragraph and its excerpt at 500, so building `text` from
 *   those would make `textTruncated` a lie: the string would already have been
 *   cut by a bound this file cannot see or report.
 *
 * `parse-page.ts` is pinned by the vendor manifest and exports none of its text
 * helpers, so it cannot grow the accessors that would avoid the duplication.
 */

import { parsePage, type ParsedPage } from "./parse-page.ts";
import { boundChars } from "./types.ts";

/**
 * Code-point bound on one page's extracted prose. Fourteen pages at this size
 * fit an LLM context window alongside the rest of the P0-5 prompt, and a
 * marketing page says what it sells long before this point.
 */
export const CONTEXT_PROFILE_MAX_TEXT_CHARS = 4_000;

export interface ContextProfileHeadings {
  readonly h1: readonly string[];
  readonly h2: readonly string[];
  readonly h3: readonly string[];
}

export interface ContextProfilePage {
  /** The URL actually fetched, after any redirect the safety layer admitted. */
  readonly url: string;
  /** Path component of `url`, which is what `score` was computed from. */
  readonly path: string;
  /** `pageValueScore` for `path`. Retained so the caller can weight the page. */
  readonly score: number;
  /** null when the document declares no `<title>`; never `""`. */
  readonly title: string | null;
  /** null when the document declares no meta description; never `""`. */
  readonly metaDescription: string | null;
  readonly headings: ContextProfileHeadings;
  /**
   * Normalised prose, bounded to `CONTEXT_PROFILE_MAX_TEXT_CHARS` code points.
   * null means no prose was extractable — an empty string would read as "this
   * page is blank", which is a claim this crawl cannot make.
   */
  readonly text: string | null;
  /** True only when `text` is a prefix of a longer extraction. */
  readonly textTruncated: boolean;
}

const HEADING_TAG = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;

/** Elements whose contents are code or graphics, never prose. */
const NOISE_ELEMENTS =
  /<\s*(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;

/**
 * Named entities worth decoding. The German set is here because German is a
 * first-class target market for this profile and `&uuml;` inside a product
 * heading would otherwise reach the LLM as literal markup.
 */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
};

const ENTITY = /&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi;

function decodeEntities(value: string): string {
  return value.replace(
    ENTITY,
    (match, numeric: string | undefined, named: string | undefined) => {
      if (numeric) {
        const code = numeric.toLowerCase().startsWith("x")
          ? Number.parseInt(numeric.slice(1), 16)
          : Number.parseInt(numeric, 10);
        const scalar =
          Number.isSafeInteger(code) &&
          code > 0 &&
          code <= 0x10ffff &&
          (code < 0xd800 || code > 0xdfff);
        return scalar ? String.fromCodePoint(code) : " ";
      }
      if (named === undefined) return match;
      // Case-sensitive first: `&Auml;` and `&auml;` are different characters.
      // An unrecognised name is left verbatim rather than dropped, so nothing
      // silently disappears from the text an operator may be reading.
      return HTML_ENTITIES[named] ?? HTML_ENTITIES[named.toLowerCase()] ?? match;
    },
  );
}

/** Markup to text. Tags become spaces so `a</b><b>b` cannot become one word. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** h1/h2/h3 kept apart, in document order, empty headings dropped. */
export function contextPageHeadings(html: string): ContextProfileHeadings {
  const h1: string[] = [];
  const h2: string[] = [];
  const h3: string[] = [];
  const byLevel: Readonly<Record<string, string[]>> = { 1: h1, 2: h2, 3: h3 };
  for (const match of html.matchAll(HEADING_TAG)) {
    const text = plainText(match[2] ?? "");
    if (text) byLevel[match[1] ?? ""]?.push(text);
  }
  return { h1, h2, h3 };
}

/** Prose from the raw response, so `truncated` describes this file's bound. */
export function contextPageProse(html: string): {
  readonly text: string | null;
  readonly truncated: boolean;
} {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1] ?? html;
  const prose = plainText(body.replace(NOISE_ELEMENTS, " "));
  if (!prose) return { text: null, truncated: false };
  const bounded = boundChars(prose, CONTEXT_PROFILE_MAX_TEXT_CHARS);
  return { text: bounded, truncated: bounded.length !== prose.length };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

/**
 * Project one fetched document. `parsed` is a parameter so the homepage — which
 * is both the first context page and the whole link frontier — is parsed once
 * rather than twice; it is the largest document in the crawl.
 */
export function contextProfilePage(
  url: string,
  html: string,
  score: number,
  parsed: ParsedPage = parsePage(html, url),
): ContextProfilePage {
  const prose = contextPageProse(html);
  return {
    url,
    path: pathOf(url),
    score,
    title: parsed.title,
    metaDescription: parsed.metaDescription,
    headings: contextPageHeadings(html),
    text: prose.text,
    textTruncated: prose.truncated,
  };
}
