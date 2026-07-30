import { isIP } from "node:net";
import {
  isBlockedHost,
  normaliseIpv4,
} from "@sf/sources/url-safety";

export type SeoAuditUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly code: "invalid_url" };

const RESERVED_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "test.com",
  "test.org",
]);

function invalid(): SeoAuditUrlResult {
  return { ok: false, code: "invalid_url" };
}

export function normalizeSeoAuditUrl(input: unknown): SeoAuditUrlResult {
  if (typeof input !== "string") return invalid();
  const raw = input.trim();
  if (!raw || raw.length > 2_048) return invalid();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw)
    ? raw
    : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return invalid();
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    return invalid();
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isBlockedHost(hostname) ||
    RESERVED_DOMAINS.has(hostname) ||
    normaliseIpv4(hostname) !== null ||
    isIP(hostname) !== 0
  ) {
    return invalid();
  }

  parsed.hash = "";
  return { ok: true, url: parsed.toString() };
}
