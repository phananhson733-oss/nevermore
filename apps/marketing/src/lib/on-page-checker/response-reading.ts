// @input  -- one raw Agent audit response, response headers, and report label values
// @output -- bounded crawl, public-host redirect, count, timing, and display readings
// @pos    -- the pure half of the checker, extracted so it can be read and tested alone
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type {
  SeoAuditRecord,
  SeoAuditSiteResources,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools/seo-audit/types";
import type { SerpLandscape } from "../agents/audit-contract.ts";

export interface AuditResponse {
  readonly data?: {
    readonly run?: {
      readonly source?: {
        readonly cache?: { readonly status?: unknown };
      };
    };
    readonly result?: {
      readonly targetUrl?: unknown;
      readonly scannedAt?: unknown;
      readonly targetInspected?: unknown;
      readonly inspectedTargetUrl?: unknown;
      readonly landedTargetUrl?: unknown;
      readonly coverage?: Readonly<Record<string, unknown>>;
      readonly targetPageExtract?: SeoAuditTargetPageExtract | null;
      readonly siteResources?: SeoAuditSiteResources;
      readonly records?: readonly SeoAuditRecord[];
      readonly keywordEvidence?: KeywordEvidence;
      readonly serpLandscape?: SerpLandscape;
    };
  };
  readonly error?: { readonly code?: unknown };
}

export function errorCodeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as AuditResponse).error?.code;
  return typeof code === "string" ? code : null;
}

const MAX_REDIRECT_TARGET_CHARS = 2_048;
const TRACKING_QUERY_KEYS = new Set(["gclid", "fbclid", "msclkid"]);
const RESERVED_REDIRECT_HOSTS = new Set([
  "metadata.google.internal",
  "example.com",
  "example.net",
  "example.org",
  "test.com",
  "test.org",
]);

function hasUnsafeUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      character === "\\" ||
      /\s/u.test(character) ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

function authorityOf(absoluteUrl: string): string {
  const start = absoluteUrl.indexOf("://") + 3;
  const tail = absoluteUrl.slice(start);
  const end = tail.search(/[/?#]/u);
  return end === -1 ? tail : tail.slice(0, end);
}

function hasExplicitPort(authority: string): boolean {
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (!host.startsWith("[")) return host.includes(":");
  const close = host.indexOf("]");
  return close === -1 || host.slice(close + 1).startsWith(":");
}

function isPublicRedirectHost(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    hostname.includes(".") &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local") &&
    !RESERVED_REDIRECT_HOSTS.has(hostname) &&
    !/^[\d.]+$/u.test(hostname) &&
    !hostname.includes(":")
  );
}

function canonicalPageKey(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  const path =
    url.pathname !== "/" && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
  const query = [...url.searchParams.entries()]
    .filter(([key]) => {
      const lower = key.toLowerCase();
      return !lower.startsWith("utm_") && !TRACKING_QUERY_KEYS.has(lower);
    })
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey < rightKey
        ? -1
        : leftKey > rightKey
          ? 1
          : leftValue < rightValue
            ? -1
            : leftValue > rightValue
              ? 1
              : 0,
    );
  return JSON.stringify([host, path, query]);
}

/**
 * Read a redirect destination only after independently validating it for use
 * in this client surface. The handler validates the header too, but a stale or
 * compromised response must not turn an arbitrary Location into a rendered
 * link or a future form submission.
 */
export function redirectTargetOf(
  headers: Headers,
  submittedUrl: string,
): string | null {
  const rawTarget = headers.get("Location");
  if (
    rawTarget === null ||
    rawTarget.length === 0 ||
    rawTarget.length > MAX_REDIRECT_TARGET_CHARS ||
    !/^https?:\/\//iu.test(rawTarget) ||
    rawTarget.includes("#") ||
    hasUnsafeUrlCharacter(rawTarget)
  ) {
    return null;
  }

  const authority = authorityOf(rawTarget);
  if (authority.includes("@") || hasExplicitPort(authority)) return null;

  let submitted: URL;
  let target: URL;
  try {
    submitted = new URL(
      /^https?:\/\//iu.test(submittedUrl)
        ? submittedUrl
        : `https://${submittedUrl}`,
    );
    target = new URL(rawTarget);
  } catch {
    return null;
  }

  if (
    (submitted.protocol !== "http:" && submitted.protocol !== "https:") ||
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== "" ||
    target.port !== "" ||
    target.href.length > MAX_REDIRECT_TARGET_CHARS ||
    !isPublicRedirectHost(target.hostname) ||
    (submitted.protocol === "https:" && target.protocol !== "https:")
  ) {
    return null;
  }

  const submittedHost = submitted.hostname.toLowerCase();
  const targetHost = target.hostname.toLowerCase();
  const submittedFamily = submittedHost.startsWith("www.")
    ? submittedHost.slice(4)
    : submittedHost;
  const targetFamily = targetHost.startsWith("www.")
    ? targetHost.slice(4)
    : targetHost;
  if (
    submittedFamily !== targetFamily ||
    (submittedHost !== targetHost &&
      submittedHost !== `www.${targetHost}` &&
      targetHost !== `www.${submittedHost}`)
  ) {
    return null;
  }
  if (canonicalPageKey(submitted) === canonicalPageKey(target)) return null;

  return target.href;
}

/**
 * A count the response actually carried, or `null`.
 *
 * Never 0 for a missing number: this value is stored and read back later, and a
 * zero there says "we looked and there were none" about something we were never
 * told. The house rule is that unavailable is not zero, and a crawl that
 * reported nothing about skipped URLs is unavailable, not clean.
 */
export function countAt(
  source: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function coverageAvailabilityOf(
  source: Readonly<Record<string, unknown>> | undefined,
): "available" | "partial" | "unavailable" {
  const value = source?.["availability"];
  return value === "available" || value === "partial" ? value : "unavailable";
}

/**
 * Elapsed time comes off a clock that cannot go backwards.
 *
 * `Date.now()` moves when the system clock is corrected or the machine wakes
 * from sleep, and this counter runs for up to four minutes beside a claim about
 * how long the visitor has waited.
 */
export function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * The collection time, in the reader's own locale.
 *
 * Rendered only after a client-side run, so there is no server pass to disagree
 * with. An unparsable timestamp reads as the raw value rather than as a date we
 * made up.
 */
export function formatCollectedAt(scannedAt: string, locale: string): string {
  const parsed = new Date(scannedAt);
  if (Number.isNaN(parsed.getTime())) return scannedAt;
  try {
    return parsed.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return parsed.toISOString();
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return "";
  }
}

/** Retry-After only when it is a plain integer count of seconds we can show. */
export function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const seconds = Number(raw.trim());
  if (!Number.isSafeInteger(seconds)) return null;
  return Math.min(Math.max(seconds, 1), 3_600);
}
