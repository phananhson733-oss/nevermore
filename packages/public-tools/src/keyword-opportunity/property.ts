// @input  -- the site the visitor asked about and the properties their grant covers
// @output -- the one Search Console property to read that site's queries from, or null
// @pos    -- the only place a site URL becomes a property identifier; also the ownership check
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** Prefix Search Console puts on a domain property. */
const DOMAIN_PREFIX = "sc-domain:";

function hostOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/**
 * Normalize a bare domain the way `hostOf` normalizes a URL's host.
 *
 * Both sides go through the URL parser so an internationalized domain is
 * compared in one encoding. `例え.jp` parses to `xn--r8jz45g.jp`, which is
 * what the Search Console API returns; comparing the two literally would miss
 * every non-ASCII domain and report the coverage stage unread for a visitor
 * who does hold the property.
 */
function normalizeDomain(domain: string): string | null {
  // A domain property holds a host and nothing else. Rejecting the separators
  // first matters because the URL parser would quietly discard whatever
  // follows them rather than refuse the string.
  if (domain === "" || /[/?#@:]/.test(domain)) return null;
  return hostOf(`https://${domain}`);
}

/** Whether `host` is the domain itself or one of its subdomains. */
function coversHost(domain: string, host: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Whether a URL-prefix property contains the site, per the URL standard.
 *
 * Scheme, host and port are compared case-insensitively because the parser has
 * already normalized them; the PATH is compared case-sensitively, because
 * paths are. Lowercasing the whole URL — which this did at first — lets a
 * property verified at `/blog/` claim `/Blog/x`, a different resource whose
 * queries are not in that property.
 *
 * The boundary is a trailing slash, so `/blog` cannot claim `/blogging`.
 */
function prefixCovers(property: URL, site: URL): boolean {
  if (property.protocol !== site.protocol) return false;
  if (property.host !== site.host) return false;
  const propertyPath = property.pathname.endsWith("/")
    ? property.pathname
    : `${property.pathname}/`;
  const sitePath = site.pathname.endsWith("/")
    ? site.pathname
    : `${site.pathname}/`;
  return sitePath.startsWith(propertyPath);
}

/**
 * Pick the property to read this site's Search Console queries from.
 *
 * Search Console is addressed by property identifier — `sc-domain:acme.com`
 * or the exact URL prefix the property was verified at — never by an
 * arbitrary site URL. The first live run passed the visitor's typed URL
 * straight through, so every read was refused and the coverage stage went
 * silently unavailable on every run.
 *
 * The NARROWEST covering property wins, and that is the whole judgement here.
 * The coverage read asks for `dimensions: ["query"]` with no page filter, so
 * whatever property is named returns every query that property serves. A
 * domain property covers both schemes and every subdomain, so reading
 * `sc-domain:acme.com` to answer a question about `blog.acme.com` attributes
 * the main site's queries to the blog — and coverage that reads as "already
 * served" does not merely mislabel a row, it deletes it from the table. An
 * over-broad property is therefore worse than a narrow one, not richer.
 *
 * So URL-prefix properties are preferred over domain properties, and within
 * each kind the most specific match wins: the longest matching prefix, or the
 * most specific domain a grant holds for the host.
 *
 * Returning null is the honest answer for "this visitor's grant covers no
 * property for this site", which is also the ownership check: without a match
 * there is no property whose queries we are entitled to read, and the caller
 * must report the coverage stage as unread rather than substitute an empty
 * result.
 */
export function keywordCoverageProperty(
  siteUrl: string,
  properties: readonly string[],
): string | null {
  const host = hostOf(siteUrl);
  if (host === null) return null;
  const site = new URL(siteUrl);

  let domainMatch: string | null = null;
  let domainLength = -1;
  let prefixMatch: string | null = null;
  let prefixLength = -1;

  for (const property of properties) {
    if (property.startsWith(DOMAIN_PREFIX)) {
      const domain = normalizeDomain(property.slice(DOMAIN_PREFIX.length));
      if (domain !== null && coversHost(domain, host)) {
        if (domain.length > domainLength) {
          domainMatch = property;
          domainLength = domain.length;
        }
      }
      continue;
    }

    if (hostOf(property) === null) continue;
    const propertyUrl = new URL(property);
    if (
      prefixCovers(propertyUrl, site) &&
      propertyUrl.pathname.length > prefixLength
    ) {
      prefixMatch = property;
      prefixLength = propertyUrl.pathname.length;
    }
  }

  return prefixMatch ?? domainMatch;
}
