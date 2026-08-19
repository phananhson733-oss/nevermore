/**
 * Regex HTML extraction for the crawl adapter (spec §7.3). Vendor-copied and
 * reshaped from the old `packages/crawler/src/page.ts` + `extract.ts`
 * (commit 72af9300…): NO cheerio, Node stdlib + regex only. The old repo's
 * `@signalframe/core` types and `inferPageRole` are intentionally dropped — the
 * engine infers page role later, so parse-page records raw facts only.
 *
 * Produces the CONTENT-derived subset of `CrawlPageProjection`; the engine
 * (`engine.ts`) supplies the HTTP-level fields (status, redirectChain,
 * contentType, responseMs, sitemapMember). Every link target is canonicalized
 * with `canonicalizeUrl` and filtered to the page's own origin.
 */

import { canonicalizeUrl } from "../canonical-url.ts";
import type {
  CrawlJsonLdProjection,
  CrawlLinkProjection,
} from "../observations.ts";
import {
  buildTermFrequencyTables,
  type TermFrequencyTable,
} from "./term-frequency.ts";
import { boundChars, CRAWL_PROJECTION_LIMITS } from "./types.ts";
import {
  parseHtmlLanguageDeclaration,
  type HtmlLanguageDeclaration,
} from "./site-language.ts";

/** Code-point-safe projection bound; see `boundChars` for why it must be. */
function truncate(value: string, maxChars: number): string {
  return boundChars(value, maxChars);
}

/**
 * Exact transport identity discovered in HTML. This is intentionally kept out
 * of `crawl.page.v1`; persisted link facts continue to use aggregation
 * `subjectUrl`s while the frontier uses this fetch URL verbatim.
 */
export interface CrawlFetchTarget {
  readonly fetchUrl: string;
  readonly subjectUrl: string;
}

/** The content-derived fields of `CrawlPageProjection` (HTTP fields added by the engine). */
export interface ParsedPage {
  /** Ephemeral `<html lang>` evidence; never copied into crawl.page.v1. */
  readonly htmlLanguage: HtmlLanguageDeclaration | null;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly canonicalTarget: string | null;
  /** Directives from the meta robots tag only (engine merges X-Robots-Tag). */
  readonly robotsDirectives: readonly string[];
  readonly robotsIndexable: boolean;
  readonly h1: readonly string[];
  readonly headings: readonly string[];
  readonly wordCount: number;
  readonly internalOutlinks: readonly CrawlLinkProjection[];
  /** Ephemeral frontier inputs; never copied into `crawl.page.v1`. */
  readonly internalFetchTargets: readonly CrawlFetchTarget[];
  /** Exact canonical-link fetch target paired with persisted `canonicalTarget`. */
  readonly canonicalFetchTarget: CrawlFetchTarget | null;
  readonly jsonLd: CrawlJsonLdProjection;
  readonly paragraphs: readonly string[];
  readonly bodyExcerpt: string | null;
  /**
   * On-page facts beyond `crawl.page.v1`.
   *
   * Deliberately outside `CrawlPageProjection`: that projection *is* the frozen
   * `crawl.page.v1` metric, persisted in the product's normalized_observations
   * and pinned by both the generated OpenAPI types and the growth-map Zod
   * schema. Widening it to carry facts only the public On-Page Checker reads
   * would be a product-side contract change with a migration behind it. These
   * ride beside the projection, the way `htmlLanguage` and
   * `internalFetchTargets` already do.
   */
  readonly onPage: ParsedOnPageFacts;
}

/** Sharing-card meta, as declared. Absent stays null; it is not a default. */
export interface ParsedOpenGraph {
  readonly title: string | null;
  readonly description: string | null;
  readonly image: string | null;
}

/**
 * Image alt coverage.
 *
 * `withEmptyAlt` is counted apart from `withoutAlt` on purpose: `alt=""` is how
 * a decorative image is correctly declared, and folding the two together would
 * report a page that did the right thing as having a defect.
 */
export interface ParsedImageFacts {
  readonly total: number;
  readonly withAlt: number;
  readonly withEmptyAlt: number;
  readonly withoutAlt: number;
  /** Both `width` and `height` declared, which is what reserves the box. */
  readonly withDimensions: number;
  readonly lazyLoaded: number;
}

/**
 * Outbound links leaving this site, counted by destination.
 *
 * Deduplicated by canonical target the way `internalOutlinks` already is. They
 * used to be counted per `<a>`, so one partner linked from the nav, the body
 * and the footer was published as "3 external links" on the same screen as an
 * internal figure that would have called it 1. Two conventions for one idea.
 *
 * The two qualifiers resolve a repeated target in the direction that keeps the
 * statement true: a destination reachable through even one followed link is not
 * nofollowed, and a destination opened unsafely even once is a real handle
 * handed over.
 */
export interface ParsedExternalLinkFacts {
  /** Distinct destinations, not anchor elements. */
  readonly total: number;
  /** Destinations whose every occurrence carried `rel=nofollow`. */
  readonly nofollow: number;
  /** Destinations opened by at least one `target=_blank` without noopener. */
  readonly blankWithoutNoopener: number;
}

/**
 * Whether the page can act on a visitor's intent, or only send them onward.
 *
 * Structural counts only. A component mounted by client JavaScript is not in
 * the transferred HTML and cannot be counted here, which is a limitation the
 * report has to state rather than a fact it can assert — so these feed an
 * observation about what the static document offers, never a verdict that the
 * page offers nothing.
 */
export interface ParsedInteractiveFacts {
  readonly forms: number;
  readonly inputs: number;
  readonly buttons: number;
  readonly selects: number;
  readonly textareas: number;
  readonly canvases: number;
  readonly media: number;
  readonly iframes: number;
}

/**
 * Body text measured in the units every downstream density and length uses.
 *
 * Measured over the whole static body, not a sample. The share of CJK used to
 * be decided from the 500-character excerpt and then applied to the full-body
 * word count: a page opening in English and continuing in Chinese passed the
 * threshold and published a word count wrong by two orders of magnitude, which
 * the score then read as a thin page. Counting the whole body removes the
 * sample, and publishing the counts rather than the text keeps the payload the
 * size it was.
 */
export interface ParsedTextMetrics {
  /** Code points counted one unit each because they carry no word gaps. */
  readonly cjkChars: number;
  /** Whitespace-separated runs remaining once those code points are removed. */
  readonly nonCjkWords: number;
  /** Non-whitespace code points, the denominator of the CJK share. */
  readonly denseChars: number;
}

