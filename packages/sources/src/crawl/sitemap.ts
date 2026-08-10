/**
 * sitemap.xml + sitemap-index parsing for the crawl adapter (spec §7.3).
 * Vendor-copied and reshaped from the old `packages/crawler/src/sitemap.ts`
 * (commit 72af9300…): the regex `<loc>` extraction is preserved; recursion,
 * same-origin filtering, and canonicalization-to-subjectUrl are added here so
 * the result is a `CrawlSitemapProjection`.
 *
 * HTTP is delegated to the engine via an injected `fetchText` so every fetch
 * still passes the SSRF guard and the shared byte/wall-clock budget.
 */

import { canonicalizeUrl } from "../canonical-url.ts";
import type { CrawlSitemapProjection } from "../observations.ts";

/** Recursion + fan-out bounds keep a hostile/looping sitemap graph finite. */
const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAP_DOCUMENTS = 50;
const MAX_SITEMAP_URLS = 10_000;

/**
 * The five XML predefined entities plus numeric character references.
 *
 * `&amp;` alone was not enough. A sitemap that writes its query separators as
 * `&#38;` or `&#x26;` — which XML permits everywhere `&amp;` is permitted, and
 * which several generators emit — left the escape sitting literally inside the
 * URL. That URL then canonicalized into a phantom that no page links to, so
 * every affected entry surfaced as an orphan_candidate in the internal-link
 * audit and a sitemap_page_without_observed_inlink in the site audit: findings
 * about the parser, reported as findings about the site.
 *
 * One pass, not a chain of replaces. Chained replaces decode their own output:
 * `&amp;#38;` becomes `&#38;` after the first replace and then `&` after the
 * numeric one, inventing an ampersand the document never contained. A single
 * scan cannot revisit what it has already written.
 */
const XML_ENTITY = /&(?:#(x[0-9a-f]+|\d+)|(amp|lt|gt|quot|apos));/gi;
const XML_NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(value: string): string {
  return value.replace(XML_ENTITY, (match, numeric?: string, name?: string) => {
    if (name) return XML_NAMED[name.toLowerCase()] ?? match;
    if (!numeric) return match;

    const isHex = numeric.toLowerCase().startsWith("x");
    const code = Number.parseInt(
      isHex ? numeric.slice(1) : numeric,
      isHex ? 16 : 10,
    );
    // Same hostile-input posture as the page parser: an out-of-range or
    // surrogate code point degrades to U+FFFD rather than throwing mid-crawl.
    const validScalar =
      Number.isSafeInteger(code) &&
      code > 0 &&
      code <= 0x10ffff &&
      (code < 0xd800 || code > 0xdfff);
    return validScalar ? String.fromCodePoint(code) : "�";
  });
}

export interface SitemapDocument {
  readonly isIndex: boolean;
  readonly locs: readonly string[];
}

/** Parse one sitemap document into its `<loc>` values and index/urlset kind. */
export function parseSitemapXml(xml: string): SitemapDocument {
  if (!/<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(xml))
    return { isIndex: false, locs: [] };
  const isIndex = /<(?:\w+:)?sitemapindex\b/i.test(xml);
  const seen = new Set<string>();
  for (const match of xml.matchAll(
    /<(?:\w+:)?loc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?loc\s*>/gi,
  )) {
    const url = decodeXml(match[1] ?? "").trim();
    if (url) seen.add(url);
  }
  return { isIndex, locs: [...seen] };
}

export interface SitemapDeps {
  /** Returns the response body on a 2xx fetch, else null. Guard + budget applied by the engine. */
  readonly fetchText: (url: string) => Promise<string | null>;
  /**
   * Ephemeral frontier seam. The persisted projection remains subject-only,
   * while the engine receives the exact URL declared by the sitemap.
   */
  readonly onMember?: (target: {
    readonly fetchUrl: string;
    readonly subjectUrl: string;
  }) => void;
}

/**
 * Fetch and parse the seed sitemap URLs (following `<sitemapindex>` children),
 * returning the same-origin member subjectUrls as a `CrawlSitemapProjection`.
 * A broken or looping sitemap degrades to fewer members, never an error.
 */
export async function collectSitemap(
  origin: string,
  seedUrls: readonly string[],
  deps: SitemapDeps,
): Promise<CrawlSitemapProjection> {
  const members = new Set<string>();
  const visited = new Set<string>();
  let fetchedAny = false;
  let documents = 0;

  const sameOrigin = (url: string): boolean => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };

  const visit = async (sitemapUrl: string, depth: number): Promise<void> => {
    if (depth > MAX_SITEMAP_DEPTH) return;
    if (documents >= MAX_SITEMAP_DOCUMENTS) return;
    if (members.size >= MAX_SITEMAP_URLS) return;
    const key = canonicalizeUrl(sitemapUrl)?.fetchUrl ?? sitemapUrl;
    if (visited.has(key) || !sameOrigin(key)) return;
    visited.add(key);
    documents += 1;

    const body = await deps.fetchText(key);
    if (body === null) return;
    fetchedAny = true;

    const document = parseSitemapXml(body);
    if (document.isIndex) {
      for (const child of document.locs) {
        if (members.size >= MAX_SITEMAP_URLS) break;
        await visit(child, depth + 1);
      }
      return;
    }
    for (const loc of document.locs) {
      if (members.size >= MAX_SITEMAP_URLS) break;
      const pair = canonicalizeUrl(loc);
      if (!pair || !sameOrigin(pair.fetchUrl)) continue;
      deps.onMember?.({
        fetchUrl: pair.fetchUrl,
        subjectUrl: pair.subjectUrl,
      });
      members.add(pair.subjectUrl);
    }
  };

  for (const seed of seedUrls) await visit(seed, 0);

  const subjectUrls = [...members].sort();
  return {
    fetched: fetchedAny,
    urlCount: subjectUrls.length,
    subjectUrls,
  };
}
