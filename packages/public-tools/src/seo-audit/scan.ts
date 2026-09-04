import {
  crawlPublicSitePreview,
  PublicPreviewTargetRedirectError,
  type CrawlBudget,
  type CrawlRaw,
} from "@sf/sources/crawl-public-preview";
import type { SeoAuditCrawlTier } from "./types.ts";

export const KEY_PAGES_CRAWL_BUDGET_CEILING = {
  maxDepth: 2,
  maxUrls: 80,
  maxWallClockMs: 45_000,
} as const satisfies Partial<CrawlBudget>;

export type SeoAuditScanErrorCode =
  | "blocked"
  | "scan_failed"
  | "target_redirected"
  | "timeout"
  /** The site's robots.txt forbids this crawler. Not a failure, and not a finding. */
  | "robots_disallowed"
  /** robots.txt could not be read, so RFC 9309 §2.3.1.4 forbids crawling. */
  | "robots_unreachable";

export class SeoAuditScanError extends Error {
  readonly code: SeoAuditScanErrorCode;
  readonly redirectTarget: string | null;

  constructor(
    code: SeoAuditScanErrorCode,
    redirectTarget: string | null = null,
  ) {
    super(code);
    this.name = "SeoAuditScanError";
    this.code = code;
    this.redirectTarget = redirectTarget;
  }
}

/**
 * What the crawl has actually done so far, from two different seams.
 *
 * `pagesCrawled` is the crawl engine's own collected-page count, which is the
 * figure the finished report states as `coverage.pagesInspected`; the two can
 * never disagree because they are the same number read at different times.
 *
 * `requestsSent` counts wire requests issued to the target: robots.txt, every
 * sitemap document, every redirect hop, and every page fetch. It runs strictly
 * ahead of the page count and must never be rendered as one.
 */
export interface SeoAuditProgress {
  readonly pagesCrawled: number;
  readonly requestsSent: number;
}

export type SeoAuditProgressListener = (progress: SeoAuditProgress) => void;

export type SeoAuditCrawler = (
  url: string,
  signal?: AbortSignal,
  onProgress?: SeoAuditProgressListener,
  tier?: SeoAuditCrawlTier,
  additionalSeedUrls?: readonly string[],
) => Promise<CrawlRaw>;

export type SeoAuditRaw = CrawlRaw & {
  /** Normalized visitor submission retained separately from the crawl origin. */
  readonly requestedUrl: string;
  /** Optional while older raw/cache rows remain readable. New scans always set it. */
  readonly crawlTier?: SeoAuditCrawlTier;
};

export interface SeoAuditScanOptions {
  /**
   * Best-effort observation sink. Never changes budget, pacing, or abort
   * behaviour, and a listener that throws cannot end the crawl.
   */
  readonly onProgress?: SeoAuditProgressListener;
  /** Reject when the canonical entry replaces the submitted page. */
  readonly requireSameEntrySubject?: boolean;
  /** Crawl coverage selected by the trusted server request boundary. */
  readonly tier?: SeoAuditCrawlTier;
  /** Normalized server-owned manual pages to enqueue at depth zero. */
  readonly additionalSeedUrls?: readonly string[];
  /** Offline test seam. */
  readonly crawl?: SeoAuditCrawler;
}

/**
 * Merge the transport's request count and the engine's page count into one
 * observation, so a reader is never shown one figure updated and the other
 * stale. Neither seam can reach the other's number, and the merged state is
 * committed before the listener runs, so a listener that throws loses one
 * observation rather than desynchronising the next.
 */
export function crawlProgressReporter(onProgress: SeoAuditProgressListener): {
  readonly onRequest: (requestsSent: number) => void;
  readonly onPageProgress: (progress: {
    readonly pagesCollected: number;
  }) => void;
} {
  let latest: SeoAuditProgress = { pagesCrawled: 0, requestsSent: 0 };
  const report = (next: SeoAuditProgress): void => {
    latest = next;
    onProgress(next);
  };
  return {
    onRequest: (requestsSent) => report({ ...latest, requestsSent }),
    onPageProgress: ({ pagesCollected }) =>
      report({ ...latest, pagesCrawled: pagesCollected }),
  };
}

/**
 * The production crawler, instrumented only when someone is listening.
 *
 * Both figures come from the crawler's own observation doors, so an observed
 * crawl and an unobserved one run the identical transport: this file hands in
 * no fetcher, and `PublicPreviewCrawlOptions.fetcher` stays what its comment
 * says it is — an offline test seam.
 */
const instrumentedCrawler = (
  url: string,
  signal?: AbortSignal,
  onProgress?: SeoAuditProgressListener,
  requireSameEntrySubject?: boolean,
  tier: SeoAuditCrawlTier = "full-site",
  additionalSeedUrls: readonly string[] = [],
): Promise<CrawlRaw> => {
  const strictOptions =
    requireSameEntrySubject === true
      ? ({ requireSameEntrySubject: true } as const)
      : {};
  const manualOptions =
    additionalSeedUrls.length > 0 ? { additionalSeedUrls } : {};
  if (!onProgress) {
    if (tier === "key-pages") {
      return crawlPublicSitePreview(url, signal, {
        ...strictOptions,
        ...manualOptions,
        budgetCeiling: KEY_PAGES_CRAWL_BUDGET_CEILING,
        deferSitemapFrontier: true,
      });
    }
    return requireSameEntrySubject === true || additionalSeedUrls.length > 0
      ? crawlPublicSitePreview(url, signal, {
          ...strictOptions,
          ...manualOptions,
        })
      : crawlPublicSitePreview(url, signal);
  }
  const reporter = crawlProgressReporter(onProgress);
  return crawlPublicSitePreview(url, signal, {
    ...strictOptions,
    ...manualOptions,
    ...(tier === "key-pages"
      ? {
          budgetCeiling: KEY_PAGES_CRAWL_BUDGET_CEILING,
          deferSitemapFrontier: true,
        }
      : {}),
    onRequestSent: reporter.onRequest,
    onPageProgress: reporter.onPageProgress,
  });
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
  options: SeoAuditScanOptions = {},
): Promise<SeoAuditRaw> {
  try {
    const tier = options.tier ?? "full-site";
    const raw = options.crawl
      ? await (options.additionalSeedUrls?.length
          ? options.crawl(
              url,
              signal,
              options.onProgress,
              tier,
              options.additionalSeedUrls,
            )
          : options.crawl(url, signal, options.onProgress, tier))
      : await instrumentedCrawler(
          url,
          signal,
          options.onProgress,
          options.requireSameEntrySubject,
          tier,
          options.additionalSeedUrls,
        );
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
    return { ...raw, requestedUrl: url, crawlTier: tier };
  } catch (error) {
    if (error instanceof SeoAuditScanError) throw error;
    if (error instanceof PublicPreviewTargetRedirectError) {
      throw new SeoAuditScanError("target_redirected", error.targetUrl);
    }
    if (
      error instanceof Error &&
      /max_duration|aborted|timeout/i.test(error.message)
    ) {
      throw new SeoAuditScanError("timeout");
    }
    throw new SeoAuditScanError("scan_failed");
  }
}
