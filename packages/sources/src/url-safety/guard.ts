import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedHost, isBlockedIp, normaliseIpv4 } from "./classify-ip.ts";
import { normalizeUrl } from "./normalize.ts";

export interface UrlGuardResult {
  readonly safe: boolean;
  readonly normalizedUrl: string | null;
  readonly pinnedIp: string | null;
  readonly reason: string | null;
}

export interface UrlGuardDependencies {
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  readonly dnsTimeoutMs?: number;
}

/** DNS must finish well inside the crawl engine's 30s per-request budget. */
export const DEFAULT_DNS_LOOKUP_TIMEOUT_MS = 5_000;

const DNS_TIMEOUT = Symbol("dns-timeout");

const rejected = (reason: string): UrlGuardResult => ({ safe: false, normalizedUrl: null, pinnedIp: null, reason });

async function lookupWithTimeout(
  lookup: (hostname: string) => Promise<readonly string[]>,
  hostname: string,
  timeoutMs: number,
): Promise<readonly string[] | typeof DNS_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof DNS_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(DNS_TIMEOUT), timeoutMs);
  });
  try {
    // Promise.race attaches handlers to the lookup promise, so a rejection that
    // arrives after the timeout cannot become an unhandled rejection.
    return await Promise.race([lookup(hostname), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createCanonicalUrlGuard(dependencies: UrlGuardDependencies = {}) {
  const lookup = dependencies.lookup ?? (async (hostname: string) => (await dnsLookup(hostname, { all: true })).map((entry) => entry.address));
  const dnsTimeoutMs = dependencies.dnsTimeoutMs ?? DEFAULT_DNS_LOOKUP_TIMEOUT_MS;
  if (!Number.isFinite(dnsTimeoutMs) || dnsTimeoutMs <= 0) {
    throw new RangeError("dnsTimeoutMs must be a positive finite number");
  }
  return async (rawUrl: string): Promise<UrlGuardResult> => {
    const parsed = normalizeUrl(rawUrl);
    if (!parsed) return rejected("URL must be an unambiguous http(s) URL without userinfo");
    // WHATWG drops explicit default ports (HTTP 80 / HTTPS 443). Any remaining
    // port is non-standard and is rejected before DNS or transport so crawls
    // cannot be redirected toward alternate service surfaces.
    if (parsed.url.port !== "") {
      return rejected("Only standard HTTP(S) ports are allowed");
    }
    if (isBlockedHost(parsed.hostname)) return rejected("Cloud metadata hostname is blocked");
    const literal = normaliseIpv4(parsed.hostname) ?? (isIP(parsed.hostname) ? parsed.hostname : null);
    let addresses: readonly string[];
    try {
      if (literal) {
        addresses = [literal];
      } else {
        const resolved = await lookupWithTimeout(lookup, parsed.hostname, dnsTimeoutMs);
        if (resolved === DNS_TIMEOUT) {
          return rejected("DNS resolution timed out (fail closed)");
        }
        addresses = resolved;
      }
    } catch {
      return rejected("DNS resolution failed (fail closed)");
    }
    if (!Array.isArray(addresses) || addresses.length === 0) return rejected("DNS returned no addresses (fail closed)");
    if (addresses.some((address) => typeof address !== "string" || isBlockedIp(address))) return rejected("Resolved address is private, reserved, or metadata");
    const pinnedIp = addresses[0];
    if (!pinnedIp) return rejected("DNS returned no usable address");
    return { safe: true, normalizedUrl: parsed.url.href, pinnedIp, reason: null };
  };
}

/** The canonical URL guard used at every production crawl request/redirect hop. */
export const canonicalUrlGuard = createCanonicalUrlGuard();
