/**
 * Crawl adapter types (spec §7.3). The crawl ENGINE (`engine.ts`) performs the
 * SSRF-safe BFS fetch and produces a `CrawlRaw` site graph; the crawl ADAPTER
 * (`adapter.ts`) wraps it into the `SourceAdapter` contract and maps records to
 * canonical observations. Splitting the two keeps the fetch mechanics (heavy,
 * vendor-copied) independent of the observation vocabulary (contract-owned).
 */

import type { Availability, SourceWindow } from "../adapter.ts";
import type {
  CrawlPageProjection,
  CrawlRobotsProjection,
  CrawlSitemapProjection,
} from "../observations.ts";

export const CRAWL_DATASET_KEY = "crawl.site_graph.v1";
export const CRAWL_METHOD_VERSION = "crawl.site_graph.v1";

/** Crawl budget knobs (spec §7.2, §7.3). Overridable only for tests/fixtures. */
export interface CrawlBudget {
  readonly maxUrls: number;
  readonly maxDepth: number;
  readonly maxWallClockMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly perHostConcurrency: number;
  readonly minHostDelayMs: number;
}

/** Fixed MVP budgets (spec §7.2, §7.3). Not operator-tunable in production. */
export const CRAWL_BUDGET: CrawlBudget = {
  maxUrls: 2000,
  maxDepth: 6,
  maxWallClockMs: 15 * 60 * 1000,
  maxRedirects: 5,
  maxBodyBytes: 5 * 1024 * 1024,
  perHostConcurrency: 5,
  minHostDelayMs: 250,
};

/** Validated crawl connection config (the default public crawl source has none). */
export interface CrawlConfig {
  readonly userAgent: string;
}

/** Parameters for one crawl collection. */
export interface CrawlParams {
  readonly origin: string;
  readonly host: string;
}

/**
 * One crawled page. `subjectUrl` is the canonical_url.v1 aggregation key;
 * `projection` is the exact `crawl.page.v1` value emitted as an observation.
 */
export interface CrawlPageRecord {
  readonly subjectUrl: string;
  readonly depth: number;
  readonly projection: CrawlPageProjection;
}

/**
 * The raw crawl site graph (the `R` in `CollectionResult<R>`). Persisted to
 * Storage verbatim (as the snapshot raw object) and mapped to observations.
 */
export interface CrawlRaw {
  readonly origin: string;
  readonly host: string;
  readonly pages: readonly CrawlPageRecord[];
  readonly robots: CrawlRobotsProjection;
  readonly sitemap: CrawlSitemapProjection;
  /** Overall availability: `partial` when a budget cut the crawl short. */
  readonly availability: Availability;
  readonly capturedAt: string;
  readonly sourceWindow: SourceWindow;
  readonly stopReason: string | null;
  readonly providerUsage: Record<string, number>;
  readonly limitation: string;
}

/** The engine's injectable fetch surface, so tests can drive fixtures offline. */
export interface CrawlFetcher {
  fetch(url: string, init: { readonly signal: AbortSignal }): Promise<Response>;
}
