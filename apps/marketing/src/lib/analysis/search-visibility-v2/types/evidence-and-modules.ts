// @input  -- V1.3 §9.6 EvidenceItem + ModuleResult / KeywordSubModuleResult / CheckResult
// @output -- module-level 结果合集（finalScore + sub-module + check-level）
// @pos    -- types/ 拆分，依赖 status / data-source / issue / data-quality

import type {
  CheckStatus,
  Confidence,
  DataSourceTag,
} from "./enums-status";
import type { IssueType } from "./enums-issue";
import type { DataQualityWarning } from "./data-quality";

// =====================================================
// V1.3 §9.6 EvidenceItem
// =====================================================

export type EvidenceItemType =
  | "query"
  | "page"
  | "query_page"
  | "country"
  | "device"
  | "serp_feature"
  | "competitor"
  | "url_inspection"
  | "sitemap"
  | "crawl"
  | "cluster";

export type EvidenceConfidenceTag = "CACHED" | "STALE" | "CAPPED" | "INFERRED";

export interface EvidenceItem {
  type: EvidenceItemType;
  label: string;
  metrics: {
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
    previousClicks?: number;
    previousImpressions?: number;
    previousCtr?: number;
    previousPosition?: number;
    deltaClicks?: number;
    deltaImpressions?: number;
    deltaCtr?: number;
    deltaPosition?: number;
    estimatedLostClicks?: number;
    searchVolume?: number;
    cpc?: number;
    keywordDifficulty?: number;
    opportunityScore?: number;
  };
  url?: string;
  query?: string;
  country?: string;
  device?: string;
  competitorDomain?: string;
  clusterId?: string;
  source: DataSourceTag;
  confidenceTags?: EvidenceConfidenceTag[];
}

// =====================================================
// V1.3 §9.6 ModuleResult / KeywordSubModuleResult / CheckResult
// =====================================================

export type ModuleId =
  | "SV1"
  | "SV2"
  | "SV3"
  | "SV4"
  | "SV5"
  | "SV6"
  | "SV7"
  | "SV8";
export type SubModuleId =
  | "KW1"
  | "KW2"
  | "KW3"
  | "KW4"
  | "KW5"
  | "KW6"
  | "KW7"
  | "KW8"
  | "KW9"
  | "KW10";

export type CheckUnit =
  | "count"
  | "percent"
  | "position"
  | "score"
  | "url"
  | "query"
  | "domain"
  | "cluster";

export interface CheckResult {
  id: string;
  moduleId: ModuleId;
  subModuleId?: SubModuleId;
  title: string;
  status: CheckStatus;
  confidence: Confidence;
  weight: number;
  currentValue?: number | string | null;
  previousValue?: number | string | null;
  baselineValue?: number | string | null;
  deltaAbs?: number | null;
  deltaPct?: number | null;
  unit?: CheckUnit;
  issueType: IssueType;
  evidenceSummary: string;
  evidenceItems: EvidenceItem[];
  dataSources: DataSourceTag[];
  lowSample: boolean;
  applicable: boolean;
  capped: boolean;
}

export interface KeywordSubModuleResult {
  id: SubModuleId;
  title: string;
  score: number | null;
  scoreDisplay: number | null;
  weight: number;
  status: CheckStatus;
  applicable: boolean;
  checks: CheckResult[];
}

export interface ModuleResult {
  id: ModuleId;
  title: string;
  score: number | null;
  scoreDisplay: number | null;
  weight: number;
  status: CheckStatus;
  applicable: boolean;
  summary: {
    passed: number;
    warnings: number;
    critical: number;
    na: number;
  };
  dataSources: DataSourceTag[];
  checks: CheckResult[];
  subModules?: KeywordSubModuleResult[];
}

export interface FinalScoreResult {
  finalScore: number | null; // null when all modules NA
  rawScore: number | null; // null when all modules NA
  applicableWeight: number; // 0 when all modules NA, 100 (no SV8), 110 (with SV8)
  modules: ModuleResult[];
  dataQualityWarnings: DataQualityWarning[];
}
