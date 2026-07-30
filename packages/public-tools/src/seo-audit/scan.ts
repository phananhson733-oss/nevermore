import {
  crawlPublicSitePreview,
  type CrawlRaw,
} from "@sf/sources/crawl-public-preview";

export type SeoAuditScanErrorCode = "blocked" | "scan_failed" | "timeout";

export class SeoAuditScanError extends Error {
  readonly code: SeoAuditScanErrorCode;

  constructor(code: SeoAuditScanErrorCode) {
    super(code);
    this.name = "SeoAuditScanError";
    this.code = code;
  }
}

export type SeoAuditCrawler = (url: string) => Promise<CrawlRaw>;
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
  crawl: SeoAuditCrawler = crawlPublicSitePreview,
): Promise<SeoAuditRaw> {
  try {
    const raw = await crawl(url);
    if (raw.availability === "unavailable") {
      throw new SeoAuditScanError("scan_failed");
    }
    return { ...raw, requestedUrl: url };
  } catch (error) {
    if (error instanceof SeoAuditScanError) throw error;
    if (error instanceof Error && /max_duration|aborted|timeout/i.test(error.message)) {
      throw new SeoAuditScanError("timeout");
    }
    throw new SeoAuditScanError("scan_failed");
  }
}
