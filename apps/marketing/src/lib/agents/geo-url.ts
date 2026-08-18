// @input  -- raw provider citation URLs and visitor-entered site addresses
// @output -- one canonical host rule and one canonical citation-URL rule
// @pos    -- the single URL normalization the producer and the strict guard share

/**
 * Why both rules live here rather than beside their callers.
 *
 * The sampler decides whether a citation belongs to the customer's site and the
 * guard then re-checks that decision. When each had its own copy of "reduce this
 * to a host", a doubled `www.` and a trailing DNS root dot produced a host the
 * guard refused, and twenty-four already-billed answers were discarded over a
 * spelling. One function, imported by both, is the fix — and the same argument
 * applies to the citation URL itself now that the report keeps exact links
 * instead of bare hosts.
 */

/**
 * Longest citation URL the report will carry.
 *
 * The same bound the exported handoff packet enforces, so a link that survives
 * the report cannot fail the packet later and silently disappear from the
 * evidence a user was shown.
 */
export const GEO_MAX_URL_LENGTH = 2_048;

/**
 * Reduce a URL or a bare host to the canonical host the report compares on.
 *
 * `www.` is stripped repeatedly and the DNS root dot removed, because a
 * target-host comparison that fails on `www.www.acme.test` or `acme.test.` is
 * indistinguishable from a site that was genuinely not cited — the exact
 * confusion this report exists to remove. Lowercasing and punycode come from
 * the WHATWG parser for anything that carries a scheme; a bare host is
 * lowercased here and otherwise left alone, because a bare host is what the
 * visitor typed and the server re-derives it from the URL anyway.
 */
export function normalizeGeoHost(value: string): string | null {
  let hostname: string;
  if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    hostname = parsed.hostname;
  } else {
    hostname = value;
  }

  let host = hostname.toLowerCase().replace(/\.+$/u, "");
  while (host.startsWith("www.")) host = host.slice(4);
  if (
    host.length === 0 ||
    host.length > 253 ||
    !host.includes(".") ||
    host.includes("/") ||
    host.includes(":") ||
    host.includes(" ")
  ) {
    return null;
  }
  return host;
}

/** Exactly the shape {@link normalizeGeoHost} produces, and nothing else. */
export function isNormalizedGeoHost(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    normalizeGeoHost(value) === value
  );
}

/**
 * Canonicalize a provider citation URL without discarding what it identifies.
 *
 * WHATWG parsing does the parts that are genuinely equivalence-preserving:
 * scheme and host case, punycode, default-port removal, dot-segment resolution,
 * percent-encoding. Everything else is left exactly as the provider returned it,
 * including the query string and the fragment — the report's claim is that this
 * is the link the answer cited, and a report that quietly rewrote it to a
 * shorter one would be showing a link the model never gave. The export packet
 * strips query and fragment separately, at the boundary where a URL leaves the
 * user's screen and reaches another agent.
 *
 * Credentials are refused rather than stripped: a URL carrying userinfo is not
 * a citation, and rewriting it into one would hide where it came from.
 */
export function normalizeGeoCitationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > GEO_MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.hostname === "") return null;
  // Every citation the report keeps must also have a comparable host, so a URL
  // whose host cannot be canonicalized is refused here rather than surviving
  // into evidence with a null domain the ownership rule cannot evaluate.
  if (normalizeGeoHost(parsed.href) === null) return null;

  const href = parsed.href;
  return href.length > GEO_MAX_URL_LENGTH ? null : href;
}

/** Exactly the shape {@link normalizeGeoCitationUrl} produces, and nothing else. */
export function isNormalizedGeoCitationUrl(value: unknown): value is string {
  return typeof value === "string" && normalizeGeoCitationUrl(value) === value;
}

/**
 * The canonical host of an already-normalized citation URL.
 *
 * Always recomputed from the URL. A `domain` field carried alongside the URL and
 * trusted separately is a field that can disagree with the link beside it, and
 * the disagreement would land in the one place the report claims to be exact.
 */
export function geoCitationDomain(normalizedUrl: string): string | null {
  return normalizeGeoHost(normalizedUrl);
}

/**
 * Whether a citation belongs to the site under test.
 *
 * Exact canonical-host equality, and nothing looser. A subdomain is not
 * automatically owned — `status.acme.test` may be a vendor's status page and
 * `blog.acme.test` may be a hosted platform — and treating it as owned would
 * turn somebody else's page into evidence that the customer was cited.
 */
export function isGeoTargetCitation(
  normalizedUrl: string,
  targetHost: string,
): boolean {
  return geoCitationDomain(normalizedUrl) === targetHost;
}