export interface ParsedOnPageFacts {
  /** The `<html lang>` attribute exactly as declared, unvalidated. */
  readonly lang: string | null;
  readonly openGraph: ParsedOpenGraph;
  readonly twitterCard: string | null;
  readonly viewport: string | null;
  readonly charset: string | null;
  readonly faviconDeclared: boolean;
  readonly hreflang: readonly string[];
  /**
   * The `hreflang` alternates as declared: language and target together.
   *
   * `hreflang` above keeps only the language codes, which answers "what does
   * this page claim" but not "does the claim resolve" — and the checks that
   * matter are about the target. Cross-origin targets are kept: an
   * international cluster routinely points at another domain, and dropping
   * those would report a correct cluster as incomplete.
   */
  readonly hreflangAlternates: readonly {
    readonly lang: string;
    readonly href: string;
  }[];
  /**
   * The alternates list was cut short by its cap.
   *
   * D6 and 1.7 publish "100% valid targets", which is a claim about all of
   * them. A page declaring more alternates than one crawl keeps has not been
   * fully read, and a clean verdict over the prefix is not the same sentence.
   */
  readonly hreflangAlternatesTruncated: boolean;
  readonly images: ParsedImageFacts;
  /**
   * The file extension of each image reference, in document order.
   *
   * Only the extension: resolving the reference would turn a broken or
   * templated `src` into a URL that looks measured, and the only question
   * asked of it is which format was served. An unreadable reference — a data
   * URI, an extensionless CDN path — contributes nothing rather than counting
   * as an old format.
   */
  readonly imageFormats: readonly string[];
  /**
   * Heading levels in document order, collected independently of the text.
   *
   * `headings` keeps only headings that have text and a closing tag. Both are
   * right for a list of strings and wrong for a level sequence: an icon-only
   * `<h2>` still occupies a level, and dropping it invents a skip from h1 to h3
   * that the document does not contain.
   */
  readonly headingLevels: readonly number[];
  /**
   * Resources in `<head>` that block the first paint.
   *
   * A stylesheet without a non-screen `media`, and a `<script src>` carrying
   * neither `async` nor `defer`. Both stop the parser where they sit, which is
   * what "render-blocking" means — it is a property of the markup, readable
   * without running anything.
   */
  readonly renderBlocking: {
    readonly stylesheets: number;
    readonly scripts: number;
  };
  /**
   * The first image in document order, and what it declares about itself.
   *
   * Null when the page carries no image. Document order stands in for "the one
   * the reader sees first" — a static crawl has no viewport, so it cannot know
   * the fold. The declared size travels with it because the first image is very
   * often a 32-pixel logo mark, and lazy-loading one of those is harmless: a
   * check that fires on it is noise, which is worse than a check that misses.
   */
  readonly firstImage: {
    readonly lazyLoaded: boolean;
    /** Declared width and height, or null when the markup states neither. */
    readonly width: number | null;
    readonly height: number | null;
  } | null;
  /**
   * Words of body text under each H3, in document order.
   *
   * Segmented at heading boundaries: everything after one H3 and before the
   * next heading of any level belongs to that H3. Empty when the page has no
   * H3, which is a different fact from every H3 being empty.
   */
  readonly wordsUnderEachH3: readonly number[];
  /**
   * Property keys declared by each JSON-LD node, keyed by its `@type`.
   *
   * Keys only, never values: the question is whether a type carries the
   * properties it needs, and the values are the site's content.
   */
  readonly jsonLdProperties: readonly {
    readonly type: string;
    readonly keys: readonly string[];
  }[];
  /**
   * The `name` of each `Question` node this page declares.
   *
   * A FAQPage promises the reader will find these on the page. Without the
   * text there is nothing to compare the promise against, so this is the one
   * JSON-LD value collected rather than only its key.
   */
  readonly faqQuestions: readonly string[];
  /** Absolute, de-duplicated `src` of each `<img>`, in document order. */
  readonly imageSources: readonly string[];
  /** The page declares `rel="next"` or `rel="prev"`: it is one of a series. */
  readonly partOfASequence: boolean;
  readonly externalLinks: ParsedExternalLinkFacts;
  /**
   * UTF-8 byte counts, not character counts.
   *
   * A page written in CJK carries roughly three bytes per character, so a
   * character count would report a third of the transferred size — and every
   * text-to-code ratio derived from it.
   */
  readonly htmlBytes: number;
  readonly visibleTextBytes: number;
  /**
   * UTF-8 bytes inside `<script>` elements, inline bundles and data included.
   *
   * Paired with `visibleTextBytes` this separates a document that ships its
   * content from one that ships a program that will fetch it.
   */
  readonly scriptBytes: number;
  readonly interactive: ParsedInteractiveFacts;
  readonly textMetrics: ParsedTextMetrics;
  /**
   * What the page repeats, one table per phrase length from one unit to five.
   *
   * Counted over the same whole body `textMetrics` measures, so the leaderboard
   * and the length figure printed beside it share a denominator.
   */
  readonly termFrequencies: readonly TermFrequencyTable[];
}

// ---------------------------------------------------------------------------
// Low-level regex helpers (vendor-copied from page.ts / extract.ts).
// ---------------------------------------------------------------------------

/**
 * Match one element's opening tag without stopping at a `>` inside a value.
 *
 * `[^>]*` ends the tag at the first `>` in the source, and `>` is ordinary
 * text inside an attribute value: `<img src="a.png" title="a > b" alt="Real">`
 * was cut before `alt` and published as an image carrying no alt text. Quoted
 * runs are consumed whole here, so only a `>` outside quotes closes the tag.
 */
function openingTagPattern(name: string, flags: string): RegExp {
  return new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, flags);
}

/** The same tolerance for an element read together with its content. */
function elementPattern(name: string, flags: string): RegExp {
  return new RegExp(
    `<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\\s\\S]*?)<\\/${name}\\s*>`,
    flags,
  );
}

/**
 * Read one attribute off a tag.
 *
 * Walks the tag attribute by attribute instead of searching it for a name,
 * because a name can appear inside another attribute's *value* and a search
 * cannot tell the two apart. Both shapes were measured returning confident
 * wrong answers:
 *
 * - `<img src="…/pic.jpg?alt=media&token=…">` — the standard Firebase Storage
 *   image URL — was read as an image carrying alt text, flipping "1 of 1
 *   images carry no alt" into "all 1 images carry alt".
 * - `<meta name="description" content="How to declare charset=utf-8">` was read
 *   as the page declaring an encoding it never declares.
 *
 * A `\b` boundary made it worse still: `\balt` matches `data-alt`, so every
 * `data-*` mirror was read as the real attribute.
 *
 * Quoted values are consumed whole, so nothing inside them is ever scanned for
 * attribute names. A valueless attribute yields `""`, not null: it is present.
 */
