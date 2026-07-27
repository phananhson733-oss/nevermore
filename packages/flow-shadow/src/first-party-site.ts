import { normalizeFirstPartyUrl } from "./first-party.ts";

/**
 * Strict project-site ownership.
 *
 * Kept outside `first-party.ts` deliberately: the QA verdict import closure is
 * restricted to relative, dependency-free modules. Manifest construction uses
 * this stricter site-origin parser, while production QA continues to consume
 * only already-frozen first-party identities from `first-party.ts`.
 *
 * No Public Suffix List is needed because ownership is NEVER inferred from a
 * DNS suffix. A subdomain is first-party only after it is frozen as its own
 * verified site origin (or as an exact first-party PageSnapshot identity).
 */

interface ParsedSiteUrl {
  readonly parsed: URL;
  readonly hostname: string;
}

function parsedSiteUrl(
  raw: string | null | undefined,
): ParsedSiteUrl | null {
  const normalized = normalizeFirstPartyUrl(raw);
  if (normalized === null) return null;
  const parsed = new URL(normalized);
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/\.$/u, "");
  return { parsed, hostname };
}

function isDottedDnsHostname(hostname: string): boolean {
  if (
    hostname.length > 253 ||
    !hostname.includes(".") ||
    hostname.includes(":")
  ) {
    return false;
  }
  const labels = hostname.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    return false;
  }
  // WHATWG URL canonicalizes every accepted IPv4 spelling to dotted decimal.
  // An IP literal is an address, not the explicit DNS site identity required
  // by the frozen project record.
  return !labels.every((label) => /^\d+$/u.test(label));
}

/**
 * Normalize the required project site ORIGIN.
 *
 * It must be exactly an http(s) origin with a dotted DNS hostname. This parser
 * intentionally makes no registrable-domain claim: the site record is the
 * explicit ownership grant, and that grant covers only its exact hostname.
 */
export function normalizeFirstPartySiteOrigin(
  raw: string | null | undefined,
): string | null {
  const normalized = parsedSiteUrl(raw);
  if (normalized === null) return null;
  const { parsed, hostname } = normalized;
  if (
    parsed.pathname !== "/" ||
    parsed.href !== `${parsed.origin}/` ||
    !isDottedDnsHostname(hostname)
  ) {
    return null;
  }
  // URL canonicalizes protocol/host case and default ports. Remove the DNS root
  // dot too so equivalent fully-qualified spellings hash to the same origin.
  parsed.hostname = hostname;
  return parsed.origin;
}

/**
 * Whether a page URL is controlled by the frozen project site.
 *
 * Ownership is host-based: protocol changes and default-port spellings do not
 * change who controls a hostname. Only the exact verified hostname is owned;
 * sibling, child, prefix-lookalike and suffix-lookalike hosts must never become
 * first-party evidence by inference. Both URLs pass the same
 * absolute-http(s)/no-userinfo parser first.
 */
export function isUrlOwnedByFirstPartySite(
  siteOrigin: string,
  candidateUrl: string,
): boolean {
  const normalizedSiteOrigin = normalizeFirstPartySiteOrigin(siteOrigin);
  const site =
    normalizedSiteOrigin === null
      ? null
      : parsedSiteUrl(normalizedSiteOrigin);
  const candidate = parsedSiteUrl(candidateUrl);
  if (site === null || candidate === null) return false;
  return candidate.hostname === site.hostname;
}
