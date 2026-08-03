// @input  -- URL string
// @output -- validateUrlPattern(), isPrivateHost()
// @pos    -- shared URL validation logic, used by frontend + backend
// Once this file is updated, update the header comment and the folder _DIR.md

// ---------------------------------------------------------------------------
// IPv4 obfuscation normalizer (SSRF defense)
// ---------------------------------------------------------------------------
// Node's fetch() resolves hostnames through the OS resolver, which accepts
// obfuscated IPv4 forms that attackers use to bypass naive regex checks:
//   - dotted-decimal:     127.0.0.1         → 127.0.0.1
//   - hex:                0x7f000001        → 127.0.0.1
//   - octal:              0177.0.0.1        → 127.0.0.1
//   - decimal integer:    2130706433        → 127.0.0.1
//   - short form:         127.1             → 127.0.0.1 (A.D)
//                         127.0.1           → 127.0.0.1 (A.B.D)
// parseObfuscatedIpv4 returns a canonical dotted-decimal string (or null if
// the hostname is not an IPv4 literal in any form).

function parseIpv4Part(raw: string): number | null {
  if (raw.length === 0) return null;
  // Hex
  if (/^0x[0-9a-f]+$/i.test(raw)) {
    const n = Number.parseInt(raw, 16);
    return Number.isFinite(n) ? n : null;
  }
  // Octal (leading 0, digits 0-7 only)
  if (raw.length > 1 && raw.startsWith("0") && /^[0-7]+$/.test(raw)) {
    const n = Number.parseInt(raw, 8);
    return Number.isFinite(n) ? n : null;
  }
  // Decimal
  if (/^[0-9]+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ipNumberToDotted(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join(".");
}

/** Return the canonical dotted-decimal form of an IPv4 hostname in any common
 *  obfuscation (hex, octal, integer, short form, IPv4-mapped IPv6). Returns
 *  null when the hostname is not an IPv4 address of any form. */
export function parseObfuscatedIpv4(hostname: string): string | null {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1, [::ffff:a.b.c.d])
  const mapped = hostname.match(/^(?:\[)?::ffff:([0-9a-f:.]+)(?:\])?$/i);
  if (mapped) {
    // Try dotted-decimal tail first
    const tail = mapped[1];
    const dotted = parseObfuscatedIpv4(tail);
    if (dotted) return dotted;
    // Try hex:hex tail (:: ffff : 7f00 : 0001)
    const hexPair = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexPair) {
      const hi = Number.parseInt(hexPair[1], 16);
      const lo = Number.parseInt(hexPair[2], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return ipNumberToDotted((hi << 16) | lo);
      }
    }
    return null;
  }

  // Strip brackets if present
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const values: number[] = [];
  for (const p of parts) {
    const v = parseIpv4Part(p);
    if (v === null) return null;
    values.push(v);
  }
  // Reject any part that's not an integer in [0, 2^32)
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) return null;
  }
  let ip: number;
  if (values.length === 4) {
    if (values.some((v) => v > 0xff)) return null;
    ip = (values[0] << 24) | (values[1] << 16) | (values[2] << 8) | values[3];
  } else if (values.length === 3) {
    // A.B.D  → A.B.(D>>8).(D&0xff)
    if (values[0] > 0xff || values[1] > 0xff || values[2] > 0xffff) return null;
    ip = (values[0] << 24) | (values[1] << 16) | values[2];
  } else if (values.length === 2) {
    // A.D  → A.(D>>16).(D>>8 & 0xff).(D & 0xff)
    if (values[0] > 0xff || values[1] > 0xffffff) return null;
    ip = (values[0] << 24) | values[1];
  } else {
    // Single integer form: 2130706433
    ip = values[0];
  }
  return ipNumberToDotted(ip >>> 0);
}

function ipv4IsPrivate(dotted: string): boolean {
  const [a, b] = dotted.split(".").map(Number);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8 current network
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. AWS metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/** Block requests to private/reserved IP ranges (SSRF protection). Handles
 *  obfuscated IPv4 forms (hex, octal, integer, short), IPv4-mapped IPv6, and
 *  common IPv6 private prefixes. */
export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Known cloud metadata endpoints
  if (lower === "169.254.169.254" || lower === "metadata.google.internal") {
    return true;
  }

  // Any IPv4 form (normalized)
  const canonical = parseObfuscatedIpv4(lower);
  if (canonical !== null) {
    return ipv4IsPrivate(canonical);
  }

  // Localhost aliases
  if (
    lower === "localhost" ||
    lower.endsWith(".local") ||
    lower.endsWith(".localhost")
  ) {
    return true;
  }

  // IPv6 loopback/private/link-local
  if (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") || // unique local
    lower.startsWith("fd") ||
    lower.startsWith("fe80") || // link-local
    lower.startsWith("ff") // multicast
  ) {
    return true;
  }

  return false;
}

/** Check if hostname is a bare IP address (any form). */
function isIpAddress(hostname: string): boolean {
  return parseObfuscatedIpv4(hostname) !== null || hostname.includes(":");
}

/** Example/reserved domains that should be rejected */
const EXAMPLE_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "test.org",
  "localhost.com",
]);

export interface UrlValidationResult {
  readonly valid: boolean;
  readonly errorKey: string | null;
}

/**
 * Validate URL patterns beyond basic syntax.
 * Returns an i18n error key if invalid, null if valid.
 * Error keys map to app.products.url* i18n keys.
 */
export function validateUrlPattern(url: string): UrlValidationResult {
  // 1. Basic URL parsing
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, errorKey: "productUrlInvalid" };
  }

  // 2. Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, errorKey: "productUrlInvalid" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Localhost check
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return { valid: false, errorKey: "urlLocalhost" };
  }

  // 4. Private/internal IP check (covers all IPv4 obfuscation forms)
  if (isPrivateHost(hostname)) {
    return { valid: false, errorKey: "urlPrivateIp" };
  }

  // 5. Bare IP address check (public IPs are also not product URLs)
  if (isIpAddress(hostname)) {
    return { valid: false, errorKey: "urlIpAddress" };
  }

  // 6. Must have a TLD (at least one dot)
  if (!hostname.includes(".")) {
    return { valid: false, errorKey: "urlNoTld" };
  }

  // 6b. Explicit port. The guarded transport that performs the reachability
  // check only speaks to standard HTTP(S) ports, so a port here would come back
  // as "blocked" — which renders as "private IP address", a message that is
  // simply untrue for https://acme.com:8443. Say the real reason instead.
  if (parsed.port) {
    return { valid: false, errorKey: "urlPort" };
  }

  // 7. Example/reserved domains
  if (EXAMPLE_DOMAINS.has(hostname)) {
    return { valid: false, errorKey: "urlExample" };
  }

  return { valid: true, errorKey: null };
}
