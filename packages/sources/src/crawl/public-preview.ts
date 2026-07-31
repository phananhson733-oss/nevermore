/**
 * The synchronous crawl profile shared by the anonymous public tools.
 *
 * These are transport safety boundaries, not account, pricing, or usage
 * quotas. The HTTP caller cannot change them. A later asynchronous crawler can
 * use a different execution profile without changing the public audit facts.
 */
import { normalizeSiteOrigin } from "../origin.ts";
import {
  fetchPublicResource,
  type PublicResourceFetchOptions,
  type PublicResourceResult,
} from "../public-http/index.ts";
import {
  crawlSite,
  createDefaultCrawlFetcher,
  type CrawlEngineOptions,
} from "./engine.ts";
import type { CrawlBudget, CrawlFetcher, CrawlRaw } from "./types.ts";

export type { CrawlRaw } from "./types.ts";

export const PUBLIC_PREVIEW_CRAWL_USER_AGENT =
  "GenGrowth-Public-Tools-Crawler/1.0 (+https://gengrowth.ai/tools)";

/**
 * Synchronous-function safety profile. The 240-second crawl budget leaves one
 * minute of route-level headroom under the configured five-minute function
 * duration for entry resolution, modelling, serialization, and error handling.
 */
export const PUBLIC_TOOL_SYNC_CRAWL_BUDGET: CrawlBudget = {
  maxUrls: 2_000,
  maxDepth: 6,
  maxWallClockMs: 240_000,
  maxRedirects: 5,
  maxBodyBytes: 2 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  perHostConcurrency: 5,
  minHostDelayMs: 250,
};

/** Includes robots.txt, sitemap documents, pages, and every redirect hop. */
export const PUBLIC_TOOL_SYNC_MAX_REQUESTS = 4_500;

/** Compatibility aliases for existing internal consumers. */
export const PUBLIC_PREVIEW_CRAWL_BUDGET = PUBLIC_TOOL_SYNC_CRAWL_BUDGET;
export const PUBLIC_PREVIEW_MAX_REQUESTS = PUBLIC_TOOL_SYNC_MAX_REQUESTS;

export type PublicSiteEntryResolver = (
  url: string,
  options: PublicResourceFetchOptions,
) => Promise<PublicResourceResult>;

export interface PublicPreviewCrawlOptions {
  /** Offline test seam. Production must use the guarded default transport. */
  readonly fetcher?: CrawlFetcher;
  /** Offline test seam. API callers cannot supply engine options. */
  readonly engineOptions?: Omit<CrawlEngineOptions, "budget">;
  /** Offline test seam for canonical entry resolution. */
  readonly entryResolver?: PublicSiteEntryResolver;
}

function withoutWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * Admit only a same-host or apex/www canonical entry transition. HTTPS may
 * never downgrade. This intentionally does not use a suffix or registrable
 * domain heuristic, so sibling subdomains and look-alike domains stay blocked.
 */
export function isAllowedPublicToolEntryRedirect(
  submittedUrl: string,
  candidateUrl: string,
): boolean {
  let submitted: URL;
  let candidate: URL;
  try {
    submitted = new URL(submittedUrl);
    candidate = new URL(candidateUrl);
  } catch {
    return false;
  }

  if (
    (candidate.protocol !== "http:" && candidate.protocol !== "https:") ||
    (submitted.protocol === "https:" && candidate.protocol !== "https:")
  ) {
    return false;
  }

  const submittedHost = submitted.hostname.toLowerCase();
  const candidateHost = candidate.hostname.toLowerCase();
  if (withoutWww(submittedHost) !== withoutWww(candidateHost)) return false;

  return (
    submittedHost === candidateHost ||
    submittedHost === `www.${candidateHost}` ||
    candidateHost === `www.${submittedHost}`
  );
}

export async function crawlPublicSitePreview(
  inputUrl: string,
  signal?: AbortSignal,
  options: PublicPreviewCrawlOptions = {},
): Promise<CrawlRaw> {
  let submitted: URL;
  try {
    submitted = new URL(inputUrl);
  } catch {
    throw new Error("public_preview_requires_normalized_origin");
  }
  if (submitted.username || submitted.password) {
    throw new Error("public_preview_requires_normalized_origin");
  }
  submitted.hash = "";
  const entryResolver = options.entryResolver ?? fetchPublicResource;
  const entry = await entryResolver(submitted.toString(), {
    timeoutMs: 15_000,
    maxRedirects: PUBLIC_TOOL_SYNC_CRAWL_BUDGET.maxRedirects,
    maxBodyBytes: 1,
    userAgent: PUBLIC_PREVIEW_CRAWL_USER_AGENT,
    allowRedirect: (_fromUrl, toUrl) =>
      isAllowedPublicToolEntryRedirect(submitted.toString(), toUrl),
  });
  if (
    entry.kind === "error" &&
    (entry.code === "blocked" ||
      entry.code === "cross_origin" ||
      entry.code === "invalid_redirect" ||
      entry.code === "redirect_limit")
  ) {
    throw new Error("public_preview_entry_blocked");
  }
  const seedUrl = entry.kind === "ok" ? entry.finalUrl : submitted.toString();
  if (!isAllowedPublicToolEntryRedirect(submitted.toString(), seedUrl)) {
    throw new Error("public_preview_entry_blocked");
  }
  const resolvedSeed = new URL(seedUrl);
  const normalized = normalizeSiteOrigin(`${resolvedSeed.origin}/`);
  if (!normalized) {
    throw new Error("public_preview_requires_normalized_origin");
  }

  return crawlSite(
    {
      origin: normalized.origin,
      host: normalized.host,
      seedUrl: resolvedSeed.toString(),
    },
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
      budget: PUBLIC_TOOL_SYNC_CRAWL_BUDGET,
      maxRequests: PUBLIC_TOOL_SYNC_MAX_REQUESTS,
    },
  );
}
