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
}

/** Outbound links leaving this origin, and the ones that open unsafely. */
export interface ParsedExternalLinkFacts {
  readonly total: number;
  readonly nofollow: number;
  /** `target=_blank` without `rel=noopener`, which hands over a window handle. */
  readonly blankWithoutNoopener: number;
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
}

// ---------------------------------------------------------------------------
// Low-level regex helpers (vendor-copied from page.ts / extract.ts).
// ---------------------------------------------------------------------------

function attr(tag: string | undefined, name: string): string | null {
  if (!tag) return null;
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function firstTag(html: string, pattern: RegExp): string | undefined {
  return html.match(pattern)?.[0];
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
const HTML_ENTITY = /&(?:#(-?(?:x[0-9a-f]+|\d+))|(nbsp|amp|lt|gt|quot|apos));/gi;

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

/** Meta value by `property=` (Open Graph) or `name=` (everything else). */
function metaContent(
  metaTags: readonly string[],
  key: string,
  attribute: "property" | "name",
): string | null {
  const tag = metaTags.find(
    (candidate) => attr(candidate, attribute)?.toLowerCase() === key,
  );
  return normalisedAttributeText(
    attr(tag, "content"),
    CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars,
  );
}

function collectImageFacts(html: string): ParsedImageFacts {
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  let withAlt = 0;
  let withEmptyAlt = 0;
  let withoutAlt = 0;
  for (const tag of tags) {
    const alt = attr(tag, "alt");
    if (alt === null) withoutAlt += 1;
    else if (alt.trim() === "") withEmptyAlt += 1;
    else withAlt += 1;
  }
  return { total: tags.length, withAlt, withEmptyAlt, withoutAlt };
}

function collectExternalLinkFacts(
  html: string,
  pageUrl: string,
  pageOrigin: string,
): ParsedExternalLinkFacts {
  let total = 0;
  let nofollow = 0;
  let blankWithoutNoopener = 0;
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
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
    if (origin === pageOrigin) continue;
    total += 1;
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const relTokens = new Set(rel.split(/\s+/).filter(Boolean));
    if (relTokens.has("nofollow")) nofollow += 1;
    const opensNewWindow = (attr(tag, "target") ?? "").toLowerCase() === "_blank";
    if (opensNewWindow && !relTokens.has("noopener")) blankWithoutNoopener += 1;
  }
  return { total, nofollow, blankWithoutNoopener };
}

function collectHreflang(html: string): readonly string[] {
  const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
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
    if (direct !== null && direct.trim() !== "") return direct.trim().toLowerCase();
  }
  const equiv = metaTags.find(
    (tag) => attr(tag, "http-equiv")?.toLowerCase() === "content-type",
  );
  const declared = attr(equiv, "content")?.match(/charset\s*=\s*([\w-]+)/i)?.[1];
  return declared ? declared.toLowerCase() : null;
}

function collectFaviconDeclared(html: string): boolean {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(match[0], "rel") ?? "").toLowerCase();
    const tokens = new Set(rel.split(/\s+/).filter(Boolean));
    if (
      tokens.has("icon") ||
      tokens.has("shortcut") ||
      tokens.has("apple-touch-icon") ||
      tokens.has("mask-icon")
    ) {
      return true;
    }
  }
  return false;
}

function collectOnPageFacts(
  html: string,
  metaTags: readonly string[],
  pageUrl: string,
  pageOrigin: string,
  bodyText: string,
  htmlTag: string | undefined,
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
    faviconDeclared: collectFaviconDeclared(html),
    hreflang: collectHreflang(html),
    images: collectImageFacts(html),
    externalLinks: collectExternalLinkFacts(html, pageUrl, pageOrigin),
    htmlBytes: UTF8.encode(html).length,
    visibleTextBytes: UTF8.encode(bodyText).length,
  };
}

/**
 * Parse one HTML document into its content-derived crawl facts. `pageUrl` is the
 * canonical URL of the page (used as the base for resolving links and as the
 * same-origin reference for internal-link filtering).
 */
export function parsePage(html: string, pageUrl: string): ParsedPage {
  let pageOrigin: string;
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    pageOrigin = "";
  }

  const canonicalTag = firstTag(
    html,
    /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i,
  );
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

  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((tag) => tag[0]);
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
  const bodyText = extractNormalisedBody(html);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const outlinks = collectInternalOutlinks(html, pageUrl, pageOrigin);
  const htmlTag = firstTag(html, /<html\b[^>]*>/i);
  const onPage = collectOnPageFacts(
    html,
    metaTags,
    pageUrl,
    pageOrigin,
    bodyText,
    htmlTag,
  );

  return {
    htmlLanguage: parseHtmlLanguageDeclaration(attr(htmlTag, "lang")),
    title: tagText(html, "title", CRAWL_PROJECTION_LIMITS.maxTitleChars),
    metaDescription: description,
    canonicalTarget,
    robotsDirectives,
    robotsIndexable: directivesIndexable(robotsDirectives),
    h1: collectH1(html),
    headings: collectHeadings(html),
    wordCount,
    internalOutlinks: outlinks.projections,
    internalFetchTargets: outlinks.fetchTargets,
    canonicalFetchTarget,
    jsonLd: collectJsonLd(html),
    paragraphs: collectParagraphs(html),
    bodyExcerpt: bodyText
      ? truncate(bodyText, CRAWL_PROJECTION_LIMITS.maxBodyExcerptChars)
      : null,
    onPage,
  };
}
