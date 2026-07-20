/**
 * The crawl source adapter (spec §7.1, §7.3). Wraps the SSRF-safe `crawlSite`
 * engine in the `SourceAdapter` contract and maps a `CrawlRaw` site graph to
 * canonical observations:
 *  - one `crawl.page.v1` per crawled page (subjectType `url`);
 *  - one `crawl.robots.v1` for the site (subjectType `site`);
 *  - one `crawl.sitemap.v1` for the site (subjectType `site`).
 *
 * The MVP has a single default public crawl source with no per-connection
 * config, so `validateConfig` only fills the default user agent and `collect`
 * builds the default native fetcher.
 */

import type {
  Capability,
  CollectionContext,
  CollectionResult,
  NormalizeContext,
  NormalizedObservation,
  SourceAdapter,
} from "../adapter.ts";
import {
  buildObservation,
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_CRAWL_SITEMAP,
} from "../observations.ts";
import { crawlSite, createDefaultCrawlFetcher } from "./engine.ts";
import type { CrawlEngineOptions } from "./engine.ts";
import { CRAWL_DATASET_KEY } from "./types.ts";
import type {
  CrawlConfig,
  CrawlFetcher,
  CrawlParams,
  CrawlRaw,
} from "./types.ts";

/** Published product identity; never advertise a placeholder or impersonate another bot. */
export const DEFAULT_CRAWL_USER_AGENT = "SignalFrameBot/0.2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate raw config into a `CrawlConfig`, defaulting the user agent. */
async function validateConfig(config: unknown): Promise<CrawlConfig> {
  const candidate = isRecord(config) ? config["userAgent"] : undefined;
  const userAgent =
    typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : DEFAULT_CRAWL_USER_AGENT;
  return { userAgent };
}

async function capabilities(_config: CrawlConfig): Promise<Capability[]> {
  return [
    {
      datasetKey: CRAWL_DATASET_KEY,
      operation: "site_graph",
      available: true,
      limitation:
        "Public crawl within a fixed budget (2000 URLs, depth 6, 14 min of provider work inside a 15 min job cap); same-origin only, robots-respecting, with finalization time reserved.",
    },
  ];
}

async function* normalize(raw: CrawlRaw, _ctx: NormalizeContext): AsyncGenerator<NormalizedObservation> {
  for (const page of raw.pages) {
    yield buildObservation({
      provider: "crawl",
      metricKey: METRIC_CRAWL_PAGE,
      subjectType: "url",
      subjectRef: page.subjectUrl,
      observedAt: raw.capturedAt,
      availability: "available",
      value: { json: page.projection },
      limitation: raw.limitation,
    });
  }
  yield buildObservation({
    provider: "crawl",
    metricKey: METRIC_CRAWL_ROBOTS,
    subjectType: "site",
    subjectRef: raw.origin,
    observedAt: raw.capturedAt,
    availability: "available",
    value: { json: raw.robots },
    limitation: raw.limitation,
  });
  yield buildObservation({
    provider: "crawl",
    metricKey: METRIC_CRAWL_SITEMAP,
    subjectType: "site",
    subjectRef: raw.origin,
    observedAt: raw.capturedAt,
    availability: "available",
    value: { json: raw.sitemap },
    limitation: raw.limitation,
  });
}

/** Optional IO seams used by deterministic fixtures; production passes none. */
export interface CrawlAdapterOptions {
  readonly fetcher?: CrawlFetcher;
  readonly engineOptions?: CrawlEngineOptions;
}

/** Build a crawl adapter while preserving the production transport by default. */
export function createCrawlAdapter(
  options: CrawlAdapterOptions = {},
): SourceAdapter<CrawlConfig, CrawlParams, CrawlRaw> {
  return {
    provider: "crawl",
    validateConfig,
    capabilities,
    async collect(
      params: CrawlParams,
      ctx: CollectionContext,
    ): Promise<CollectionResult<CrawlRaw>> {
      const fetcher =
        options.fetcher ??
        createDefaultCrawlFetcher(DEFAULT_CRAWL_USER_AGENT);
      const raw = await crawlSite(
        params,
        { userAgent: DEFAULT_CRAWL_USER_AGENT },
        ctx,
        fetcher,
        options.engineOptions,
      );
      return {
        availability: raw.availability,
        raw,
        capturedAt: raw.capturedAt,
        sourceWindow: raw.sourceWindow,
        rowCount: raw.pages.length,
        stopReason: raw.stopReason,
        providerUsage: raw.providerUsage,
        limitation: raw.limitation,
      };
    },
    normalize,
  };
}

export const crawlAdapter = createCrawlAdapter();
