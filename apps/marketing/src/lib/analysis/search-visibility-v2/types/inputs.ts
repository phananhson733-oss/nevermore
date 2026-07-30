// @input  -- V1.3 §10.1 输入接口集合（爬取 / 关键词 metric / Product / ICP / JTBD）
// @output -- ExistingPage / CrawlSnapshot / KeywordMetric / CompetitorKeyword / KeywordSource(Item) / ProductProfile / IcpRecord / JtbdRecord
// @pos    -- types/ 拆分，依赖 PageType / KeywordSourceType / SeedDimension

import type { PageType } from "./enums-page-type";
import type { KeywordSourceType, SeedDimension } from "./enums-classification";

export interface ExistingPage {
  url: string;
  canonicalUrl?: string;
  title?: string;
  metaDescription?: string;
  h1?: string;
  pageType?: PageType;
  locale?: string;
  isCrawlable: boolean;
  isIndexable: boolean;
  robotsNoindex?: boolean;
  schemaTypes: string[];
  hreflangTags?: { lang: string; href: string }[];
  internalLinksInCount?: number;
  internalLinksOutCount?: number;
  // sv-crawl-snapshot — true 表示该页的 title/meta 来自真实抓取记录（technical_pages
  // 有对应行）；false 表示该 URL 只在 inventory 出现、无抓取元数据（如抓取失败页）。
  // undefined = 旧调用方未标注（消费方按"已加载"对待，向后兼容）。SV5.5 必须对
  // `=== false` 的页跳过 title/meta 评估——否则会把"未抓取"误判为"缺 title"（捏造）。
  metadataLoaded?: boolean;
}

export interface CrawlSnapshot {
  snapshotId: string;
  projectId: string;
  capturedAt: string;
  pages: ExistingPage[];
  crawlableUrlCount: number;
  indexableUrlCount: number;
  localizedPathsDetected?: boolean;
  hreflangDetected?: boolean;
}

export interface KeywordMetric {
  keyword: string;
  normalizedKeyword: string;
  country: string;
  language: string;
  searchVolume?: number;
  cpc?: number;
  keywordDifficulty?: number;
  competition?: number;
  trafficValue?: number;
  trendRatio3m?: number;
  source: "DATAFORSEO";
  capturedAt: string;
  cacheHit?: boolean;
}

export interface CompetitorKeyword {
  keyword: string;
  competitorDomain: string;
  position: number;
  url?: string;
  searchVolume?: number;
  traffic?: number;
  cpc?: number;
  country: string;
  language: string;
  source: "DATAFORSEO";
  capturedAt: string;
}

export interface KeywordSourceItem {
  keyword: string;
  sourceType: KeywordSourceType;
  seedDimension?: SeedDimension;
  locale?: string;
  country?: string;
  language?: string;
  weight?: number;
  detail?: Record<string, unknown>;
}

export interface KeywordSource {
  type: KeywordSourceType;
  detail?: Record<string, unknown>;
  weight?: number;
}

export interface ProductProfile {
  productName: string;
  categoryTerms: string[];
  useCases: string[];
  integrations?: string[];
  pricingTerms?: string[];
  complianceTerms?: string[];
}

export interface IcpRecord {
  id: string;
  name: string;
  personas: string[];
  industries?: string[];
  pains?: string[];
  priority?: number;
}

export interface JtbdRecord {
  id: string;
  statement: string;
  triggers?: string[];
  outcomes?: string[];
  relatedSeedDimensions?: SeedDimension[];
}
