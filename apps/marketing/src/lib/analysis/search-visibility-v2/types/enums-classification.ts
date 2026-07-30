// @input  -- V1.3 §10.5 §11.2 §11.3 §11.6 keyword 分类枚举集合
// @output -- SeedDimension / KeywordRiskType / KeywordSourceType
// @pos    -- types/ 拆分，3 组互相独立的关键词维度枚举

// =====================================================
// V1.3 §10.5 §11.3 SeedDimension 14 项（V1.2 11 + V1.3 3）
// =====================================================

export const ALL_SEED_DIMENSIONS = [
  // V1.2 base 11
  "category",
  "problem",
  "use_case",
  "persona",
  "competitor",
  "integration",
  "template_asset",
  "pricing_procurement",
  "migration",
  "compliance_security",
  "status_quo",
  // V1.3 新增 3
  "roi_calculator",
  "case_study",
  "industry_report",
] as const;
export type SeedDimension = (typeof ALL_SEED_DIMENSIONS)[number];

// =====================================================
// V1.3 §10.5 §11.6 KeywordRiskType 9 项（V1.2 5 + V1.3 YMYL 4）
// =====================================================

export const ALL_KEYWORD_RISK_TYPES = [
  // V1.2 base 5
  "safe",
  "comparative",
  "performance_claim",
  "legal_compliance",
  "sensitive",
  // V1.3 YMYL 新增 4
  "ymyl_medical",
  "ymyl_financial",
  "personal_data",
  "minors_protection",
] as const;
export type KeywordRiskType = (typeof ALL_KEYWORD_RISK_TYPES)[number];

// =====================================================
// V1.3 §11.2 KeywordSourceType
// =====================================================

export const ALL_KEYWORD_SOURCE_TYPES = [
  "gsc_existing_query",
  "target_keyword",
  "mandatory_keyword",
  "seed_expansion",
  "competitor_gap",
  "competitor_ranked_keyword",
  "paa",
  "autocomplete",
  "related_terms",
  "community",
  "trend",
  "social_probe",
  "manual_import",
] as const;
export type KeywordSourceType = (typeof ALL_KEYWORD_SOURCE_TYPES)[number];
