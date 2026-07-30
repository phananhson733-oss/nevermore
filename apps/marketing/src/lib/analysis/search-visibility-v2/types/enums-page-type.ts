// @input  -- V1.3 §10.5 §11.7 PageType 24 项（V1.2 19 + V1.3 5）
// @output -- PageType closed enum
// @pos    -- types/ 拆分，被 ExistingPage / SerpResult / KeywordCluster 等共用

// =====================================================
// V1.3 §10.5 §11.7 PageType 24 项（V1.2 19 + V1.3 5）
// =====================================================

export const ALL_PAGE_TYPES = [
  // V1.2 base 19
  "category_pillar",
  "use_case_page",
  "problem_led_guide",
  "comparison_page",
  "alternatives_pillar",
  "competitor_alternative_page",
  "persona_page",
  "industry_page",
  "integration_page",
  "template_page",
  "calculator_tool_page",
  "glossary_definition_page",
  "migration_page",
  "pricing_cost_page",
  "security_compliance_page",
  "product_page",
  "docs_tutorial",
  "blog_article",
  "unknown",
  // V1.3 新增 5
  "ecommerce_plp",
  "ecommerce_pdp",
  "case_study_page",
  "industry_report_page",
  "event_landing_page",
] as const;
export type PageType = (typeof ALL_PAGE_TYPES)[number];
