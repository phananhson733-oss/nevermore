// @input  -- IP literal string (from a URL host or a DNS-resolved address)
// @output -- isBlockedIp(ip): true when the IP is private/loopback/link-local/
//            metadata/multicast and the worker must never reach it.
// @pos    -- D1 worker SSRF primitive: the SINGLE source of truth for IP
//            blocklisting. Consumed by rules/_fetch-helpers (live fetch DNS gate)
//            AND modules/a5-render/ssrf-guard (pre-nav gate). Previously these
//            held drifted copies; the render copy handled IPv4-mapped IPv6 hex,
//            the fetch copy did not (a live SSRF gap — codex U4a P1). Unified here.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import * as net from "node:net";

/**
 * True when the IP literal sits in a range the worker must never reach:
 * loopback, RFC1918 private, link-local (incl. cloud metadata 169.254.169.254),
 * "this network", multicast/reserved, and IPv6 loopback/ULA/link-local/multicast.
 *
 * IPv4-mapped IPv6 is re-checked against the embedded IPv4, in BOTH the dotted
 * form (`::ffff:127.0.0.1`) and the hex-quad form (`::ffff:7f00:1`) that the
 * WHATWG URL parser normalizes bracketed literals into.
 */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/%.+$/, ""); // strip IPv6 zone id
  if (net.isIPv4(clean)) {
    const [a, b] = clean.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(clean)) {
    const lower = clean.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower === "::") return true;
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d) dotted OR hex-quad (::ffff:7f00:1).
    const mappedDotted = lower.match(/^::ffff:([0-9.]+)$/);
    if (mappedDotted) return isBlockedIp(mappedDotted[1]);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIp(v4);
    }
    return false;
  }
  return false;
}
