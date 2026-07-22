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

function decodeXml(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

export interface SitemapDocument {
  readonly isIndex: boolean;
  readonly locs: readonly string[];
}

/** Parse one sitemap document into its `<loc>` values and index/urlset kind. */
export function parseSitemapXml(xml: string): SitemapDocument {
  if (!/<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(xml)) return { isIndex: false, locs: [] };
  const isIndex = /<(?:\w+:)?sitemapindex\b/i.test(xml);
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<(?:\w+:)?loc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?loc\s*>/gi)) {
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
