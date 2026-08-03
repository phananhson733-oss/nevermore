export * from "./url-safety/index.ts";
export * from "./public-http/index.ts";
export { normalizeSiteOrigin } from "./origin.ts";
export type { NormalizedOrigin } from "./origin.ts";
export { createSiteOriginProbe, probeSiteOrigin } from "./site-origin-probe.ts";
export type {
  SiteOriginProbe,
  SiteOriginProbeFetch,
  SiteOriginProbeInput,
  SiteOriginProbeOptions,
} from "./site-origin-probe.ts";
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
export {
  CREDENTIAL_ENVELOPE_VERSION,
  encodeCredentialEnvelope,
  decodeCredentialEnvelope,
  type OAuthCredentialEnvelope,
} from "./credentials/envelope.ts";
export {
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
  GOOGLE_TOKEN_REFRESH_SKEW_MS,
  GOOGLE_TOKEN_REFRESH_TIMEOUT_MS,
  GOOGLE_TOKEN_RESPONSE_MAX_BYTES,
  HttpGoogleTokenRefresher,
  shouldRefreshCredential,
} from "./credentials/refresh.ts";
export type {
  GoogleTokenFetch,
  HttpGoogleTokenRefresherOptions,
} from "./credentials/refresh.ts";

// Blob storage abstraction (spec §7.6, §13.3).
export {
  objectKey,
  parseObjectKey,
  BlobStorageError,
  BlobObjectAlreadyExistsError,
  BlobObjectNotFoundError,
  InvalidBlobObjectKeyError,
  BlobStoreConfigurationError,
  PRIVATE_BLOB_OBJECT_KINDS,
  MAX_BLOB_LIST_PAGE_SIZE,
} from "./storage/types.ts";
export type {
  BlobStore,
  BlobPutInput,
  BlobPutResult,
  BlobGetOptions,
  BlobListInput,
  BlobListPage,
  BlobObjectMetadata,
  PrivateBlobObjectKind,
  ObjectKeyParts,
} from "./storage/types.ts";
export { MemoryBlobStore } from "./storage/memory.ts";
export { LocalFsBlobStore } from "./storage/local-fs.ts";
export { SupabaseBlobStore, SupabaseStorageError } from "./storage/supabase.ts";
export type {
  StorageFetch,
  SupabaseBlobStoreConfig,
} from "./storage/supabase.ts";
export {
  createRuntimeBlobStore,
  createBlobStoreFromEnv,
  resolveBlobStorageBackend,
} from "./storage/runtime.ts";
export type {
  BlobStorageBackend,
  BlobStorageEnvironment,
  BlobStoreFromEnvOptions,
  RuntimeBlobStoreConfig,
} from "./storage/runtime.ts";

// Export-bundle download signer (AC-039, spec §10.5, §14.4).
export {
  createSupabaseDownloadSigner,
  blobStoreDownloadSigner,
  mintExportObjectKey,
  assertKeyInProjectScope,
  ObjectOutOfProjectScopeError,
  SupabaseSignError,
  InvalidDownloadUrlTtlError,
  EXPORT_DOWNLOAD_URL_TTL_SECONDS,
} from "./blob/supabase-signer.ts";
export type {
  DownloadUrlSigner,
  SupabaseSignerConfig,
} from "./blob/supabase-signer.ts";

