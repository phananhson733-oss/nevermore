/**
 * `canonical_url.v1` (spec §7.6). Produces two stable projections of a URL:
 *
 * - `fetchUrl`  — used for HTTP facts. Keeps a trailing slash and non-tracking
 *   query; this is what Evidence records as the actually-fetched URL.
 * - `subjectUrl` — used for aggregation and stable finding/observation keys, so
 *   slash variants do not create two Findings. Additionally strips the trailing
 *   `/` from a non-root pathname.
 *
 * Both apply: lowercase scheme + host, IDNA (punycode) host, drop the default
 * port, drop the fragment, resolve dot segments, normalize unreserved
 * percent-encoding, empty path → "/", delete `utm_*|gclid|fbclid|msclkid`, and
 * sort the remaining query by (key, value).
 *
 * Pure and deterministic: identical input always yields identical output.
 * Algorithm changes MUST bump the version suffix (spec §7.6).
 */

export const CANONICAL_URL_METHOD_VERSION = "canonical_url.v1";

/** Tracking parameters removed from both fetchUrl and subjectUrl. */
const TRACKING_PARAM_EXACT: ReadonlySet<string> = new Set([
  "gclid",
  "fbclid",
  "msclkid",
]);
const TRACKING_PARAM_PREFIX = "utm_";

export interface CanonicalUrlPair {
  /** HTTP-fact URL: keeps trailing slash + sorted non-tracking query. */
  readonly fetchUrl: string;
  /** Aggregation key: fetchUrl with a non-root trailing slash removed. */
  readonly subjectUrl: string;
}

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith(TRACKING_PARAM_PREFIX) || TRACKING_PARAM_EXACT.has(lower);
}

/**
 * Re-encode a pathname so that percent-encodings of unreserved characters
 * (ALPHA / DIGIT / `-` / `.` / `_` / `~`) are decoded, while everything else is
 * preserved as the WHATWG URL parser emitted it. WHATWG already resolves dot
 * segments and applies path percent-encoding, so we only normalize the
 * unreserved set here (RFC 3986 §6.2.2.2).
 */
function normalizeUnreservedEncoding(component: string): string {
  return component.replace(/%[0-9A-Fa-f]{2}/g, (match) => {
    const codePoint = Number.parseInt(match.slice(1), 16);
    const char = String.fromCharCode(codePoint);
    if (/[A-Za-z0-9\-._~]/.test(char)) return char;
    // Keep the escape but normalize its hex digits to uppercase (RFC 3986 §6.2.2.1).
    return match.toUpperCase();
  });
}

function sortedQuery(search: string): string {
  if (search === "" || search === "?") return "";
  const params = new URLSearchParams(search);
  const kept: [string, string][] = [];
  for (const [key, value] of params) {
    if (isTrackingParam(key)) continue;
    kept.push([key, value]);
  }
  if (kept.length === 0) return "";
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const usp = new URLSearchParams();
  for (const [key, value] of kept) usp.append(key, value);
  return `?${usp.toString()}`;
}

/**
 * Canonicalize `rawUrl`, resolving it against `base` when relative. Returns null
 * when the input is not a parseable http(s) URL.
 */
export function canonicalizeUrl(rawUrl: string, base?: string): CanonicalUrlPair | null {
  let url: URL;
  try {
    url = base ? new URL(rawUrl, base) : new URL(rawUrl);
  } catch {
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") return null;

  // WHATWG URL already lowercases host and applies IDNA; make sure host is lower.
  const host = url.hostname.toLowerCase();
  // url.port is "" for a default port, so it is naturally dropped.
  const authority = url.port ? `${host}:${url.port}` : host;
  const rawPath = url.pathname === "" ? "/" : url.pathname;
  const path = normalizeUnreservedEncoding(rawPath);
  const query = sortedQuery(url.search);

  const fetchUrl = `${protocol}//${authority}${path}${query}`;

  const subjectPath = path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
  const subjectUrl = `${protocol}//${authority}${subjectPath}${query}`;

  return { fetchUrl, subjectUrl };
}

/** The subjectUrl only — the stable aggregation key used by finding subjectRefs. */
export function subjectUrlOf(rawUrl: string, base?: string): string | null {
  return canonicalizeUrl(rawUrl, base)?.subjectUrl ?? null;
}
