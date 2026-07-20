import { normalizeUrl } from "./url-safety/index.ts";

/**
 * The storable site origin plus host, derived for createProject (spec §6.1).
 *
 * This is a thin composition over the vendored url-safety primitives: it does
 * NOT re-implement scheme/credential/ambiguous-IPv4 validation — normalizeUrl
 * owns that. The SSRF DNS-resolution check and per-redirect re-validation are
 * performed separately via the canonical guard at fetch time (a later WP).
 */
export interface NormalizedOrigin {
  readonly origin: string;
  readonly host: string;
}

/**
 * Normalize a raw site URL into its persistable { origin, host }.
 *
 * Returns null when the input is not an unambiguous http(s) URL without
 * userinfo, or when it contains a non-root path/query/fragment that an
 * origin-only Site record could not preserve honestly. On success:
 * - `origin`: `scheme://host` with any non-default port, a lowercase host, and
 *   no path or trailing slash (e.g. "https://example.com", "http://host:8080").
 * - `host`: the lowercase hostname.
 */
export function normalizeSiteOrigin(rawUrl: string): NormalizedOrigin | null {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return null;
  const { url } = normalized;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const protocol = url.protocol.toLowerCase();
  // url.port is "" for the scheme's default port (80/443), so those are dropped.
  const origin = url.port ? `${protocol}//${host}:${url.port}` : `${protocol}//${host}`;
  return { origin, host };
}
