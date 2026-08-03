import {
  crawlPublicSitePreview,
  type CrawlRaw,
} from "@sf/sources/crawl-public-preview";

export type SeoAuditScanErrorCode =
  | "blocked"
  | "scan_failed"
  | "timeout"
  /** The site's robots.txt forbids this crawler. Not a failure, and not a finding. */
  | "robots_disallowed"
  /** robots.txt could not be read, so RFC 9309 §2.3.1.4 forbids crawling. */
  | "robots_unreachable";

export class SeoAuditScanError extends Error {
  readonly code: SeoAuditScanErrorCode;

  constructor(code: SeoAuditScanErrorCode) {
    super(code);
    this.name = "SeoAuditScanError";
    this.code = code;
  }
}

export type SeoAuditCrawler = (
  url: string,
  signal?: AbortSignal,
) => Promise<CrawlRaw>;
export type SeoAuditRaw = CrawlRaw & {
  /** Normalized visitor submission retained separately from the crawl origin. */
  readonly requestedUrl: string;
};

/**
 * Run the fixed anonymous public crawl profile.
 *
 * API callers cannot provide crawl limits. The shared crawler owns the page,
 * depth, request, duration, byte, redirect, delay, and concurrency budgets.
 */
export async function scanSeoAuditSite(
  url: string,
  /**
   * Aborts the crawl when the client goes away. Without it an accepted POST
   * commits the full budget — up to 4,500 requests at the target — no matter
   * what the caller does next, which makes the endpoint a fire-and-forget
   * relay rather than a request the caller is waiting on.
   */
  signal?: AbortSignal,
  /** Offline test seam. */
  crawl: SeoAuditCrawler = crawlPublicSitePreview,
): Promise<SeoAuditRaw> {
  try {
    const raw = await crawl(url, signal);
    if (raw.availability === "unavailable") {
      // Say which of the three it was. "The site told us not to crawl it" and
      // "we could not reach the site" are different answers, and neither is
      // the generic failure the caller used to receive.
      if (raw.stopReason === "robots_disallowed") {
        throw new SeoAuditScanError("robots_disallowed");
      }
      if (raw.stopReason === "robots_unreachable") {
        throw new SeoAuditScanError("robots_unreachable");
      }
      throw new SeoAuditScanError("scan_failed");
    }
    return { ...raw, requestedUrl: url };
  } catch (error) {
    if (error instanceof SeoAuditScanError) throw error;
    if (
      error instanceof Error &&
      /max_duration|aborted|timeout/i.test(error.message)
    ) {
      throw new SeoAuditScanError("timeout");
    }
    throw new SeoAuditScanError("scan_failed");
  }
}