const ATTRIBUTE_PATTERN =
  /([-a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attr(tag: string | undefined, name: string): string | null {
  if (!tag) return null;
  const wanted = name.toLowerCase();
  // Drop `<tagname` so the element's own name is never read as an attribute.
  const body = tag.replace(/^<\s*[a-zA-Z][^\s/>]*/, "");
  const pattern = new RegExp(ATTRIBUTE_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match[0] === "") {
      pattern.lastIndex += 1;
      continue;
    }
    if (match[1]?.toLowerCase() !== wanted) continue;
    return match[2] ?? match[3] ?? match[4] ?? "";
  }
  return null;
}

function firstTag(html: string, pattern: RegExp): string | undefined {
  return html.match(pattern)?.[0];
}

/**
 * Elements whose contents are markup-shaped but are not markup on the page.
 *
 * An inline template, a `document.write` string, or a JSON bundle carrying HTML
 * is a `<img>` to a regex and nothing at all to a reader. Counting those was
 * measured reporting images and links a browser never renders. Removed once,
 * before any structural collector runs; JSON-LD and byte sizes read the
 * document before this step because they are about exactly what was shipped.
 */
const NON_RENDERED_ELEMENT =
  /<\s*(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;

/**
 * `noscript` is in that list because its contents are exactly what a reader
 * with scripting enabled never sees — which is every browser that renders the
 * pages this crawls. The Facebook Pixel ships an alt-less tracking image inside
 * one, and it is on a large share of commercial sites, so counting it failed
 * the alt checks on pages whose only visible image is correctly labelled.
 */
function withoutNonRenderedElements(html: string): string {
  return html.replace(NON_RENDERED_ELEMENT, " ");
}

/**
 * The named references this parser resolves, plus numeric ones.
 *
 * `&apos;` is here because HTML5 defines it and every browser resolves it: a
 * path written `/o&apos;neill` in a link has to reach the same subject URL as
 * the same path declared in a sitemap.
 */
const HTML_NAMED: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * One pass, not a chain of replaces.
 *
 * A chain decodes its own output: `&amp;lt;` became `&lt;` after the ampersand
 * step and then `<` after the less-than step, handing back a character the
 * document never wrote. That is wrong on its own terms, and it also split URLs
 * in two. The sitemap parser decodes in a single scan, so the same escape in a
 * href and in a `<loc>` canonicalized to different subject URLs and the
 * sitemap copy looked like a page nothing links to.
 *
 * A single scan cannot revisit what it has already written.
 */
const HTML_ENTITY =
  /&(?:#(-?(?:x[0-9a-f]+|\d+))|(nbsp|amp|lt|gt|quot|apos));/gi;

function decodeHtml(value: string): string {
  return value.replace(
    HTML_ENTITY,
    (match: string, numeric?: string, name?: string): string => {
      if (name) return HTML_NAMED[name.toLowerCase()] ?? match;
      if (!numeric) return match;

      const isHex = numeric.toLowerCase().startsWith("x");
      const number = isHex
        ? Number.parseInt(numeric.slice(1), 16)
        : Number.parseInt(numeric, 10);
      const validScalar =
        Number.isSafeInteger(number) &&
        number > 0 &&
        number <= 0x10ffff &&
        (number < 0xd800 || number > 0xdfff);
      return validScalar ? String.fromCodePoint(number) : "\ufffd";
    },
  );
}

/**
 * Extract stable visible body text: remove chrome/executable content, strip
 * remaining tags, decode common entities, collapse whitespace. Conservative and
 * dependency-free (vendor-copied from extract.ts, minus the SHA hash).
 */
function extractNormalisedBody(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? html;
  const withoutNonContent = body
    .replace(
      /<\s*(script|style|noscript|template|svg|canvas|iframe|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,
      " ",
    )
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(withoutNonContent)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalisedAttributeText(
  value: string | null,
  maxChars: number,
): string | null {
  const text = extractNormalisedBody(value ?? "");
  return text ? truncate(text, maxChars) : null;
}

function tagText(html: string, name: string, maxChars: number): string | null {
  const found = html.match(
    new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, "i"),
  )?.[1];
  if (found === undefined) return null;
  const text = extractNormalisedBody(found);
  return text ? truncate(text, maxChars) : null;
}

// ---------------------------------------------------------------------------
// Structured extraction.
// ---------------------------------------------------------------------------

function collectH1(html: string): readonly string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)) {
    const text = extractNormalisedBody(match[1] ?? "");
    if (text) out.push(truncate(text, CRAWL_PROJECTION_LIMITS.maxH1Chars));
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxH1) break;
  }
  return out;
}

function collectHeadings(html: string): readonly string[] {
  const out: string[] = [];
  for (const match of html.matchAll(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
  )) {
    const text = extractNormalisedBody(match[2] ?? "");
    if (text) out.push(truncate(text, CRAWL_PROJECTION_LIMITS.maxHeadingChars));
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxHeadings) break;
  }
  return out;
}

function collectParagraphs(html: string): readonly string[] {
  const out: string[] = [];
  for (const match of html.matchAll(
    /<(?:p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)\s*>/gi,
  )) {
    const text = extractNormalisedBody(match[1] ?? "");
    if (text)
      out.push(truncate(text, CRAWL_PROJECTION_LIMITS.maxParagraphChars));
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxParagraphs) break;
  }
  return out;
}

function declaredTypes(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  return [];
}

function collectTypes(value: unknown, types: Set<string>): void {
  const pending: unknown[] = [value];
  let visited = 0;
  while (
    pending.length > 0 &&
    visited < CRAWL_PROJECTION_LIMITS.maxJsonLdNodes &&
    types.size < CRAWL_PROJECTION_LIMITS.maxJsonLdTypes
  ) {
    const current = pending.pop();
    visited += 1;
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    if (!current || typeof current !== "object") continue;
    const object = current as Record<string, unknown>;
    for (const type of declaredTypes(object["@type"])) {
      if (types.size >= CRAWL_PROJECTION_LIMITS.maxJsonLdTypes) break;
      const bounded = truncate(
        type.trim(),
        CRAWL_PROJECTION_LIMITS.maxJsonLdTypeChars,
      );
      if (bounded) types.add(bounded);
    }
    const entries = Object.entries(object);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!entry) continue;
      const [key, nested] = entry;
      if (key !== "@type" && key !== "@context") pending.push(nested);
    }
  }
}

