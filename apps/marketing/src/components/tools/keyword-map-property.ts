// @input  -- a Search Console property identifier from the visitor's grant
// @output -- the site URL to crawl for it, or null when it cannot be derived
// @pos    -- pairs the property the coverage stage reads with the site the crawl fetches
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

const DOMAIN_PREFIX = "sc-domain:";

/**
 * The site URL to offer for a granted property.
 *
 * The two stages need different things from the same choice: the crawl wants a
 * URL it can fetch, and the coverage read wants the property identifier. Both
 * come from one selection so a visitor cannot end up asking about a site their
 * grant does not cover — which produces a run whose headline stage is silently
 * missing, and no wording on the result explains it as well as never offering
 * the mismatch does.
 *
 * A domain property names a host and nothing else, so the scheme here is a
 * guess: https, no `www`. It is the right guess for most sites and the wrong
 * one for some, which is why the field it fills is editable rather than fixed.
 * A URL-prefix property already is a URL and is returned unchanged.
 */
export function keywordMapSiteUrl(property: string): string | null {
  if (property.startsWith(DOMAIN_PREFIX)) {
    const domain = property.slice(DOMAIN_PREFIX.length).trim();
    return domain === "" ? null : `https://${domain}`;
  }
  try {
    const url = new URL(property);
    return url.protocol === "https:" || url.protocol === "http:"
      ? property
      : null;
  } catch {
    return null;
  }
}
