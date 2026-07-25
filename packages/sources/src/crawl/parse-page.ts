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

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(-?(?:x[0-9a-f]+|\d+));/gi, (_match, raw: string) => {
      const number = raw.toLowerCase().startsWith("x")
        ? Number.parseInt(raw.slice(1), 16)
        : Number.parseInt(raw, 10);
      const validScalar =
        Number.isSafeInteger(number) &&
        number > 0 &&
        number <= 0x10ffff &&
        (number < 0xd800 || number > 0xdfff);
      return validScalar ? String.fromCodePoint(number) : "\ufffd";
    });
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
    const href = attr(openingTag, "href");
    if (!href) continue;
    const pair = canonicalizeUrl(href, pageUrl);
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
    ? canonicalizeUrl(canonicalHref, pageUrl)
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

  return {
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
  };
}
