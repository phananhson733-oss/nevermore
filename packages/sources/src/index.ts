export * from "./url-safety/index.ts";
export { normalizeSiteOrigin } from "./origin.ts";
export type { NormalizedOrigin } from "./origin.ts";
export * from "./adapter.ts";

// Contract seam (WP2 → WP3): canonical URL + observation vocabulary.
export * from "./canonical-url.ts";
export * from "./observations.ts";

// Credential crypto (spec §14.3).
export {
  CREDENTIAL_CIPHER_VERSION,
  encryptCredential,
  decryptCredential,
} from "./credentials/crypto.ts";

// Blob storage abstraction (spec §7.6, §13.3).
export { objectKey } from "./storage/types.ts";
export type {
  BlobStore,
  BlobPutInput,
  BlobPutResult,
  ObjectKeyParts,
} from "./storage/types.ts";
export { MemoryBlobStore } from "./storage/memory.ts";
export { LocalFsBlobStore } from "./storage/local-fs.ts";

// DataForSEO disabled stub (spec §7.2, AC-020).
export {
  DATAFORSEO_ENABLED,
  disabledCapability,
  dataforseoAdapter,
} from "./dataforseo/adapter.ts";

// Crawl adapter (spec §7.3).
export * from "./crawl/types.ts";
export { crawlAdapter, DEFAULT_CRAWL_USER_AGENT } from "./crawl/adapter.ts";
export { crawlSite, createDefaultCrawlFetcher } from "./crawl/engine.ts";
export type { CrawlEngineOptions } from "./crawl/engine.ts";
export { parsePage, directivesIndexable } from "./crawl/parse-page.ts";
export type { ParsedPage } from "./crawl/parse-page.ts";
export {
  parseRobots,
  isPathAllowed,
  emptyRobots,
  AI_BOT_USER_AGENTS,
} from "./crawl/robots.ts";
export type { RobotsGroup } from "./crawl/robots.ts";
export { parseSitemapXml, collectSitemap } from "./crawl/sitemap.ts";
export type { SitemapDocument } from "./crawl/sitemap.ts";

// GSC adapter (spec §7.4).
export { createGscAdapter, gscAdapter } from "./gsc/adapter.ts";
export type { GscConfig, GscParams, GscRaw } from "./gsc/adapter.ts";
export { HttpGscClient } from "./gsc/client.ts";
export type { GscClient, GscRow } from "./gsc/client.ts";
export { computeGscWindow } from "./gsc/window.ts";
export { normalizeGscRows, GSC_LIMITATION } from "./gsc/normalize.ts";

// CSV keyword-gap adapter (spec §7.5).
export { csvAdapter } from "./csv/adapter.ts";
export type { CsvConfig, CsvParams, CsvRaw } from "./csv/adapter.ts";
export { parseCsv, MAX_CSV_DATA_ROWS } from "./csv/parse.ts";
export { CLUSTER_KEY_VERSION, clusterKey } from "./csv/cluster-key.ts";
export {
  detectColumns,
  suggestMapping,
  normalizeHeader,
} from "./csv/mapping.ts";
export type {
  CsvColumnMapping,
  CsvCanonicalField,
  DetectedColumn,
} from "./csv/mapping.ts";
export {
  previewCsv,
  KEYWORD_GAP_TEMPLATE_ID,
  MAX_CSV_BYTES,
  PREVIEW_ROW_LIMIT,
} from "./csv/preview.ts";
export type { CsvPreviewResult } from "./csv/preview.ts";
export { normalizeCsv } from "./csv/normalize.ts";
export type { NormalizeCsvOptions } from "./csv/normalize.ts";

// GA4 adapter (spec §7.4).
export { createGa4Adapter } from "./ga4/adapter.ts";
export type { Ga4Config, Ga4Params, Ga4Raw } from "./ga4/adapter.ts";
export { HttpGa4Client } from "./ga4/client.ts";
export type { Ga4Client } from "./ga4/client.ts";
export { computeGa4Window } from "./ga4/window.ts";
export {
  normalizeGa4,
  GA4_KEY_EVENT_UNMAPPED,
  GA4_KEY_EVENT_REPORT_INCOMPATIBLE,
} from "./ga4/normalize.ts";
export type { Ga4KeyEventState, Ga4KeyEventStatus } from "./ga4/normalize.ts";
