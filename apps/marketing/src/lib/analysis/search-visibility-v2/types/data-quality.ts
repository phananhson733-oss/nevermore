// @input  -- V1.3 §10.2 DataQualityWarning 闭包码 + 接口
// @output -- DataQualityWarningCode / DataQualityWarning interface
// @pos    -- types/ 拆分，被几乎所有 connector / runner 返回值消费

export const ALL_DATA_QUALITY_WARNING_CODES = [
  "GSC_ROW_CAP_REACHED",
  "GSC_DATA_DELAY",
  "GSC_RETRY_EXHAUSTED",
  "DFS_QUOTA_LOW",
  "DFS_KEYWORD_BATCH_FAILED",
  "DFS_SERP_BATCH_FAILED",
  "DFS_SERP_SAMPLE_CLIPPED",
  "DFS_CIRCUIT_OPEN",
  "URL_INSPECTION_QUOTA_EXHAUSTED",
  "URL_INSPECTION_PARTIAL",
  "CRAWL_SNAPSHOT_STALE",
  "LOW_SAMPLE_SITE_WIDE",
  "DFS_UNAVAILABLE",
  "CONFIG_BRAND_TERMS_MISSING",
  "KEYWORD_UNIVERSE_TRUNCATED",
  "PAGE_MAPPINGS_TRUNCATED",
  "GSC_COUNTRY_DIMENSION_FAILED",
  "GSC_SEARCH_APPEARANCE_DIMENSION_FAILED",
  "GSC_IMAGE_SEARCHTYPE_FAILED",
  "GSC_VIDEO_SEARCHTYPE_FAILED",
  "GSC_SITEMAP_FETCH_FAILED",
] as const;
export type DataQualityWarningCode =
  (typeof ALL_DATA_QUALITY_WARNING_CODES)[number];

export interface DataQualityWarning {
  code: DataQualityWarningCode;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  context: Record<string, unknown>;
  affectedQueries?: string[];
  affectedChecks?: string[];
  emittedAt: string;
}
