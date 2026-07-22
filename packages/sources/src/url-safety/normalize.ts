import { isIP } from "node:net";
import { normaliseIpv4 } from "./classify-ip.ts";

export interface NormalizedUrl {
  readonly url: URL;
  readonly hostname: string;
}

/**
 * Parse only http(s), remove credentials, and normalise ambiguous IPv4 forms.
 *
 * This is a transport-safety normalizer, not an aggregation canonicalizer. A
 * non-root trailing slash can select a different HTTP resource and therefore
 * must be preserved here. Slash folding belongs exclusively to
 * `canonicalizeUrl(...).subjectUrl`.
 */
export function normalizeUrl(rawUrl: string): NormalizedUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  if (parsed.username || parsed.password) return null;
  const normalizedIpv4 = normaliseIpv4(parsed.hostname);
  if (normalizedIpv4) parsed.hostname = normalizedIpv4;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || (isIP(hostname) === 0 && hostname.includes("%"))) return null;
  return { url: parsed, hostname };
}
