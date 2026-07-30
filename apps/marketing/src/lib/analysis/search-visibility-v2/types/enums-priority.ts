// @input  -- V1.3 §10.5 §11.11 PriorityBucket + HardFilterReason
// @output -- 7 PriorityBucket（含 backlog/blocked）+ 9 HardFilterReason
// @pos    -- types/ 拆分，PriorityResult / KeywordUniverseItem.priority 消费

// =====================================================
// V1.3 §10.5 §11.11 PriorityBucket（7 项含 backlog 默认）
// =====================================================

export const ALL_PRIORITY_BUCKETS = [
  "trend_window",
  "quick_win",
  "strategic_commercial",
  "long_tail_community",
  "mandatory_strategic",
  "backlog",
  "blocked",
] as const;
export type PriorityBucket = (typeof ALL_PRIORITY_BUCKETS)[number];

export const ALL_HARD_FILTER_REASONS = [
  "locale_mismatch",
  "icp_jtbd_unmapped",
  "serp_uncompetitive",
  "authority_gap_too_large",
  "no_page_type_fit",
  "insufficient_evidence",
  "legal_or_brand_risk",
  "duplicate_intent",
  "data_insufficient",
] as const;
export type HardFilterReason = (typeof ALL_HARD_FILTER_REASONS)[number];
