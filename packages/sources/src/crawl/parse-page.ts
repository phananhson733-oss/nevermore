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
import type { CrawlJsonLdProjection, CrawlLinkProjection } from "../observations.ts";

/** Bounds keep the persisted raw payload finite regardless of page size. */
const BODY_EXCERPT_MAX_CHARS = 500;
const MAX_PARAGRAPHS = 200;
const MAX_PARAGRAPH_CHARS = 1000;
const MAX_HEADINGS = 300;
const MAX_INTERNAL_OUTLINKS = 1000;

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
  readonly jsonLd: CrawlJsonLdProjection;
  readonly paragraphs: readonly string[];
  readonly bodyExcerpt: string | null;
}

// ---------------------------------------------------------------------------
// Low-level regex helpers (vendor-copied from page.ts / extract.ts).
// ---------------------------------------------------------------------------

function attr(tag: string | undefined, name: string): string | null {
  if (!tag) return null;
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
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
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, raw: string) => {
      const number = raw.toLowerCase().startsWith("x")
        ? Number.parseInt(raw.slice(1), 16)
        : Number.parseInt(raw, 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : "";
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
    .replace(/<\s*(script|style|noscript|template|svg|canvas|iframe|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(withoutNonContent)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalisedAttributeText(value: string | null): string | null {
  const text = extractNormalisedBody(value ?? "");
  return text || null;
}

function tagText(html: string, name: string): string | null {
  const found = html.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, "i"))?.[1];
  return found === undefined ? null : extractNormalisedBody(found) || null;
}

// ---------------------------------------------------------------------------
// Structured extraction.
// ---------------------------------------------------------------------------

function collectH1(html: string): readonly string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)) {
    const text = extractNormalisedBody(match[1] ?? "");
    if (text) out.push(text);
  }
  return out;
}

function collectHeadings(html: string): readonly string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = extractNormalisedBody(match[2] ?? "");
    if (text) out.push(text);
    if (out.length >= MAX_HEADINGS) break;
  }
  return out;
}

function collectParagraphs(html: string): readonly string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<(?:p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)\s*>/gi)) {
    const text = extractNormalisedBody(match[1] ?? "");
    if (text) out.push(text.slice(0, MAX_PARAGRAPH_CHARS));
    if (out.length >= MAX_PARAGRAPHS) break;
  }
  return out;
}

function declaredTypes(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function collectTypes(value: unknown, types: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTypes(item, types);
    return;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const type of declaredTypes(object["@type"])) types.add(type);
    for (const [key, nested] of Object.entries(object)) {
      if (key !== "@type" && key !== "@context") collectTypes(nested, types);
    }
  }
}

function collectJsonLd(html: string): CrawlJsonLdProjection {
  const types = new Set<string>();
  let errorCount = 0;
  const blocks = html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  for (const block of blocks) {
    try {
      collectTypes(JSON.parse(block[1] ?? ""), types);
    } catch {
      errorCount += 1;
    }
  }
  return { types: [...types].sort(), errorCount };
}

function anchorAccessibleName(openingTag: string, content: string): string | null {
  const ariaLabel = normalisedAttributeText(attr(openingTag, "aria-label"));
  if (ariaLabel) return ariaLabel;
  const visibleText = extractNormalisedBody(content);
  if (visibleText) return visibleText;
  for (const image of content.matchAll(/<img\b[^>]*>/gi)) {
    const alt = normalisedAttributeText(attr(image[0], "alt"));
    if (alt) return alt;
  }
  return null;
}

function collectInternalOutlinks(html: string, pageUrl: string, pageOrigin: string): readonly CrawlLinkProjection[] {
  const byTarget = new Map<string, CrawlLinkProjection>();
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
    if (byTarget.has(pair.subjectUrl)) continue;
    const rel = attr(openingTag, "rel")?.trim();
    byTarget.set(pair.subjectUrl, {
      targetSubjectUrl: pair.subjectUrl,
      rel: rel ? rel : null,
      anchorText: anchorAccessibleName(openingTag, match[2] ?? ""),
    });
    if (byTarget.size >= MAX_INTERNAL_OUTLINKS) break;
  }
  return [...byTarget.values()].sort((left, right) =>
    left.targetSubjectUrl < right.targetSubjectUrl ? -1 : left.targetSubjectUrl > right.targetSubjectUrl ? 1 : 0,
  );
}

/** Robots directives (meta robots or X-Robots-Tag) → indexable boolean. */
export function directivesIndexable(directives: readonly string[]): boolean {
  return !directives.some((directive) => directive === "noindex" || directive === "none");
}

function parseRobotsDirectives(content: string | null): readonly string[] {
  if (!content) return [];
  return content
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
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

  const canonicalTag = firstTag(html, /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i);
  const canonicalHref = attr(canonicalTag, "href");
  const canonicalTarget = canonicalHref ? canonicalizeUrl(canonicalHref, pageUrl)?.subjectUrl ?? null : null;

  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((tag) => tag[0]);
  const descriptionTag = metaTags.find((tag) => attr(tag, "name")?.toLowerCase() === "description");
  const robotsTag = metaTags.find((tag) => attr(tag, "name")?.toLowerCase() === "robots");
  const robotsDirectives = parseRobotsDirectives(attr(robotsTag, "content"));

  const description = normalisedAttributeText(attr(descriptionTag, "content"));
  const bodyText = extractNormalisedBody(html);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  return {
    title: tagText(html, "title"),
    metaDescription: description,
    canonicalTarget,
    robotsDirectives,
    robotsIndexable: directivesIndexable(robotsDirectives),
    h1: collectH1(html),
    headings: collectHeadings(html),
    wordCount,
    internalOutlinks: collectInternalOutlinks(html, pageUrl, pageOrigin),
    jsonLd: collectJsonLd(html),
    paragraphs: collectParagraphs(html),
    bodyExcerpt: bodyText ? bodyText.slice(0, BODY_EXCERPT_MAX_CHARS) : null,
  };
}
