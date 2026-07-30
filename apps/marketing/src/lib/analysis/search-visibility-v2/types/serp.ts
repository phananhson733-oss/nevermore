// @input  -- V1.3 §11.8 SERP Intelligence
// @output -- RankingFeasibility / DomainType / SerpIntentMatch / SerpResult / DomainTypeCount / SerpSnapshot
// @pos    -- types/ 拆分，依赖 PageType / BaseIntent / Confidence

import type { PageType } from "./enums-page-type";
import type { BaseIntent } from "./enums-intent";
import type { Confidence } from "./enums-status";

export const ALL_RANKING_FEASIBILITIES = [
  "high",
  "medium",
  "low",
  "blocked",
  "unknown",
] as const;
export type RankingFeasibility = (typeof ALL_RANKING_FEASIBILITIES)[number];

export const ALL_DOMAIN_TYPES = [
  "direct_competitor",
  "review_directory",
  "publisher",
  "community",
  "marketplace",
  "official_docs",
  "product_site",
  "template_tool_site",
  "unknown",
] as const;
export type DomainType = (typeof ALL_DOMAIN_TYPES)[number];

// Canonical array so the JSONB-boundary zod schema (payload-schemas.ts) and this
// union stay in lockstep — same pattern as ALL_DOMAIN_TYPES / ALL_RANKING_FEASIBILITIES.
export const ALL_SERP_INTENT_MATCHES = ["high", "medium", "low"] as const;
export type SerpIntentMatch = (typeof ALL_SERP_INTENT_MATCHES)[number];

export interface SerpResult {
  rank: number;
  url: string;
  domain: string;
  domainType: DomainType;
  pageType: PageType;
  title?: string;
  intentMatch?: SerpIntentMatch;
}

export interface DomainTypeCount {
  domainType: DomainType;
  countTop10: number;
  countTop20?: number;
  shareTop10: number;
  sampleUrls: string[];
}

export interface SerpSnapshot {
  keywordId?: string;
  keyword: string;
  locale: string;
  capturedAt: string;
  topResults: SerpResult[];
  serpFeatures: string[];
  dominantPageType: PageType;
  dominantIntent: BaseIntent;
  topDomainTypes: DomainTypeCount[];
  rankingFeasibility: RankingFeasibility;
  confidence: Confidence;
  aiOverviewPresent?: boolean;
  zeroClickRiskScore?: number;
  // PR-11 §15.1 — SV6 增量投影（同一 Live 响应零新计费）；旧 payload 缺字段 ->
  // 对应 SV6 check 走 NA 路径（向后兼容）。
  featuredSnippetDomain?: string;
  paaSourceDomains?: string[];
  sitelinksCount?: number;
}
