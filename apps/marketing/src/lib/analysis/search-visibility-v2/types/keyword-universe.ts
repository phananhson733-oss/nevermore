// @input  -- V1.3 §11.4 KeywordUniverseItem
// @output -- 单个 KeywordUniverseItem 接口（包含 sources/flags/gsc/intent/serp/coverage/cluster/priority/diagnostic 子结构）
// @pos    -- types/ 拆分，依赖多个 enum 类型

import type { CheckStatus, Confidence } from "./enums-status";
import type { KeywordIssueType } from "./enums-issue";
import type { PriorityBucket, HardFilterReason } from "./enums-priority";
import type { PageType } from "./enums-page-type";
import type {
  KeywordRiskType,
  SeedDimension,
} from "./enums-classification";
import type {
  BaseIntent,
  BuyerJourneyStage,
  FunnelStage,
  PageIntent,
} from "./enums-intent";
import type { KeywordSource } from "./inputs";
import type { RankingFeasibility } from "./serp";

export interface KeywordUniverseItem {
  keywordId: string;
  projectId: string;
  runId: string;

  keyword: string;
  normalizedKeyword: string;

  locale: string;
  country?: string;
  language?: string;

  sources: KeywordSource[];
  seedDimensions: SeedDimension[];

  flags: {
    isBrand: boolean;
    isNonBrand: boolean;
    isCompetitorAware: boolean;
    isCategory: boolean;
    isProblem: boolean;
    isUseCase: boolean;
    isQuestion: boolean;
    isComparison: boolean;
    isAlternative: boolean;
    isPricing: boolean;
    isIntegration: boolean;
    isTemplate: boolean;
    isMigration: boolean;
    isCompliance: boolean;
    isStatusQuo: boolean;
    isTypoVariant?: boolean;
  };

  gsc: {
    currentClicks: number;
    currentImpressions: number;
    currentCtr: number;
    currentPosition: number | null;
    previousClicks: number;
    previousImpressions: number;
    previousCtr: number;
    previousPosition: number | null;
    deltaClicks: number;
    deltaImpressions: number;
    deltaCtr: number;
    deltaPosition: number | null;
  };

  externalMetrics?: {
    searchVolume?: number;
    keywordDifficulty?: number;
    cpc?: number;
    trafficValue?: number;
    trendRatio3m?: number;
  };

  intent?: {
    baseIntent?: BaseIntent;
    funnelStage?: FunnelStage;
    buyerJourneyStage?: BuyerJourneyStage;
    pageIntent?: PageIntent;
    riskType?: KeywordRiskType;
    confidence?: number;
    classificationMethod?: "rules" | "serp" | "manual" | "mixed";
    humanReviewRequired?: boolean;
  };

  serp?: {
    hasSnapshot: boolean;
    dominantPageType?: PageType;
    dominantIntent?: BaseIntent;
    topDomains?: string[];
    topUrls?: string[];
    serpFeatures?: string[];
    rankingFeasibility?: RankingFeasibility;
    directCompetitorCountTop10?: number;
    directoryCountTop10?: number;
    communityCountTop10?: number;
    publisherCountTop10?: number;
    confidence?: Confidence;
  };

  coverage: {
    hasExistingPage: boolean;
    mappedUrl?: string;
    mappedPageType?: PageType;
    mappingConfidence?: number;
    ourBestRank?: number | null;
    ourRankingUrl?: string | null;
    hasCannibalizationRisk: boolean;
    cannibalizedUrls?: string[];
    canonicalConflict?: boolean;
  };

  cluster?: {
    clusterId?: string;
    clusterName?: string;
    isPrimaryKeyword?: boolean;
    clusterRole?: "primary" | "secondary" | "long_tail";
    icpIds?: string[];
    jtbdIds?: string[];
  };

  priority?: {
    hardFilterStatus: "pass" | "blocked" | "manual_review" | "not_evaluated";
    blockedReasons: HardFilterReason[];
    priorityBucket?: PriorityBucket;
    opportunityScore?: number;
  };

  diagnostic: {
    status: CheckStatus;
    issueTypes: KeywordIssueType[];
    confidence: Confidence;
  };
}
