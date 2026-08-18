// @input  -- one raw Agent audit response, and the values a report is labelled with
// @output -- the few readings the checker takes off it before rendering
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
