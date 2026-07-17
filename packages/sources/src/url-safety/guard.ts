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
}

const rejected = (reason: string): UrlGuardResult => ({ safe: false, normalizedUrl: null, pinnedIp: null, reason });

export function createCanonicalUrlGuard(dependencies: UrlGuardDependencies = {}) {
  const lookup = dependencies.lookup ?? (async (hostname: string) => (await dnsLookup(hostname, { all: true })).map((entry) => entry.address));
  return async (rawUrl: string): Promise<UrlGuardResult> => {
    const parsed = normalizeUrl(rawUrl);
    if (!parsed) return rejected("URL must be an unambiguous http(s) URL without userinfo");
    if (isBlockedHost(parsed.hostname)) return rejected("Cloud metadata hostname is blocked");
    const literal = normaliseIpv4(parsed.hostname) ?? (isIP(parsed.hostname) ? parsed.hostname : null);
    let addresses: readonly string[];
    try {
      addresses = literal ? [literal] : await lookup(parsed.hostname);
    } catch {
      return rejected("DNS resolution failed (fail closed)");
    }
    if (addresses.length === 0) return rejected("DNS returned no addresses (fail closed)");
    if (addresses.some((address) => isBlockedIp(address))) return rejected("Resolved address is private, reserved, or metadata");
    const pinnedIp = addresses[0];
    if (!pinnedIp) return rejected("DNS returned no usable address");
    return { safe: true, normalizedUrl: parsed.url.href, pinnedIp, reason: null };
  };
}

/** The canonical URL guard used at every production crawl request/redirect hop. */
export const canonicalUrlGuard = createCanonicalUrlGuard();