/**
 * Property keys per JSON-LD node, keyed by its `@type`.
 *
 * Keys only. The question these feed is whether a declared type carries the
 * properties it needs; the values are the site's content and none of our
 * business. Nested nodes are walked so a `Product` inside a `@graph` counts.
 */
function collectJsonLdProperties(html: string): {
  readonly properties: readonly {
    readonly type: string;
    readonly keys: readonly string[];
  }[];
  readonly faqQuestions: readonly string[];
} {
  const out: { type: string; keys: string[] }[] = [];
  const questions: string[] = [];
  const blocks = html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  let blockCount = 0;
  for (const block of blocks) {
    if (++blockCount > CRAWL_PROJECTION_LIMITS.maxJsonLdBlocks) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeHtml(block[1] ?? ""));
    } catch {
      continue;
    }
    // Iterative, like the type walk beside it: a hostile document must not be
    // able to recurse this parser off its stack.
    const queue: unknown[] = [parsed];
    let visited = 0;
    while (queue.length > 0 && visited < CRAWL_PROJECTION_LIMITS.maxJsonLdNodes) {
      const node = queue.shift();
      visited += 1;
      if (Array.isArray(node)) {
        queue.push(...node);
        continue;
      }
      if (typeof node !== "object" || node === null) continue;
      const record = node as Record<string, unknown>;
      for (const value of Object.values(record)) {
        if (typeof value === "object" && value !== null) queue.push(value);
      }
      const declared = record["@type"];
      const types = Array.isArray(declared) ? declared : [declared];
      // The one place a value is read rather than a key. A FAQPage makes a
      // claim about what the reader will see, and the only way to check that
      // claim is to hold the question it promises.
      if (
        types.some(
          (type) =>
            typeof type === "string" && type.trim().toLowerCase() === "question",
        )
      ) {
        const name = record["name"];
        if (
          typeof name === "string" &&
          name.trim() !== "" &&
          questions.length < CRAWL_PROJECTION_LIMITS.maxFaqQuestions
        ) {
          questions.push(
            truncate(name.trim(), CRAWL_PROJECTION_LIMITS.maxFaqQuestionChars),
          );
        }
      }
      for (const type of types) {
        if (typeof type !== "string" || type.trim() === "") continue;
        if (out.length >= CRAWL_PROJECTION_LIMITS.maxJsonLdTypes) break;
        out.push({
          type: truncate(type.trim(), CRAWL_PROJECTION_LIMITS.maxJsonLdTypeChars),
          keys: Object.keys(record)
            .filter((key) => !key.startsWith("@"))
            .slice(0, CRAWL_PROJECTION_LIMITS.maxJsonLdTypes),
        });
      }
    }
  }
  return { properties: out, faqQuestions: questions };
}

function collectJsonLd(html: string): CrawlJsonLdProjection {
  const types = new Set<string>();
  let errorCount = 0;
  const blocks = html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  let blockCount = 0;
  for (const block of blocks) {
    if (blockCount >= CRAWL_PROJECTION_LIMITS.maxJsonLdBlocks) break;
    blockCount += 1;
    try {
      collectTypes(JSON.parse(block[1] ?? ""), types);
    } catch {
      errorCount += 1;
    }
  }
  return { types: [...types].sort(), errorCount };
}

function anchorAccessibleName(
  openingTag: string,
  content: string,
): string | null {
  const ariaLabel = normalisedAttributeText(
    attr(openingTag, "aria-label"),
    CRAWL_PROJECTION_LIMITS.maxAnchorTextChars,
  );
  if (ariaLabel) return ariaLabel;
  const visibleText = extractNormalisedBody(content);
  if (visibleText)
    return truncate(visibleText, CRAWL_PROJECTION_LIMITS.maxAnchorTextChars);
  for (const image of content.matchAll(/<img\b[^>]*>/gi)) {
    const alt = normalisedAttributeText(
      attr(image[0], "alt"),
      CRAWL_PROJECTION_LIMITS.maxAnchorTextChars,
    );
    if (alt) return alt;
  }
  return null;
}

/**
 * Known gap: this collector is not quote-aware and the external one is.
 *
 * `<a title="1 > 0" href="/pricing">` ends at the `>` inside `title`, so `href`
 * is never read and `/pricing` is missing from both the link graph and the
 * crawl frontier. `collectExternalLinkFacts` reads the same anchor correctly,
 * so the two disagree about one tag.
 *
 * Left as it is on purpose. `internalOutlinks` IS the frozen `crawl.page.v1`
 * metric the product persists, and recovering links it has been dropping
 * changes stored values under an unchanged metric key — the same reason
 * `<base href>` is not honoured above. Fixing it means bumping the metric and
 * migrating, not editing a regex.
 */
