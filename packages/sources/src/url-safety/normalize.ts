import { isIP } from "node:net";
import { normaliseIpv4 } from "./classify-ip.ts";

export interface NormalizedUrl {
  readonly url: URL;
  readonly hostname: string;
}

/** Parse only http(s), remove credentials, and normalise ambiguous IPv4 forms. */
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
  // Spec §6.1 trailing-slash normalization (added during vendor-copy): strip a
  // trailing slash from a NON-root pathname so equivalent origins compare equal.
  // Root "/" is left untouched to preserve the URL object's root semantics.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  const normalizedIpv4 = normaliseIpv4(parsed.hostname);
  if (normalizedIpv4) parsed.hostname = normalizedIpv4;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || (isIP(hostname) === 0 && hostname.includes("%"))) return null;
  return { url: parsed, hostname };
}
