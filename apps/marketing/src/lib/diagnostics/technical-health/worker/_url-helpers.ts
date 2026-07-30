// @input  -- URL strings (link + base) — no I/O, no external deps
// @output -- normalizeUrlForDedup(url), stripWww(hostname),
//            isSameOrigin(url, originUrl), isSameSite(url, originUrl)
// @pos    -- D1 Phase 2 chunk 2a — shared URL helpers extracted from
//            page-fetcher / bfs-crawler / page-sampler triplication (PR #87
//            review HIGH-1). Hosts the deliberate divergence between strict
//            isSameOrigin (BFS frontier discipline) and relaxed isSameSite
//            (page-fetcher outlink discovery) in one place.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Plan §D-5 URL normalization: strip fragment, sort query params.
 * Two URLs differing only by fragment, query order, or host case collapse
 * to a single key. Returns the input unchanged when URL parsing fails so
 * downstream callers can still surface bad input through dedup sets.
 */
export function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const sorted = new URLSearchParams(
      [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    u.search = sorted.toString();
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Strip a leading `www.` label from a hostname. Used by `isSameSite` to
 * treat `www.example.com` and `example.com` as the same logical site.
 * Returns the input unchanged when no prefix is present.
 */
export function stripWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * STRICT same-origin: scheme + hostname + port must all match exactly.
 * Used by the BFS crawler (frontier discipline) and the page-sampler
 * (sitemap outbound-SSRF defense) where a port mismatch represents a
 * different application surface and must NOT be entered.
 *
 * Divergence note: `isSameSite` (used by page-fetcher for internal-outlink
 * discovery) is intentionally laxer — it ignores ports and `www.` prefixes
 * because conceptual "internal links" still count even when a CMS emits
 * port-variants of the same site. Do not collapse the two predicates: BFS
 * needs strictness; outlink graph needs leniency. Each call site documents
 * which contract it depends on.
 *
 * URL parse failures fail closed (returns false).
 */
export function isSameOrigin(url: string, originUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(originUrl).origin;
  } catch {
    return false;
  }
}

/**
 * RELAXED same-site: same scheme + same stripped-www hostname, port-agnostic.
 * Used by page-fetcher when collecting `internalOutlinks` from a parsed page
 * — the intent is "links that conceptually belong to this site", which
 * survives www-vs-no-www mismatches and port differences (CDN edges, dev
 * environments). For SSRF-defense decisions about whether to FETCH a URL,
 * use `isSameOrigin` instead — same-site is too permissive for that.
 *
 * Divergence note: see `isSameOrigin` JSDoc above. The two predicates
 * deliberately disagree on:
 *   - `https://example.com:8080/` vs `https://example.com/`
 *     → isSameSite: true   |  isSameOrigin: false
 *   - `https://www.example.com/` vs `https://example.com/`
 *     → isSameSite: true   |  isSameOrigin: false
 *
 * URL parse failures fail closed (returns false).
 */
export function isSameSite(url: string, originUrl: string): boolean {
  try {
    const link = new URL(url);
    const base = new URL(originUrl);
    return (
      link.protocol === base.protocol &&
      stripWww(link.hostname) === stripWww(base.hostname)
    );
  } catch {
    return false;
  }
}