function collectInternalOutlinks(
  html: string,
  pageUrl: string,
  pageOrigin: string,
): {
  readonly projections: readonly CrawlLinkProjection[];
  readonly fetchTargets: readonly CrawlFetchTarget[];
} {
  const byTarget = new Map<string, CrawlLinkProjection>();
  const fetchTargetsBySubject = new Map<
    string,
    Map<string, CrawlFetchTarget>
  >();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const openingTag = `<a${match[1] ?? ""}>`;
    // HTML parsers expose decoded attribute values. This dependency-free
    // extractor has to do that step explicitly before URL canonicalisation;
    // otherwise the standard `&amp;` query separator becomes a literal
    // `amp;` parameter name in the crawl graph.
    const href = attr(openingTag, "href");
    if (!href) continue;
    const pair = canonicalizeUrl(decodeHtml(href), pageUrl);
    if (!pair) continue;
    let targetOrigin: string;
    try {
      targetOrigin = new URL(pair.subjectUrl).origin;
    } catch {
      continue;
    }
    if (targetOrigin !== pageOrigin) continue;
    if (
      pair.subjectUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars ||
      pair.fetchUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars
    )
      continue;
    if (!byTarget.has(pair.subjectUrl)) {
      // Once the bounded subject projection is full, keep scanning the
      // document for an additional exact fetch variant of an already admitted
      // subject. Breaking here would drop `/last/` when `/last` is the 500th
      // subject even though both belong to the same bounded subject fact.
      if (byTarget.size >= CRAWL_PROJECTION_LIMITS.maxInternalOutlinks) {
        continue;
      }
      const rel = attr(openingTag, "rel")?.trim();
      byTarget.set(pair.subjectUrl, {
        targetSubjectUrl: pair.subjectUrl,
        rel: rel ? truncate(rel, CRAWL_PROJECTION_LIMITS.maxRelChars) : null,
        anchorText: anchorAccessibleName(openingTag, match[2] ?? ""),
      });
    }
    const subjectTargets =
      fetchTargetsBySubject.get(pair.subjectUrl) ??
      new Map<string, CrawlFetchTarget>();
    // canonical_url.v1 can expose at most slash and non-slash fetch variants
    // for one subject. Cap per subject, not globally: duplicate forms must not
    // starve another admitted link subject from having any frontier identity.
    if (!subjectTargets.has(pair.fetchUrl) && subjectTargets.size < 2) {
      subjectTargets.set(pair.fetchUrl, {
        fetchUrl: pair.fetchUrl,
        subjectUrl: pair.subjectUrl,
      });
      fetchTargetsBySubject.set(pair.subjectUrl, subjectTargets);
    }
  }
  return {
    projections: [...byTarget.values()].sort((left, right) =>
      left.targetSubjectUrl < right.targetSubjectUrl
        ? -1
        : left.targetSubjectUrl > right.targetSubjectUrl
          ? 1
          : 0,
    ),
    fetchTargets: [...fetchTargetsBySubject.values()]
      .flatMap((targets) => [...targets.values()])
      .sort((left, right) =>
        left.fetchUrl < right.fetchUrl
          ? -1
          : left.fetchUrl > right.fetchUrl
            ? 1
            : 0,
      ),
  };
}

/** Robots directives (meta robots or X-Robots-Tag) → indexable boolean. */
export function directivesIndexable(directives: readonly string[]): boolean {
  return !directives.some(
    (directive) => directive === "noindex" || directive === "none",
  );
}

function parseRobotsDirectives(content: string | null): readonly string[] {
  if (!content) return [];
  const tokens = content
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  const critical = tokens.filter(
    (token) => token === "noindex" || token === "none" || token === "nofollow",
  );
  return [...new Set([...critical, ...tokens])]
    .slice(0, CRAWL_PROJECTION_LIMITS.maxRobotsDirectives)
    .map((token) =>
      truncate(token, CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars),
    );
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// On-page facts (added here, not vendored: the upstream crawler has no
// equivalent). Everything below reads the same already-parsed tag soup and
// never issues a request of its own.
// ---------------------------------------------------------------------------

const UTF8 = new TextEncoder();

/**
 * Meta value by the preferred key attribute, falling back to the other one.
 *
 * Open Graph specifies `property` and everything else specifies `name`, but
 * consumers are not that strict and neither are authors. Twitter's own parser
 * accepts `<meta property="twitter:card">`, so a page declaring it that way has
 * a working card; reading only `name` reported the card as missing and marked
 * the page down for a tag it had.
 */
function metaContent(
  metaTags: readonly string[],
  key: string,
  attribute: "property" | "name",
): string | null {
  const other = attribute === "property" ? "name" : "property";
  const tag =
    metaTags.find(
      (candidate) => attr(candidate, attribute)?.toLowerCase() === key,
    ) ??
    metaTags.find((candidate) => attr(candidate, other)?.toLowerCase() === key);
  return normalisedAttributeText(
    attr(tag, "content"),
    CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars,
  );
}

/** Extensions of the images a reader would see, in document order. */
function collectImageFormats(html: string): readonly string[] {
  const out: string[] = [];
  for (const match of html.matchAll(openingTagPattern("img", "gi"))) {
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxImages) break;
    const src = attr(match[0], "src");
    if (src === null) continue;
    const withoutQuery = decodeHtml(src).split(/[?#]/)[0] ?? "";
    const extension = /\.([a-z0-9]{2,5})$/i.exec(withoutQuery)?.[1];
    if (extension !== undefined) out.push(extension.toLowerCase());
  }
  return out;
}

/**
 * Absolute URLs of the images a reader would see, in document order.
 *
 * Separate from `imageFormats`, which only needs the extension. This carries
 * the whole address because measuring an image's weight means fetching it, and
 * a relative `src` cannot be fetched from anywhere but the page it sat on.
 *
 * `srcset` candidates are deliberately not collected. The browser picks one by
 * viewport and pixel density, so there is no single "the image" among them, and
 * measuring every candidate would report a page as heavy for offering a small
 * one to small screens — the opposite of what it did right.
 */
function collectImageSources(html: string, pageUrl: string): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(openingTagPattern("img", "gi"))) {
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxImages) break;
    const src = attr(match[0], "src")?.trim();
    if (!src || src.startsWith("data:")) continue;
    let resolved: string;
    try {
      resolved = new URL(decodeHtml(src), pageUrl).toString();
    } catch {
      continue;
    }
    if (resolved.length > CRAWL_PROJECTION_LIMITS.maxUrlChars) continue;
    // One fetch per address, not per placement: a spacer or an icon repeated
    // down the page is one image and one download.
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/** Stylesheets and scripts in `<head>` that stop the parser where they sit. */
/** Comments removed; the elements a reader never sees are left in place. */
function withoutComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ");
}

/**
 * The part of the document a render-blocking resource can sit in.
 *
 * `<head>` and `</head>` are both optional tags in HTML5, and minifiers strip
 * them by default — `html-minifier`'s `removeOptionalTags` does. Matching only
 * an explicit element and falling back to the empty string reported "0
 * render-blocking stylesheets or synchronous scripts" for a minified document
 * carrying two of them, which is the disqualifying direction: a detector
 * failing toward a pass on a site doing the thing it looks for.
 *
 * So: the explicit element when there is one, everything before `<body` when
 * there is not, and null when neither exists so the caller can say it could
 * not measure rather than report a zero.
 */
function renderBlockingRegion(html: string): string | null {
  const explicit = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html)?.[1];
  if (explicit !== undefined) return explicit;
  const body = /<body\b/i.exec(html);
  if (body !== null) return html.slice(0, body.index);
  // An opening `<head>` with no close and no `<body>` is a truncated or
  // non-HTML document; guessing where the head ended would invent a
  // measurement.
  return null;
}

