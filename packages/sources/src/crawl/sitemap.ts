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
import { CRAWL_PROJECTION_LIMITS } from "./types.ts";
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

/**
 * Decodes, or refuses.
 *
 * An earlier version turned an out-of-range or surrogate reference into
 * U+FFFD, which quietly promoted malformed input into a brand-new same-origin
 * URL. A sitemap could then declare thousands of distinct invalid suffixes and
 * have every one of them enter the frontier, filling MAX_SITEMAP_URLS and
 * spending the crawl's budget on targets the site never had. Bad input is not
 * something to repair into a crawlable page: the `<loc>` is dropped instead.
 */
/**
 * XML 1.0's Char production, not merely "a Unicode scalar value".
 *
 * The two are not the same set, and the gap is where an attacker lives: C0
 * controls like `&#1;` and the noncharacters `&#xFFFE;`/`&#xFFFF;` are perfectly
 * good scalars and completely invalid XML. Accepting them let a sitemap mint
 * distinct frontier entries out of references no conforming document could
 * contain. Every character a real sitemap can legally carry is in this set, so
 * narrowing to it drops nothing valid.
 *
 * https://www.w3.org/TR/xml/#charsets
 */
function isXmlChar(code: number): boolean {
  if (!Number.isSafeInteger(code)) return false;
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function decodeXml(value: string): string | null {
  let rejected = false;
  const decoded = value.replace(
    XML_ENTITY,
    (match, numeric?: string, name?: string): string => {
      if (name) return XML_NAMED[name.toLowerCase()] ?? match;
      if (!numeric) return match;

      const isHex = numeric.toLowerCase().startsWith("x");
      const code = Number.parseInt(
        isHex ? numeric.slice(1) : numeric,
        isHex ? 16 : 10,
      );
      if (!isXmlChar(code)) {
        rejected = true;
        return "";
      }
      return String.fromCodePoint(code);
    },
  );
  return rejected ? null : decoded;
}

export interface SitemapDocument {
  readonly isIndex: boolean;
  readonly locs: readonly string[];
  /**
   * The body carried a `<urlset>` or `<sitemapindex>` root.
   *
   * False for anything else — an HTML error page served with 200, a JSON body,
   * a truncated download. That case used to return the same value as a valid
   * sitemap containing no URLs, so a child answering 200 with "404 Not Found"
   * in HTML contributed nothing and left no trace, and the collector went on
   * to certify the surviving members as a complete population. Index coverage
   * divides by that population against a rail that publishes a Blocker.
   */
  readonly isSitemap: boolean;
}

/** Parse one sitemap document into its `<loc>` values and index/urlset kind. */
export function parseSitemapXml(xml: string): SitemapDocument {
  if (!/<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(xml))
    return { isIndex: false, locs: [], isSitemap: false };
  const isIndex = /<(?:\w+:)?sitemapindex\b/i.test(xml);
  const seen = new Set<string>();
  for (const match of xml.matchAll(
    /<(?:\w+:)?loc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?loc\s*>/gi,
  )) {
    const url = decodeXml(match[1] ?? "")?.trim();
    if (url) seen.add(url);
  }
  return { isIndex, locs: [...seen], isSitemap: true };
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
 *
 * Because it degrades silently, it also reports whether it degraded. Every way
 * this function stops early — a child that would not fetch, the document cap,
 * the depth cap, the member cap — removes members without leaving a trace in
 * the count, and a downstream reader cannot tell a small sitemap from a
 * truncated one by looking at its length. Index coverage divides by this list,
 * so a site with four of five children timing out would otherwise publish a
 * rate over the ninth of its pages that answered: `complete` is the difference
 * between a population and a sample that looks like one.
 */
/**
 * A `<loc>` as the document spelled it, resolved to absolute, or null.
 *
 * Resolution only. Everything `canonicalizeUrl` does beyond it — dropping
 * tracking parameters, sorting the query, removing a trailing slash — produces
 * a URL the sitemap did not declare, and this list exists precisely to be
 * handed to a provider that answers about exact URLs.
 */
function exactDeclaredUrl(
  loc: string,
  sameOrigin: (url: string) => boolean,
): string | null {
  let resolved: string;
  try {
    resolved = new URL(loc).toString();
  } catch {
    return null;
  }
  if (!sameOrigin(resolved)) return null;
  if (resolved.length > CRAWL_PROJECTION_LIMITS.maxUrlChars) return null;
  return resolved;
}

export async function collectSitemap(
  origin: string,
  seedUrls: readonly string[],
  deps: SitemapDeps,
): Promise<CrawlSitemapProjection> {
  const members = new Set<string>();
  /**
   * The exact URLs the sitemap declared, deduplicated by exact string.
   *
   * A separate population from `members`, not a parallel array over it. Members
   * are keyed by the aggregation subject, which is the whole point of that key:
   * `/x` and `/x/` are one page to group by. They are two pages to URL
   * Inspection, so a list that keeps one spelling per subject cannot be the
   * population a per-URL provider is asked about — the first attempt at this
   * kept "first spelling wins" and silently dropped one of the two, which is
   * the same shape of loss the flag beside it exists to report.
   */
  const declared = new Set<string>();
  const visited = new Set<string>();
  let fetchedAny = false;
  let documents = 0;
  /** Set the moment anything is dropped, whatever dropped it. */
  let degraded = false;

  const sameOrigin = (url: string): boolean => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };

  const visit = async (sitemapUrl: string, depth: number): Promise<void> => {
    if (depth > MAX_SITEMAP_DEPTH) {
      degraded = true;
      return;
    }
    if (documents >= MAX_SITEMAP_DOCUMENTS) {
      degraded = true;
      return;
    }
    if (members.size >= MAX_SITEMAP_URLS) {
      degraded = true;
      return;
    }
    const key = canonicalizeUrl(sitemapUrl)?.fetchUrl ?? sitemapUrl;
    if (visited.has(key) || !sameOrigin(key)) return;
    visited.add(key);
    documents += 1;

    const body = await deps.fetchText(key);
    if (body === null) {
      // A child that did not answer is members we do not have. Its siblings
      // having answered is exactly what makes this invisible in the count.
      degraded = true;
      return;
    }

    const document = parseSitemapXml(body);
    if (!document.isSitemap) {
      // An origin that answers a missing sitemap with a 200 HTML page has
      // given us nothing, and the transport cannot tell us so — the status was
      // fine. Counting it as fetched and moving on left a whole child's worth
      // of members missing with no trace anywhere in the projection.
      degraded = true;
      return;
    }
    fetchedAny = true;
    if (document.isIndex) {
      for (const child of document.locs) {
        if (members.size >= MAX_SITEMAP_URLS) {
          degraded = true;
          break;
        }
        await visit(child, depth + 1);
      }
      return;
    }
    for (const loc of document.locs) {
      if (members.size >= MAX_SITEMAP_URLS) {
        degraded = true;
        break;
      }
      const pair = canonicalizeUrl(loc);
      // An off-origin or unparseable `<loc>` is not a member of this site's
      // sitemap, so skipping it drops nothing this population contains.
      if (!pair || !sameOrigin(pair.fetchUrl)) continue;
      deps.onMember?.({
        fetchUrl: pair.fetchUrl,
        subjectUrl: pair.subjectUrl,
      });
      // The declared spelling, resolved to absolute and no further. NOT
      // `pair.fetchUrl`: canonicalisation deletes tracking parameters and sorts
      // the query, so a sitemap declaring `?b=2&utm_source=x&a=1` was being
      // recorded as `?a=1&b=2` — a different URL to ask a provider about, under
      // a field whose name promises the one that was declared.
      const exact = exactDeclaredUrl(loc, sameOrigin);
      if (exact !== null) {
        if (declared.size >= MAX_SITEMAP_URLS) {
          degraded = true;
        } else {
          declared.add(exact);
        }
      }
      members.add(pair.subjectUrl);
    }
  };

  for (const seed of seedUrls) await visit(seed, 0);

  const subjectUrls = [...members].sort();
  return {
    fetched: fetchedAny,
    urlCount: subjectUrls.length,
    subjectUrls,
    declaredUrls: [...declared].sort(),
    // Nothing was read at all is not a complete reading of nothing.
    complete: fetchedAny && !degraded,
  };
}
