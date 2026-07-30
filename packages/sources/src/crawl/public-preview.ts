/**
 * A deliberately small, synchronous crawl profile for anonymous public tools.
 *
 * This wrapper is the only production caller allowed to use the engine's
 * non-default budget. Its limits are code-owned rather than request-owned, so
 * an untrusted visitor cannot convert a public report into a large crawl job.
 */
import { normalizeSiteOrigin } from "../origin.ts";
import {
  crawlSite,
  createDefaultCrawlFetcher,
  type CrawlEngineOptions,
} from "./engine.ts";
import type { CrawlBudget, CrawlFetcher, CrawlRaw } from "./types.ts";

export type { CrawlRaw } from "./types.ts";

export const PUBLIC_PREVIEW_CRAWL_USER_AGENT =
  "GenGrowth-Internal-Link-Audit/1.0 (+https://gengrowth.ai/tools/internal-link-audit)";

/**
 * Public-tool limits intentionally leave route-level headroom for serialization
 * and an error response. They are not parameters of the HTTP API.
 */
export const PUBLIC_PREVIEW_CRAWL_BUDGET: CrawlBudget = {
  maxUrls: 25,
  maxDepth: 4,
  maxWallClockMs: 40_000,
  maxRedirects: 5,
  maxBodyBytes: 1 * 1024 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
  perHostConcurrency: 2,
  minHostDelayMs: 300,
};

/** Includes robots.txt, sitemap documents, pages, and every redirect hop. */
export const PUBLIC_PREVIEW_MAX_REQUESTS = 60;

export interface PublicPreviewCrawlOptions {
  /** Offline test seam. Production must use the guarded default transport. */
  readonly fetcher?: CrawlFetcher;
  /** Offline test seam. API callers cannot supply engine options. */
  readonly engineOptions?: Omit<CrawlEngineOptions, "budget">;
}

export async function crawlPublicSitePreview(
  inputUrl: string,
  signal?: AbortSignal,
  options: PublicPreviewCrawlOptions = {},
): Promise<CrawlRaw> {
  const normalized = normalizeSiteOrigin(inputUrl);
  if (!normalized) {
    throw new Error("public_preview_requires_normalized_origin");
  }

  return crawlSite(
    { origin: normalized.origin, host: normalized.host },
    { userAgent: PUBLIC_PREVIEW_CRAWL_USER_AGENT },
    // The engine requires adapter identity, but a public preview neither reads
    // nor persists any tenant/run state. Only cancellation is meaningful here.
    {
      workspaceId: "public-preview",
      projectId: "public-preview",
      siteId: "public-preview",
      runId: "public-preview",
      ...(signal ? { signal } : {}),
    },
    options.fetcher ?? createDefaultCrawlFetcher(PUBLIC_PREVIEW_CRAWL_USER_AGENT),
    {
      ...options.engineOptions,
      budget: PUBLIC_PREVIEW_CRAWL_BUDGET,
      maxRequests: PUBLIC_PREVIEW_MAX_REQUESTS,
    },
  );
}