function collectRenderBlocking(html: string): {
  readonly stylesheets: number;
  readonly scripts: number;
  /** False when no head region could be identified, so zero is not a pass. */
  readonly measured: boolean;
} {
  const head = renderBlockingRegion(html);
  if (head === null) return { stylesheets: 0, scripts: 0, measured: false };
  let stylesheets = 0;
  for (const match of head.matchAll(openingTagPattern("link", "gi"))) {
    const tag = match[0];
    if (!(attr(tag, "rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) {
      continue;
    }
    // `media="print"` and the like do not block the first paint.
    const media = (attr(tag, "media") ?? "").trim().toLowerCase();
    if (media !== "" && media !== "all" && media !== "screen") continue;
    stylesheets += 1;
  }
  let scripts = 0;
  for (const match of head.matchAll(openingTagPattern("script", "gi"))) {
    const tag = match[0];
    if (attr(tag, "src") === null) continue;
    if (/\basync\b/i.test(tag) || /\bdefer\b/i.test(tag)) continue;
    // A module script defers by definition.
    if ((attr(tag, "type") ?? "").trim().toLowerCase() === "module") continue;
    scripts += 1;
  }
  return { stylesheets, scripts, measured: true };
}

/** The first image in document order, and what it declares about itself. */
function collectFirstImage(html: string): {
  readonly lazyLoaded: boolean;
  readonly width: number | null;
  readonly height: number | null;
} | null {
  const first = html.match(openingTagPattern("img", "i"));
  if (first === null) return null;
  const dimension = (name: string): number | null => {
    const raw = (attr(first[0], name) ?? "").trim();
    if (!/^\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  return {
    lazyLoaded: (attr(first[0], "loading") ?? "").trim().toLowerCase() === "lazy",
    width: dimension("width"),
    height: dimension("height"),
  };
}

/** Words of body text under each H3, segmented at heading boundaries. */
function collectWordsUnderEachH3(html: string): readonly number[] {
  const parts = html.split(/(<h[1-6]\b[^>]*>)/i);
  const out: number[] = [];
  let underH3 = false;
  for (const part of parts) {
    const opening = /^<h([1-6])\b/i.exec(part);
    if (opening !== null) {
      underH3 = opening[1] === "3";
      continue;
    }
    if (!underH3) continue;
    const text = extractNormalisedBody(part);
    out.push(text === "" ? 0 : text.split(/\s+/).filter(Boolean).length);
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxHeadings) break;
  }
  return out;
}

/** Heading levels in document order; see `headingLevels` for why it is separate. */
function collectHeadingLevels(html: string): readonly number[] {
  const out: number[] = [];
  for (const match of html.matchAll(openingTagPattern("h[1-6]", "gi"))) {
    const level = Number(/<h([1-6])/i.exec(match[0])?.[1]);
    if (Number.isInteger(level)) out.push(level);
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxHeadingLevels) break;
  }
  return out;
}

function collectImageFacts(html: string): ParsedImageFacts {
  const tags = [...html.matchAll(openingTagPattern("img", "gi"))].map(
    (match) => match[0],
  );
  let withAlt = 0;
  let withEmptyAlt = 0;
  let withoutAlt = 0;
  let withDimensions = 0;
  let lazyLoaded = 0;
  for (const tag of tags) {
    const alt = attr(tag, "alt");
    // Decoded before the emptiness test, like every other published text.
    // `alt="&nbsp;"` is a decorative declaration written the long way, and
    // reading it raw counted that image as carrying a description.
    if (alt === null) withoutAlt += 1;
    else if (decodeHtml(alt).replace(/\u00a0/g, " ").trim() === "")
      withEmptyAlt += 1;
    else withAlt += 1;

    const width = attr(tag, "width");
    const height = attr(tag, "height");
    if (
      width !== null &&
      width.trim() !== "" &&
      height !== null &&
      height.trim() !== ""
    )
      withDimensions += 1;
    if ((attr(tag, "loading") ?? "").trim().toLowerCase() === "lazy")
      lazyLoaded += 1;
  }
  return {
    total: tags.length,
    withAlt,
    withEmptyAlt,
    withoutAlt,
    withDimensions,
    lazyLoaded,
  };
}

/** Counts of the elements through which a page can act on a visitor's intent. */
function collectInteractiveFacts(html: string): ParsedInteractiveFacts {
  const count = (name: string): number =>
    [...html.matchAll(openingTagPattern(name, "gi"))].length;
  return {
    forms: count("form"),
    inputs: count("input"),
    buttons:
      count("button") +
      [...html.matchAll(openingTagPattern("input", "gi"))].filter((match) =>
        ["submit", "button"].includes(
          (attr(match[0], "type") ?? "").trim().toLowerCase(),
        ),
      ).length,
    selects: count("select"),
    textareas: count("textarea"),
    canvases: count("canvas"),
    media: count("video") + count("audio"),
    iframes: count("iframe"),
  };
}

/**
 * Code points that carry no word gaps, counted one unit each.
 *
 * The same ranges the audit's `text_units.v1` counter uses. Kept here as well
 * as there because this package is the lower layer and cannot import the
 * higher one; a cross-package test drives the real parser and the real counter
 * over the same corpus so the two cannot drift apart unnoticed.
 */
const CJK_UNIT_PATTERN = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu;

function textMetricsOf(bodyText: string): ParsedTextMetrics {
  const cjkMatches = bodyText.match(CJK_UNIT_PATTERN);
  const dense = bodyText.replace(/\s+/gu, "");
  return {
    cjkChars: cjkMatches === null ? 0 : cjkMatches.length,
    nonCjkWords: bodyText
      .replace(CJK_UNIT_PATTERN, "")
      .split(/\s+/u)
      .filter(Boolean).length,
    denseChars: [...dense].length,
  };
}

function collectScriptBytes(html: string): number {
  let bytes = 0;
  for (const match of html.matchAll(elementPattern("script", "gi"))) {
    bytes += UTF8.encode(match[2] ?? "").length;
  }
  return bytes;
}

function collectExternalLinkFacts(
  html: string,
  pageUrl: string,
  pageOrigin: string,
): ParsedExternalLinkFacts {
  const byTarget = new Map<
    string,
    { followedSomewhere: boolean; unsafeSomewhere: boolean }
  >();
  for (const match of html.matchAll(openingTagPattern("a", "gi"))) {
    const tag = match[0];
    const href = attr(tag, "href");
    if (href === null) continue;
    const pair = canonicalizeUrl(decodeHtml(href), pageUrl);
    if (pair === null) continue;
    let origin: string;
    try {
      origin = new URL(pair.fetchUrl).origin;
    } catch {
      continue;
    }
    // Exact origin, matching `collectInternalOutlinks`. Folding www into the
    // apex here and not there made a link to the site's other host vanish from
    // BOTH populations: external skipped it as internal, internal skipped it as
    // cross-origin. Widening the internal side instead would change
    // `crawl.page.v1`, which the product persists — so the two stay identical
    // and dual-host sites keep the known over-count they already had.
    if (origin === pageOrigin) continue;

    const relTokens = new Set(
      (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean),
    );
    const opensNewWindow =
      (attr(tag, "target") ?? "").toLowerCase() === "_blank";
    // `noreferrer` implies `noopener` per HTML, so a link carrying it is not
    // handing anything over and must not be counted as if it were.
    const opensSafely =
      relTokens.has("noopener") || relTokens.has("noreferrer");

    const seen = byTarget.get(pair.subjectUrl) ?? {
      followedSomewhere: false,
      unsafeSomewhere: false,
    };
    byTarget.set(pair.subjectUrl, {
      followedSomewhere: seen.followedSomewhere || !relTokens.has("nofollow"),
      unsafeSomewhere: seen.unsafeSomewhere || (opensNewWindow && !opensSafely),
    });
  }
  const targets = [...byTarget.values()];
  return {
    total: targets.length,
    nofollow: targets.filter((entry) => !entry.followedSomewhere).length,
    blankWithoutNoopener: targets.filter((entry) => entry.unsafeSomewhere)
      .length,
  };
}

/**
 * The same alternates, with the target each one points at.
 *
 * Reports whether the cap cut the list short, because D6 and 1.7 publish
 * "100% valid targets" over whatever they were handed and a truncated list
 * makes that sentence a claim about a prefix.
 */
function collectHreflangAlternates(
  html: string,
  pageUrl: string,
): {
  readonly alternates: readonly {
    readonly lang: string;
    readonly href: string;
  }[];
  readonly truncated: boolean;
} {
  const out: { lang: string; href: string }[] = [];
  let truncated = false;
  for (const match of html.matchAll(openingTagPattern("link", "gi"))) {
    const tag = match[0];
    // Trimmed: `rel=" alternate"` is a valid declaration, and an exact match
    // against the untrimmed value silently dropped it — toward a clean result,
    // since a dropped alternate is one fewer target to find broken.
    if (attr(tag, "rel")?.trim().toLowerCase() !== "alternate") continue;
    const lang = attr(tag, "hreflang")?.trim();
    const href = attr(tag, "href")?.trim();
    if (!lang || !href) continue;
    // Resolved against the page so a relative alternate is comparable with the
    // collected pages, and decoded first for the same reason every other href
    // on this page is: `&amp;` is a separator, not a literal.
    let resolved: string;
    try {
      resolved = new URL(decodeHtml(href), pageUrl).toString();
    } catch {
      continue;
    }
    if (resolved.length > CRAWL_PROJECTION_LIMITS.maxUrlChars) continue;
    out.push({
      lang: boundChars(lang, CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars),
      href: resolved,
    });
    if (out.length >= CRAWL_PROJECTION_LIMITS.maxHreflangAlternates) {
      truncated = true;
      break;
    }
  }
  return { alternates: out, truncated };
}

/**
 * Whether the page declares itself part of a sequence.
 *
 * A `rel="next"` or `rel="prev"` is a page saying "I am one of several like
 * me". Pages in a sequence resemble each other by design, and a check that
 * reports that as duplication reports every paginated archive on the web.
 */
function collectSequenceMembership(html: string): boolean {
  for (const match of html.matchAll(openingTagPattern("link", "gi"))) {
    const rel = attr(match[0], "rel")?.trim().toLowerCase();
    if (rel === "next" || rel === "prev") return true;
  }
  return false;
}

function collectHreflang(html: string): readonly string[] {
  const tags = [...html.matchAll(openingTagPattern("link", "gi"))].map(
    (match) => match[0],
  );
  const seen: string[] = [];
  for (const tag of tags) {
    if (attr(tag, "rel")?.toLowerCase() !== "alternate") continue;
    const lang = attr(tag, "hreflang");
    if (lang === null || lang.trim() === "") continue;
    const bounded = boundChars(
      lang.trim(),
      CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars,
    );
    if (!seen.includes(bounded)) seen.push(bounded);
    if (seen.length >= CRAWL_PROJECTION_LIMITS.maxRobotsDirectives) break;
  }
  return seen;
}

/** `<meta charset>` first, then the legacy `http-equiv` spelling. */
function collectCharset(metaTags: readonly string[]): string | null {
  for (const tag of metaTags) {
    const direct = attr(tag, "charset");
    // Bounded like every other published string. An unbounded value here built
    // a payload that the audit's own exact-key validator then rejected, which
    // silently disables the crawl cache rather than erroring anywhere.
    if (direct !== null && direct.trim() !== "") {
      return boundChars(
        direct.trim().toLowerCase(),
        CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars,
      );
    }
  }
  const equiv = metaTags.find(
    (tag) => attr(tag, "http-equiv")?.toLowerCase() === "content-type",
  );
  const declared = attr(equiv, "content")?.match(
    /charset\s*=\s*([\w-]+)/i,
  )?.[1];
  return declared
    ? boundChars(
        declared.toLowerCase(),
        CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars,
      )
    : null;
}

function collectFaviconDeclared(html: string): boolean {
  for (const match of html.matchAll(openingTagPattern("link", "gi"))) {
    const rel = (attr(match[0], "rel") ?? "").toLowerCase();
    const tokens = new Set(rel.split(/\s+/).filter(Boolean));
    const isIconRel =
      tokens.has("icon") ||
      tokens.has("apple-touch-icon") ||
      tokens.has("mask-icon") ||
      // `shortcut` is only an icon relation paired with `icon`; alone it is a
      // different (legacy) relation entirely.
      (tokens.has("shortcut") && tokens.has("icon"));
    if (!isIconRel) continue;
    // A relation with nothing to point at declares no icon. Reporting one
    // would tell a visitor a file exists that no browser can fetch.
    const href = attr(match[0], "href");
    if (href !== null && href.trim() !== "") return true;
  }
  return false;
}

function collectOnPageFacts(
  /** Comment-free markup with script/style/template contents removed. */
  markup: string,
  metaTags: readonly string[],
  pageUrl: string,
  pageOrigin: string,
  bodyText: string,
  htmlTag: string | undefined,
  /** The document as transferred, comments included: this is what weighs. */
  rawHtml: string,
): ParsedOnPageFacts {
  const jsonLd = collectJsonLdProperties(withoutComments(rawHtml));
  const hreflang = collectHreflangAlternates(markup, pageUrl);
  return {
    lang: normalisedAttributeText(
      attr(htmlTag, "lang"),
      CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars,
    ),
    openGraph: {
      title: metaContent(metaTags, "og:title", "property"),
      description: metaContent(metaTags, "og:description", "property"),
      image: metaContent(metaTags, "og:image", "property"),
    },
    twitterCard: metaContent(metaTags, "twitter:card", "name"),
    viewport: metaContent(metaTags, "viewport", "name"),
    charset: collectCharset(metaTags),
    faviconDeclared: collectFaviconDeclared(markup),
    partOfASequence: collectSequenceMembership(markup),
    hreflang: collectHreflang(markup),
    hreflangAlternates: hreflang.alternates,
    hreflangAlternatesTruncated: hreflang.truncated,
    images: collectImageFacts(markup),
    imageFormats: collectImageFormats(markup),
    imageSources: collectImageSources(markup, pageUrl),
    headingLevels: collectHeadingLevels(markup),
    // Comment-stripped but script-preserved: both of these read <script> tags,
    // which `markup` removes.
    renderBlocking: collectRenderBlocking(withoutComments(rawHtml)),
    firstImage: collectFirstImage(markup),
    wordsUnderEachH3: collectWordsUnderEachH3(markup),
    jsonLdProperties: jsonLd.properties,
    faqQuestions: jsonLd.faqQuestions,
    externalLinks: collectExternalLinkFacts(markup, pageUrl, pageOrigin),
    htmlBytes: UTF8.encode(rawHtml).length,
    visibleTextBytes: UTF8.encode(bodyText).length,
    scriptBytes: collectScriptBytes(rawHtml),
    interactive: collectInteractiveFacts(markup),
    textMetrics: textMetricsOf(bodyText),
    termFrequencies: buildTermFrequencyTables(bodyText),
  };
}

/**
 * Parse one HTML document into its content-derived crawl facts. `pageUrl` is the
 * canonical URL of the page (used as the base for resolving links and as the
 * same-origin reference for internal-link filtering).
 */
export function parsePage(rawHtml: string, pageUrl: string): ParsedPage {
  /**
   * Commented-out markup is not on the page.
   *
   * Every collector below reads tags out of a string, and a comment is just
   * more string. A page carrying
   * `<!-- <meta name="viewport" content="w"><link rel="icon"> -->` was reported
   * as declaring both — facts about markup a browser never sees. Stripped once
   * here so no collector has to remember to.
   *
   * Byte sizes are still measured against the original document, because that
   * is what was transferred.
   */
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, "");
  /**
   * The same document with the elements a reader never sees taken out.
   *
   * JSON-LD and byte sizes deliberately read `html` and `rawHtml` instead: one
   * is about what a script block contains, the other about what was shipped.
   */
  const markup = withoutNonRenderedElements(html);
  let pageOrigin: string;
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    pageOrigin = "";
  }

  /**
   * `<base href>` is deliberately NOT honoured here.
   *
   * Browsers do honour it, so a document declaring `<base href="/shop/">` has
   * its relative links resolved one directory higher than this parser resolves
   * them. Fixing that changes `canonicalTarget` and `internalOutlinks`, and
   * those two fields ARE the frozen `crawl.page.v1` metric the product
   * persists: the same HTML would then produce different link-graph facts
   * under an unchanged metric key, and no stored observation would say which
   * meaning produced it. That is a versioned migration, not a parser fix, so
   * it is left out of the public tool's changes and recorded here instead.
   */

  const canonicalTag = [
    ...markup.matchAll(openingTagPattern("link", "gi")),
  ].find(
    (match) => attr(match[0], "rel")?.trim().toLowerCase() === "canonical",
  )?.[0];
  const canonicalHref = attr(canonicalTag, "href");
  const canonicalPair = canonicalHref
    ? canonicalizeUrl(decodeHtml(canonicalHref), pageUrl)
    : null;
  const canonicalTarget =
    canonicalPair !== null &&
    canonicalPair.subjectUrl.length <= CRAWL_PROJECTION_LIMITS.maxUrlChars &&
    canonicalPair.fetchUrl.length <= CRAWL_PROJECTION_LIMITS.maxUrlChars
      ? canonicalPair.fetchUrl
      : null;
  const canonicalFetchTarget =
    canonicalTarget !== null && canonicalPair
      ? {
          fetchUrl: canonicalPair.fetchUrl,
          subjectUrl: canonicalPair.subjectUrl,
        }
      : null;

  const metaTags = [...markup.matchAll(openingTagPattern("meta", "gi"))].map(
    (tag) => tag[0],
  );
  const descriptionTag = metaTags.find(
    (tag) => attr(tag, "name")?.toLowerCase() === "description",
  );
  const robotsTag = metaTags.find(
    (tag) => attr(tag, "name")?.toLowerCase() === "robots",
  );
  const robotsDirectives = parseRobotsDirectives(attr(robotsTag, "content"));

  const description = normalisedAttributeText(
    attr(descriptionTag, "content"),
    CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars,
  );
  const bodyText = extractNormalisedBody(markup);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const outlinks = collectInternalOutlinks(markup, pageUrl, pageOrigin);
  const htmlTag = firstTag(markup, openingTagPattern("html", "i"));
  const onPage = collectOnPageFacts(
    markup,
    metaTags,
    pageUrl,
    pageOrigin,
    bodyText,
    htmlTag,
    rawHtml,
  );

  return {
    htmlLanguage: parseHtmlLanguageDeclaration(attr(htmlTag, "lang")),
    title: tagText(markup, "title", CRAWL_PROJECTION_LIMITS.maxTitleChars),
    metaDescription: description,
    canonicalTarget,
    robotsDirectives,
    robotsIndexable: directivesIndexable(robotsDirectives),
    h1: collectH1(markup),
    headings: collectHeadings(markup),
    wordCount,
    internalOutlinks: outlinks.projections,
    internalFetchTargets: outlinks.fetchTargets,
    canonicalFetchTarget,
    jsonLd: collectJsonLd(html),
    paragraphs: collectParagraphs(markup),
    bodyExcerpt: bodyText
      ? truncate(bodyText, CRAWL_PROJECTION_LIMITS.maxBodyExcerptChars)
      : null,
    onPage,
  };
}
