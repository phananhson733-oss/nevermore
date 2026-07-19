import { isIP } from "node:net";

const METADATA_HOSTS = new Set(["metadata.google.internal"]);
const METADATA_IPS = new Set(["169.254.169.254", "fd00:ec2::254"]);

function parsePart(value: string): number | null {
  if (!value) return null;
  const base = /^0x/i.test(value) ? 16 : value.length > 1 && value.startsWith("0") ? 8 : 10;
  if (base === 8 && !/^0[0-7]+$/.test(value)) return null;
  if (base === 10 && !/^\d+$/.test(value)) return null;
  if (base === 16 && !/^0x[0-9a-f]+$/i.test(value)) return null;
  const parsed = Number.parseInt(value, base);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Supports dotted, abbreviated, octal, hexadecimal and integer IPv4 forms. */
export function normaliseIpv4(host: string): string | null {
  if (!host || host.includes(":")) return null;
  const parts = host.split(".");
  if (parts.length > 4) return null;
  const values = parts.map(parsePart);
  if (values.some((value) => value === null)) return null;
  const numbers = values as number[];
  let value: number;
  if (numbers.length === 1) value = numbers[0] ?? -1;
  else if (numbers.length === 2) {
    if ((numbers[0] ?? 256) > 255 || (numbers[1] ?? 2 ** 24) >= 2 ** 24) return null;
    value = ((numbers[0] ?? 0) * 2 ** 24) + (numbers[1] ?? 0);
  } else if (numbers.length === 3) {
    if ((numbers[0] ?? 256) > 255 || (numbers[1] ?? 256) > 255 || (numbers[2] ?? 2 ** 16) >= 2 ** 16) return null;
    value = ((numbers[0] ?? 0) * 2 ** 24) + ((numbers[1] ?? 0) * 2 ** 16) + (numbers[2] ?? 0);
  } else {
    if (numbers.some((part) => part > 255)) return null;
    value = ((numbers[0] ?? 0) * 2 ** 24) + ((numbers[1] ?? 0) * 2 ** 16) + ((numbers[2] ?? 0) * 256) + (numbers[3] ?? 0);
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function ipv4Number(ip: string): number | null {
  const normalised = normaliseIpv4(ip);
  if (!normalised) return null;
  return normalised.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function inV4Cidr(ip: string, base: string, prefix: number): boolean {
  const value = ipv4Number(ip);
  const start = ipv4Number(base);
  if (value === null || start === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (start & mask);
}

function ipv6BigInt(ip: string): bigint | null {
  const lower = ip.toLowerCase();
  if (lower.includes(".")) {
    const before = lower.slice(0, lower.lastIndexOf(":") + 1);
    const mapped = normaliseIpv4(lower.slice(lower.lastIndexOf(":") + 1));
    if (!mapped) return null;
    const chunks = mapped.split(".").map(Number);
    return ipv6BigInt(`${before}${((chunks[0] ?? 0) * 256 + (chunks[1] ?? 0)).toString(16)}:${((chunks[2] ?? 0) * 256 + (chunks[3] ?? 0)).toString(16)}`);
  }
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (left.length + right.length > 8) return null;
  const chunks = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (chunks.length !== 8 || chunks.some((chunk) => !/^[0-9a-f]{1,4}$/i.test(chunk))) return null;
  return chunks.reduce((value, chunk) => (value << 16n) + BigInt(`0x${chunk}`), 0n);
}

function inV6Cidr(ip: string, base: string, prefix: number): boolean {
  const value = ipv6BigInt(ip);
  const start = ipv6BigInt(base);
  if (value === null || start === null) return false;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return (value & mask) === (start & mask);
}

/** IPv4-mapped IPv6 is classified using its embedded IPv4 address. */
export function mappedIpv4(ip: string): string | null {
  const value = ipv6BigInt(ip);
  if (value === null || (value >> 32n) !== 0xffffn) return null;
  const v4 = Number(value & 0xffffffffn);
  return [(v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join(".");
}

export function isBlockedHost(host: string): boolean {
  return METADATA_HOSTS.has(host.toLowerCase());
}

export function isBlockedIp(ip: string): boolean {
  const mapped = mappedIpv4(ip);
  if (mapped) return isBlockedIp(mapped);
  if (METADATA_IPS.has(ip.toLowerCase())) return true;
  if (isIP(ip) === 4) {
    return [
      ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16],
      ["127.0.0.0", 8], ["169.254.0.0", 16], ["0.0.0.0", 8], ["100.64.0.0", 10],
      // RFC 6890 special-purpose, documentation, benchmarking, multicast,
      // and future-reserved ranges do not provide public egress evidence.
      ["192.0.0.0", 24], ["192.0.2.0", 24], ["198.18.0.0", 15],
      ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([base, prefix]) => inV4Cidr(ip, base as string, prefix as number));
  }
  if (isIP(ip) === 6) {
    // Fail closed: IPv6 global unicast is 2000::/3. IPv4-mapped addresses were
    // already recursively classified above; translation/local/multicast and all
    // other non-global prefixes must never be used as crawl egress targets.
    if (!inV6Cidr(ip, "2000::", 3)) return true;
    return [
      // IANA special-purpose umbrella, documentation, transition, and the
      // temporary documentation prefix (RFC 2928/3849/3056/9637).
      ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
    ].some(([base, prefix]) => inV6Cidr(ip, base as string, prefix as number));
  }
  return true;
}
