// @input  -- audited record categories
// @output -- static, category-bound implementation and validation template keys
// @pos    -- preview-only solution guidance for selected observed conditions

import type { SeoAuditCategory } from "@sf/public-tools";

export type AgentTemplateCategory = SeoAuditCategory;

export interface AgentSolutionTemplate {
  readonly category: AgentTemplateCategory;
  readonly implementationKey: `categories.${AgentTemplateCategory}.implementation`;
  readonly validationKey: `categories.${AgentTemplateCategory}.validation`;
  readonly impactKey: `categories.${AgentTemplateCategory}.impact`;
}

const TEMPLATE_CATEGORIES: readonly AgentTemplateCategory[] = [
  "metadata",
  "structure",
  "structured_data",
  "crawl",
  "indexability",
  "links",
];

export function solutionTemplate(
  category: AgentTemplateCategory,
): AgentSolutionTemplate {
  const safeCategory = TEMPLATE_CATEGORIES.includes(category)
    ? category
    : "crawl";
  return {
    category: safeCategory,
    implementationKey: `categories.${safeCategory}.implementation`,
    validationKey: `categories.${safeCategory}.validation`,
    impactKey: `categories.${safeCategory}.impact`,
  };
}
