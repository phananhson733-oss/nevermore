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
  readonly images: ParsedImageFacts;
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
  /<\s*(script|style|template)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;

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
const CJK_UNIT_PATTERN = /[㐀-鿿豈-﫿぀-ゟ゠-ヿ가-힯]/gu;

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

/**
 * Whether two origins belong to the same site for outbound-link purposes.
 *
 * `https://example.com` and `https://www.example.com` are one site to every
 * reader and two origins to `URL`. Treating them as separate published pages
 * that link only to themselves as having no internal links at all, on any site
 * serving both hosts without redirecting. A deeper subdomain stays external:
 * that is a judgement about ownership this parser has no evidence for.
 */
function isSameSite(left: string, right: string): boolean {
  if (left === right) return true;
  const bare = (origin: string): string | null => {
    try {
      return new URL(origin).host.replace(/^www\./i, "");
    } catch {
      return null;
    }
  };
  const leftHost = bare(left);
  return leftHost !== null && leftHost === bare(right);
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
    if (isSameSite(origin, pageOrigin)) continue;

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
  baseUrl: string,
  pageOrigin: string,
  bodyText: string,
  htmlTag: string | undefined,
  /** The document as transferred, comments included: this is what weighs. */
  rawHtml: string,
): ParsedOnPageFacts {
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
    hreflang: collectHreflang(markup),
    images: collectImageFacts(markup),
    externalLinks: collectExternalLinkFacts(markup, baseUrl, pageOrigin),
    htmlBytes: UTF8.encode(rawHtml).length,
    visibleTextBytes: UTF8.encode(bodyText).length,
    scriptBytes: collectScriptBytes(rawHtml),
    interactive: collectInteractiveFacts(markup),
    textMetrics: textMetricsOf(bodyText),
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
   * `<base href>` moves the origin of every relative URL on the page.
   *
   * Browsers honour it and this parser did not, so a document declaring
   * `<base href="/shop/">` had every relative link resolved one directory too
   * high — wrong link graph, wrong canonical target, and internal links
   * classified against the wrong paths. Only an absolute, http(s) base is
   * accepted; anything else leaves the page URL as the base, which is what a
   * browser falls back to as well.
   */
  const baseHref = attr(
    firstTag(markup, openingTagPattern("base", "i")),
    "href",
  );
  const resolvedBase = ((): string => {
    if (baseHref === null || baseHref.trim() === "") return pageUrl;
    try {
      const candidate = new URL(decodeHtml(baseHref).trim(), pageUrl);
      return candidate.protocol === "http:" || candidate.protocol === "https:"
        ? candidate.href
        : pageUrl;
    } catch {
      return pageUrl;
    }
  })();

  const canonicalTag = [
    ...markup.matchAll(openingTagPattern("link", "gi")),
  ].find(
    (match) => attr(match[0], "rel")?.trim().toLowerCase() === "canonical",
  )?.[0];
  const canonicalHref = attr(canonicalTag, "href");
  const canonicalPair = canonicalHref
    ? canonicalizeUrl(decodeHtml(canonicalHref), resolvedBase)
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
  const outlinks = collectInternalOutlinks(markup, resolvedBase, pageOrigin);
  const htmlTag = firstTag(markup, openingTagPattern("html", "i"));
  const onPage = collectOnPageFacts(
    markup,
    metaTags,
    resolvedBase,
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
