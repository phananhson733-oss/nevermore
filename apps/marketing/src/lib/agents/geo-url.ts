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

/** The shape a single DNS label can actually have. */
const GEO_HOST_LABEL = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u;

/**
 * Hosts a visitor cannot be asking us to measure.
 *
 * The same set the server's admission check refuses. Kept here as a literal
 * rather than imported from it: that module reaches `node:net`, which cannot
 * enter the browser bundle, and confirmation runs in the browser.
 */
const GEO_RESERVED_TARGET_HOSTS: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "example.com",
  "example.net",
  "example.org",
  "test.com",
  "test.org",
]);

/**
 * Whether a host could be a site someone actually publishes.
 *
 * Deliberately mirrors what the run endpoint will accept. A host that passes
 * here and fails there puts the visitor back where this helper started: through
 * confirmation, through eight generated questions, and only then refused.
 */
function isRoutableGeoTargetHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  // An IPv6 literal keeps its brackets; an IPv4 one is all digits and dots by
  // the time the parser is done with it, including the `0x7f000001` spellings.
  if (host.startsWith("[") || /^[\d.]+$/u.test(host)) return false;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  if (GEO_RESERVED_TARGET_HOSTS.has(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => GEO_HOST_LABEL.test(label))) return false;
  const tld = labels[labels.length - 1] ?? "";
  // An internationalized TLD reaches here in its ASCII form, which carries
  // `xn--` and digits by construction, so an alphabetic-only rule would refuse
  // every `.公司` and `.中国` site while the run endpoint accepts them.
  return /^[a-z]{2,}$/u.test(tld) || /^xn--[a-z\d-]{2,}$/u.test(tld);
}

/**
 * Normalize the site the visitor typed, which is not a citation.
 *
 * A citation always arrives from the provider with a scheme, so
 * {@link normalizeGeoCitationUrl} requires one. A person typing their own site
 * types `acme.com`, which is what this field's placeholder shows and what the
 * sibling public tools accept, and reusing the citation rule here rejected it —
 * two steps after it was entered, with the reason rendered off-screen.
 *
 * Only a missing scheme is supplied. A value that already declares one keeps it,
 * so `javascript:` and `ftp://` still fail the http/https check rather than
 * being rewritten into something that passes.
 *
 * Supplying a scheme is not enough on its own, because the URL parser is
 * forgiving in ways that turn typing mistakes into billable runs: it accepts
 * `.com` and `foo..bar` as hosts, strips a control character out of the middle
 * of one, and rewrites backslashes into slashes. The raw text is screened
 * before it is parsed and the resulting host has to look like a name someone
 * could publish.
 */
export function normalizeGeoTargetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Checked before the parser sees it. `acme.\ncom` would otherwise be silently
  // recorded as `acme.com` — a target the visitor never typed — and
  // `\\evil.com/path` would become `https://evil.com/path`. Invisible format
  // characters are screened for the same reason and are the likelier arrival:
  // a domain pasted out of a document carries a zero-width joiner or a word
  // joiner, and the parser drops it without saying so. Ordinary spaces are not
  // screened here: the parser percent-encodes one in a path or query, which is
  // a link a visitor can legitimately paste, and a space inside the host is
  // caught by the label check instead.
  // eslint-disable-next-line no-control-regex -- screening control characters out is the point: the parser drops them silently and would record a target the visitor never typed.
  if (/[\u0000-\u001f\u007f\\\p{Cf}\u034f\u180e]/u.test(trimmed)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const normalized = normalizeGeoCitationUrl(candidate);
  if (normalized === null) return null;
  // A citation may carry a port; a target may not, because the run endpoint
  // refuses one. Accepting it here would confirm a site that cannot be run.
  if (new URL(normalized).port !== "") return null;
  const host = normalizeGeoHost(normalized);
  if (host === null || !isRoutableGeoTargetHost(host)) return null;
  return normalized;
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
