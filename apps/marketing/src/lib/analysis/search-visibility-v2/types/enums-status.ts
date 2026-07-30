// @input  -- V1.3 §9.1 §9.6 全局状态 / 置信度 / 数据源标签
// @output -- CheckStatus / Confidence / DataSourceTag closed enums
// @pos    -- types/ 拆分自原 types.ts，最底层枚举（无任何依赖）

// =====================================================
// V1.3 §9.1 全局状态 / 置信度
// =====================================================

export const ALL_CHECK_STATUSES = [
  "PASS",
  "WARNING",
  "CRITICAL",
  "NA",
] as const;
export type CheckStatus = (typeof ALL_CHECK_STATUSES)[number];

export const ALL_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Confidence = (typeof ALL_CONFIDENCES)[number];

// =====================================================
// V1.3 §9.6 数据源标签（V1.3 新增 CACHE）
// =====================================================

export const ALL_DATA_SOURCE_TAGS = [
  "GSC",
  "GSC_URL_INSPECTION",
  "GSC_SITEMAPS",
  "DATAFORSEO",
  "PROBE",
  "CRAWLER",
  "SYSTEM_CONFIG",
  "CACHE",
] as const;
export type DataSourceTag = (typeof ALL_DATA_SOURCE_TAGS)[number];
