// @input  -- V1.3 §6 §10.1 §10.4 §11 §4 顶层 run / analyze input/output / config
// @output -- KeywordPageMappingResult / RunOptions / RunResult / ResolvedPeriods / DataForSeoBundle / UrlInspectionSnapshot / SitemapSnapshot / KeywordPriorityResult / SearchVisibilityAnalyzeInput|Output / SearchVisibilityConfig
// @pos    -- types/ 拆分，最顶层组合接口（依赖几乎所有同级文件）

import type { IssueType } from "./enums-issue";
import type { PriorityBucket } from "./enums-priority";
import type { PageType } from "./enums-page-type";
import type { BusinessModel } from "./enums-business";
import type { GscBundle, GscPropertyType } from "./gsc";
import type { CompetitorKeyword, CrawlSnapshot, KeywordMetric } from "./inputs";
import type { SerpSnapshot } from "./serp";
import type { KeywordUniverseItem } from "./keyword-universe";
import type { KeywordCluster } from "./keyword-cluster";
import type { ModuleResult } from "./evidence-and-modules";
import type { DataQualityWarning } from "./data-quality";
import type { RunStatus, RunStep, RunStepStatus } from "./run-lifecycle";

// =====================================================
// V1.3 §11 KeywordPageMappingResult
// =====================================================

export interface KeywordPageMappingResult {
  runId: string;
  projectId: string;
  keywordId: string;
  keyword: string;
  pageUrl: string;
  pageType?: PageType;
  period: "current" | "previous";
  clicks: number;
  impressions: number;
  ctr: number;
  position?: number;
  dominantPageShare?: number;
  isDominantPage: boolean;
  mappingConfidence?: number;
  mappingIssueType?: IssueType;
}

// =====================================================
// V1.3 §10.1 RunOptions / RunResult
// =====================================================

export interface RunOptions {
  forceRefresh?: boolean;
  windowDays?: number;
  comparisonMode?: "previous_period" | "year_over_year";
  yearOverYearMode?: "weekday_aligned_364d" | "calendar_aligned_1y";
  dryRun?: boolean;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  score?: number;
  rawScore?: number;
  applicableWeight?: number;
  modules?: ModuleResult[];
  dataQualityWarnings?: DataQualityWarning[];
  stepStatuses: Record<RunStep, RunStepStatus>;
  errorSummary?: string;
  errorDetails?: { stack?: string; step?: RunStep; attemptCount?: number };
}

// =====================================================
// V1.3 §6 / §10.4 ResolvedPeriods
// =====================================================

export interface ResolvedPeriods {
  current: { startDate: string; endDate: string };
  previous: { startDate: string; endDate: string };
  extended?: { startDate: string; endDate: string };
  comparisonMode: "previous_period" | "year_over_year";
}

// =====================================================
// V1.3 §10.4 SearchVisibilityAnalyzeInput / DataForSeoBundle
// =====================================================

export interface DataForSeoBundle {
  keywordMetrics: KeywordMetric[];
  serpSnapshots: SerpSnapshot[];
  competitorKeywords: CompetitorKeyword[];
  available: boolean;
  cacheStats: { hits: number; misses: number; failures: number };
}

export interface UrlInspectionSnapshot {
  url: string;
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  lastCrawlTime?: string;
  crawledAs?: string;
  richResultsVerdict?: string;
  richResultsItems?: unknown[];
}

export interface SitemapSnapshot {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  type?: string;
  warnings?: number;
  errors?: number;
  submittedUrls?: number;
}

export interface KeywordPriorityResult {
  items: KeywordUniverseItem[];
  bucketCounts: Record<PriorityBucket, number>;
}

export interface SearchVisibilityAnalyzeInput {
  config: SearchVisibilityConfig;
  dateRanges: ResolvedPeriods;
  gscCurrent: GscBundle;
  gscPrevious: GscBundle;
  gscExtended?: GscBundle;
  sitemapSnapshots: SitemapSnapshot[];
  crawlSnapshot: CrawlSnapshot | null;
  keywordUniverse: KeywordUniverseItem[];
  queryPageMappings: KeywordPageMappingResult[];
  clusters: KeywordCluster[];
  priorityResult: KeywordPriorityResult;
  dataForSeoData: DataForSeoBundle | null;
  urlInspectionData: UrlInspectionSnapshot[] | null;
  dataQualityWarnings: DataQualityWarning[];
}

export interface SearchVisibilityAnalyzeOutput {
  modules: ModuleResult[];
  dataQualityWarnings: DataQualityWarning[];
}

// =====================================================
// V1.3 §4 SearchVisibilityConfig
// =====================================================

export interface SearchVisibilityConfig {
  projectId: string;
  siteUrl: string;
  gscPropertyType: GscPropertyType;
  domain: string;
  brandTerms: string[];
  targetCountries: string[];
  targetLanguages: string[];
  targetLocales: string[];
  businessModel: BusinessModel;
  targetKeywords: string[];
  mandatoryKeywords: string[];
  competitorDomains: string[];
  competitorBrandTerms?: string[];
  // PR-9 §11.8a — SERP domainType classification override/extend lists (union with
  // the curated defaults). Optional (default []); ops/ICP populate per project.
  reviewDirectoryDomains?: string[];
  publisherDomains?: string[];
  communityDomains?: string[];
  marketplaceDomains?: string[];
  keywordResearchEnabled: boolean;
  enableInternationalSeo: boolean | "auto";
  primarySearchType: "web" | "image" | "video" | "news";
  diagnosisWindowDays: number;
  comparisonMode: "previous_period" | "year_over_year";
  yearOverYearMode?: "weekday_aligned_364d" | "calendar_aligned_1y";
  minSiteImpressions: number;
  minItemImpressions: number;
  minItemClicks: number;
  maxGscRowsPerQuery: number;
  maxKeywordUniverseItems: number;
  maxSerpSnapshotKeywords: number;
  maxUrlInspectionUrls: number;
  gscFetchBudget?: {
    byQueryPage: number;
    byQuery: number;
    byPage: number;
    other: number;
  };
  dfsQuotaPolicy: "shared" | "per_project";
  dfsMaxConcurrency: number;
  searchVisibilityV2Enabled: boolean;
}