// DataForSEO Labs ranked-keywords adapter.
export {
  createDataForSeoCollectionScope,
  createDataForSeoAdapter,
  dataForSeoParamsFromCollectionScope,
  dataForSeoSnapshotSummary,
  dataforseoAdapter,
  parseDataForSeoCollectionScope,
  DATAFORSEO_COLLECTION_SCOPE_VERSION,
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_QUERY_KIND,
  DATAFORSEO_ROW_CAP_STOP_REASON,
} from "./dataforseo/adapter.ts";
export type {
  DataForSeoAdapterOptions,
  DataForSeoCollectionLocation,
  DataForSeoCollectionScope,
  DataForSeoCollectionScopeInput,
  DataForSeoConfig,
  DataForSeoParams,
  DataForSeoRaw,
  DataForSeoRawRequest,
  DataForSeoSnapshotSummary,
} from "./dataforseo/adapter.ts";
export {
  HttpDataForSeoClient,
  DATAFORSEO_COMPETITORS_DOMAIN_LIVE_URL,
  DATAFORSEO_RANKED_KEYWORDS_LIVE_URL,
  DATAFORSEO_SERP_COMPETITORS_LIVE_URL,
  DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT,
  DEFAULT_DATAFORSEO_LIMIT,
  MAX_DATAFORSEO_LIMIT,
} from "./dataforseo/client.ts";
export type {
  DataForSeoClient,
  DataForSeoCompetitorDomainRow,
  DataForSeoCompetitorsDomainClient,
  DataForSeoCompetitorsDomainRequest,
  DataForSeoCompetitorsDomainResponse,
  DataForSeoFetch,
  DataForSeoRankedKeywordsClient,
  DataForSeoRankedKeywordRow,
  DataForSeoRankedKeywordsRequest,
  DataForSeoRankedKeywordsResponse,
  DataForSeoSearchLandscapeClient,
  DataForSeoSearchLandscapeV2Client,
  DataForSeoSerpCompetitorRow,
  DataForSeoSerpCompetitorsClient,
  DataForSeoSerpCompetitorsRequest,
  DataForSeoSerpCompetitorsResponse,
  HttpDataForSeoClientOptions,
} from "./dataforseo/client.ts";
export {
  createDataForSeoSearchLandscapeAdapter,
  createDataForSeoSearchLandscapeScope,
  dataForSeoSearchLandscapeSnapshotSummary,
  dataforseoSearchLandscapeAdapter,
  parseDataForSeoSearchLandscapeScope,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
  DATAFORSEO_SEARCH_LANDSCAPE_QUERY_KIND,
  DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_STOP_REASON,
  DATAFORSEO_SEARCH_LANDSCAPE_SCOPE_VERSION,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
} from "./dataforseo/search-landscape.ts";
export {
  createDataForSeoSearchLandscapeV2Adapter,
  createDataForSeoSearchLandscapeV2Scope,
  dataForSeoSearchLandscapeV2SnapshotSummary,
  dataforseoSearchLandscapeV2Adapter,
  parseDataForSeoSearchLandscapeV2Scope,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_OPERATION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_QUERY_KIND,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_ROW_CAP_STOP_REASON,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_SCOPE_VERSION,
  MAX_DATAFORSEO_SERP_COMPETITOR_SEEDS,
  METRIC_DATAFORSEO_SERP_COMPETITOR,
} from "./dataforseo/search-landscape-v2.ts";
export type {
  DataForSeoSearchLandscapeSeed,
  DataForSeoSearchLandscapeSeedKind,
  DataForSeoSearchLandscapeSerpCompetitorsRaw,
  DataForSeoSearchLandscapeV2Adapter,
  DataForSeoSearchLandscapeV2AdapterOptions,
  DataForSeoSearchLandscapeV2Capability,
  DataForSeoSearchLandscapeV2Raw,
  DataForSeoSearchLandscapeV2Scope,
  DataForSeoSearchLandscapeV2ScopeInput,
} from "./dataforseo/search-landscape-v2.ts";
export type {
  DataForSeoCompetitorDomainProjection,
  DataForSeoSearchLandscapeAdapter,
  DataForSeoSearchLandscapeAdapterOptions,
  DataForSeoSearchLandscapeCapability,
  DataForSeoSearchLandscapeCompetitorsDomainPolicy,
  DataForSeoSearchLandscapeCompetitorsDomainRaw,
  DataForSeoSearchLandscapeRankedKeywordsPolicy,
  DataForSeoSearchLandscapeRankedKeywordsRaw,
  DataForSeoSearchLandscapeRaw,
  DataForSeoSearchLandscapeScope,
  DataForSeoSearchLandscapeScopeInput,
  DataForSeoSearchLandscapeSnapshotSummary,
} from "./dataforseo/search-landscape.ts";

