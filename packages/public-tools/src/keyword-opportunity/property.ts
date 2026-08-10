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
 * Pick the property to read this site's Search Console queries from.
 *
 * Search Console is addressed by property identifier — `sc-domain:acme.com`
 * or the exact URL prefix the property was verified at — never by an
 * arbitrary site URL. The first live run passed the visitor's typed URL
 * straight through, so every read was refused and the coverage stage went
 * silently unavailable on every run.
 *
 * Domain properties are preferred over URL-prefix ones covering the same site
 * because a domain property is a strict superset: it carries http, https and
 * every subdomain, so it yields the fuller query sample. Within each kind the
 * most specific match wins — a grant holding both `sc-domain:acme.com` and
 * `sc-domain:blog.acme.com` should read the blog's own property for a blog
 * URL rather than the parent's mixed traffic.
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

    // A URL-prefix property covers exactly the URLs beginning with it, scheme
    // and all. Compared on a trailing slash so `https://acme.com/blog` cannot
    // claim `https://acme.com/blogging`.
    const propertyUrl = hostOf(property) === null ? null : property;
    if (propertyUrl === null) continue;
    const normalizedProperty = propertyUrl.endsWith("/")
      ? propertyUrl
      : `${propertyUrl}/`;
    const normalizedSite = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
    if (
      normalizedSite
        .toLowerCase()
        .startsWith(normalizedProperty.toLowerCase()) &&
      normalizedProperty.length > prefixLength
    ) {
      prefixMatch = property;
      prefixLength = normalizedProperty.length;
    }
  }

  return domainMatch ?? prefixMatch;
}
