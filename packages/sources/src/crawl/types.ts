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

/** Defense-in-depth run cap from spec §14.2; counts fetch-decoded body bytes. */
export const CRAWL_MAX_TOTAL_DECODED_BYTES = 128 * 1024 * 1024;

/** Frozen spec §7.1 upper bound for one crawl queue delivery. */
export const CRAWL_JOB_WALL_CLOCK_CAP_MS = 15 * 60 * 1_000;

/**
 * Time kept outside the crawl engine for raw upload, snapshot/observation
 * persistence, and the canonical terminal transition before pg-boss expiry.
 */
export const CRAWL_FINALIZATION_HEADROOM_MS = 60 * 1_000;

/** Effective provider-work budget inside the frozen fifteen-minute job cap. */
export const CRAWL_ENGINE_WALL_CLOCK_BUDGET_MS =
  CRAWL_JOB_WALL_CLOCK_CAP_MS - CRAWL_FINALIZATION_HEADROOM_MS;

/**
 * Fixed persisted-projection bounds. These are deliberately not operator
 * tunable: a hostile but per-response-valid page must not amplify into an
 * unbounded snapshot/observation JSON value.
 */
export const CRAWL_PROJECTION_LIMITS = {
  maxUrlChars: 2_048,
  maxTitleChars: 512,
  maxMetaDescriptionChars: 2_048,
  maxRobotsDirectives: 32,
  maxRobotsDirectiveChars: 128,
  maxH1: 20,
  maxH1Chars: 512,
  maxHeadings: 100,
  maxHeadingChars: 512,
  maxParagraphs: 50,
  maxParagraphChars: 1_000,
  maxBodyExcerptChars: 500,
  maxInternalOutlinks: 500,
  maxAnchorTextChars: 512,
  maxRelChars: 256,
  maxJsonLdTypes: 100,
  maxJsonLdTypeChars: 256,
  maxJsonLdBlocks: 100,
  maxJsonLdNodes: 5_000,
  maxContentTypeChars: 256,
  maxRobotsGroups: 64,
  maxRobotsRulesPerGroup: 128,
  maxRobotsRuleChars: 512,
  maxUserAgentChars: 256,
  maxSitemaps: 50,
  maxSitemapUrls: 2_000,
} as const;

/** Crawl budget knobs (spec §7.2, §7.3). Overridable only for tests/fixtures. */
export interface CrawlBudget {
  readonly maxUrls: number;
  readonly maxDepth: number;
  readonly maxWallClockMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly maxTotalBytes: number;
  readonly perHostConcurrency: number;
  readonly minHostDelayMs: number;
}

/** Fixed MVP budgets (spec §7.2, §7.3). Not operator-tunable in production. */
export const CRAWL_BUDGET: CrawlBudget = {
  maxUrls: 2000,
  maxDepth: 6,
  maxWallClockMs: CRAWL_ENGINE_WALL_CLOCK_BUDGET_MS,
  maxRedirects: 5,
  maxBodyBytes: 5 * 1024 * 1024,
  maxTotalBytes: CRAWL_MAX_TOTAL_DECODED_BYTES,
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
 * One crawled page. `subjectUrl` is the terminal response URL's canonical_url.v1
 * aggregation key. `projection.fetchUrl` is that terminal content fetch URL,
 * while projection status/finalStatus describe the initial/terminal responses
 * of the selected redirect journey. `projection` is the exact `crawl.page.v1`
 * value emitted as an observation.
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