// Crawl adapter (spec §7.3).
export * from "./crawl/types.ts";
export {
  createCrawlAdapter,
  crawlAdapter,
  DEFAULT_CRAWL_USER_AGENT,
} from "./crawl/adapter.ts";
export type { CrawlAdapterOptions } from "./crawl/adapter.ts";
export { crawlSite, createDefaultCrawlFetcher } from "./crawl/engine.ts";
export type { CrawlEngineOptions } from "./crawl/engine.ts";
export {
  crawlPublicSitePreview,
  PUBLIC_PREVIEW_CRAWL_BUDGET,
  PUBLIC_PREVIEW_MAX_REQUESTS,
  PUBLIC_PREVIEW_CRAWL_USER_AGENT,
} from "./crawl/public-preview.ts";
export type { PublicPreviewCrawlOptions } from "./crawl/public-preview.ts";
export { parsePage, directivesIndexable } from "./crawl/parse-page.ts";
export type { ParsedPage } from "./crawl/parse-page.ts";
export {
  buildCrawlSiteLanguageSummary,
  parseCrawlSiteLanguageSnapshotSummary,
  parseHtmlLanguageDeclaration,
  CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT,
  CRAWL_SITE_LANGUAGE_SUMMARY_VERSION,
} from "./crawl/site-language.ts";
export type {
  CrawlPageLanguageEvidence,
  CrawlSiteLanguageEvidenceSample,
  CrawlSiteLanguageStatus,
  CrawlSiteLanguageSummary,
  HtmlLanguageDeclaration,
} from "./crawl/site-language.ts";
export {
  parseRobots,
  isPathAllowed,
  emptyRobots,
  AI_BOT_USER_AGENTS,
} from "./crawl/robots.ts";
export type { RobotsGroup } from "./crawl/robots.ts";
export { parseSitemapXml, collectSitemap } from "./crawl/sitemap.ts";
export type { SitemapDocument } from "./crawl/sitemap.ts";

// Worker-only governed public-web research retrieval.
export {
  PUBLIC_WEB_RESEARCH_ADAPTER_VERSION,
  PUBLIC_WEB_RESEARCH_CONTENT_HASH_METHOD,
  PUBLIC_WEB_RESEARCH_LIMITS,
  PUBLIC_WEB_RESEARCH_USER_AGENT,
  retrievePublicWebResearch,
} from "./research/retriever.ts";
export type {
  PublicWebResearchBatch,
  PublicWebResearchFetch,
  PublicWebResearchFetchInit,
  PublicWebResearchOptions,
  PublicWebResearchSnapshot,
  PublicWebResearchStopReason,
  PublicWebResearchUrlGuard,
  PublicWebResearchUsage,
} from "./research/retriever.ts";

// GSC adapter (spec §7.4).
export { createGscAdapter, gscAdapter } from "./gsc/adapter.ts";
export type { GscConfig, GscParams, GscRaw } from "./gsc/adapter.ts";
export { HttpGscClient } from "./gsc/client.ts";
export type { GscClient, GscRow } from "./gsc/client.ts";
export { HttpGscDailySeriesReader } from "./gsc/daily-series.ts";
export type {
  GscDailyPoint,
  GscDailyRange,
  GscDailySeriesReader,
} from "./gsc/daily-series.ts";
export { createSearchAnalyticsClient } from "./gsc/search-analytics.ts";
export type {
  SearchAnalyticsClientOptions,
  SearchAnalyticsDimension,
  SearchAnalyticsRequest,
  SearchAnalyticsResponse,
  SearchAnalyticsRow,
} from "./gsc/search-analytics.ts";
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
export type {
  Ga4AdapterOptions,
  Ga4Config,
  Ga4Params,
  Ga4Raw,
  Ga4ReportMetadata,
} from "./ga4/adapter.ts";
export {
  DEFAULT_GA4_REPORT_TIMEOUT_MS,
  GA4_MAX_ROWS,
  GA4_PAGINATION_CAP_LIMITATION,
  GA4_PAGINATION_CAP_STOP_REASON,
  GA4_ROW_CAP_LIMITATION,
  GA4_ROW_CAP_STOP_REASON,
  HttpGa4Client,
} from "./ga4/client.ts";
export type {
  Ga4Client,
  Ga4ReportResponse,
  Ga4ReportStopReason,
  Ga4RunReportOptions,
} from "./ga4/client.ts";
export { computeGa4Window } from "./ga4/window.ts";
export {
  normalizeGa4,
  GA4_LIMITATION,
  GA4_KEY_EVENT_REPORT_TRUNCATED,
  GA4_KEY_EVENT_UNMAPPED,
  GA4_KEY_EVENT_REPORT_INCOMPATIBLE,
} from "./ga4/normalize.ts";
export type { Ga4KeyEventState, Ga4KeyEventStatus } from "./ga4/normalize.ts";
