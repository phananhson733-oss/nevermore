// @input  -- V1.3 §11.10 KeywordCluster
// @output -- KeywordCluster 接口（含 metrics/serp/coverage/quality/priority 子结构）
// @pos    -- types/ 拆分，依赖 enum 集合 + KeywordUniverseItem 同级

import type { Confidence } from "./enums-status";
import type { PriorityBucket } from "./enums-priority";
import type { PageType } from "./enums-page-type";
import type { BaseIntent, FunnelStage, PageIntent } from "./enums-intent";

export interface KeywordCluster {
  clusterId: string;
  projectId: string;
  runId: string;

  clusterName: string;
  parentTopic?: string;

  primaryKeywordId: string;
  primaryKeyword: string;

  secondaryKeywords: string[];
  longTailKeywords: string[];

  intent: BaseIntent;
  funnelStage: FunnelStage;
  pageIntent: PageIntent;
  recommendedPageType: PageType;

  icpIds?: string[];
  jtbdIds?: string[];

  metrics: {
    keywordCount: number;
    totalSearchVolume?: number;
    totalGscImpressions: number;
    totalGscClicks: number;
    weightedCtr: number;
    weightedPosition?: number;
    weightedKd?: number;
    weightedCpc?: number;
  };

  serp: {
    dominantPageType?: PageType;
    topCompetitorDomains?: string[];
    serpFeatureSet?: string[];
  };

  coverage: {
    hasMappedPage: boolean;
    mappedUrl?: string;
    mappedPageType?: PageType;
    hasRanking: boolean;
    top10KeywordCount: number;
    top20KeywordCount: number;
    highImpressionZeroClickKeywordCount: number;
    cannibalizationRiskCount: number;
  };

  quality: {
    clusterCoherence?: number;
    intentConsistency?: number;
    pageTypeConsistency?: number;
    confidence: Confidence;
    status:
      | "candidate"
      | "approved"
      | "rejected"
      | "split_required"
      | "merge_required"
      | "manual_review";
  };

  priority?: {
    bucket?: PriorityBucket;
    opportunityScore?: number;
  };
}
