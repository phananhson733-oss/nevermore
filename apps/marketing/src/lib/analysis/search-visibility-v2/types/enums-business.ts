// @input  -- V1.3 §4 BusinessModel + §12.1 KW2.2 EXPECTED_DIMENSIONS_BY_MODEL
// @output -- BusinessModel + per-model expected SeedDimension table
// @pos    -- types/ 拆分，依赖 SeedDimension（来自 enums-classification）

import type { SeedDimension } from "./enums-classification";

// =====================================================
// V1.3 §4 BusinessModel（V1.3 拆分 SaaS PLG / Sales-led）
// =====================================================

export const ALL_BUSINESS_MODELS = [
  "content",
  "saas_plg",
  "saas_sales_led",
  "ecommerce",
  "marketplace",
  "tool",
  "local_business",
  "other",
] as const;
export type BusinessModel = (typeof ALL_BUSINESS_MODELS)[number];

// V1.3 §12.1 KW2.2 — Expected Seed Dimensions per business model
export const EXPECTED_DIMENSIONS_BY_MODEL: Record<
  BusinessModel,
  readonly SeedDimension[]
> = {
  content: [
    "category",
    "problem",
    "use_case",
    "template_asset",
    "industry_report",
  ],
  saas_plg: [
    "category",
    "problem",
    "use_case",
    "persona",
    "competitor",
    "integration",
    "pricing_procurement",
    "migration",
    "status_quo",
    "roi_calculator",
    "case_study",
  ],
  saas_sales_led: [
    "category",
    "problem",
    "use_case",
    "persona",
    "competitor",
    "integration",
    "pricing_procurement",
    "migration",
    "compliance_security",
    "roi_calculator",
    "case_study",
    "industry_report",
  ],
  ecommerce: [
    "category",
    "problem",
    "competitor",
    "pricing_procurement",
    "status_quo",
  ],
  marketplace: [
    "category",
    "use_case",
    "persona",
    "competitor",
    "pricing_procurement",
  ],
  tool: [
    "category",
    "problem",
    "use_case",
    "template_asset",
    "competitor",
    "roi_calculator",
  ],
  local_business: ["category", "problem", "pricing_procurement"],
  other: ["category", "problem", "use_case"],
};
