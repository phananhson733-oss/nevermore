/**
 * Canonical section contract (spec §10.1) shared by the deterministic templates
 * and the markdown validators. A single source of truth guarantees that the
 * template output round-trips through its own validator in every locale.
 *
 * Each section carries the English and zh-CN heading text. The template emits
 * the locale-appropriate heading; the validator accepts EITHER as an alias so a
 * document authored in either language passes without the caller knowing the
 * locale.
 */

import type { RequiredSection } from "./markdown.ts";

export interface SectionDef {
  /** Stable identifier used by templates to select a section body builder. */
  readonly key: string;
  /** English `## ` heading text (no leading `## `). */
  readonly en: string;
  /** zh-CN `## ` heading text. */
  readonly zh: string;
}

/** content_brief minimum sections (spec §10.1). */
export const CONTENT_BRIEF_SECTIONS: readonly SectionDef[] = [
  { key: "objective", en: "Objective", zh: "目标" },
  { key: "audience", en: "Audience", zh: "受众" },
  { key: "searchIntent", en: "Search Intent", zh: "搜索意图" },
  { key: "targetQueries", en: "Target Topics & Queries", zh: "目标主题与查询" },
  { key: "outline", en: "Outline", zh: "大纲" },
  { key: "evidence", en: "Evidence", zh: "证据" },
  { key: "conversionPath", en: "Conversion Path", zh: "转化路径" },
  { key: "proofRequirements", en: "Proof & Source Requirements", zh: "证明与来源要求" },
  { key: "acceptanceChecklist", en: "Acceptance Checklist", zh: "验收清单" },
];

/** technical_ticket always-required core sections (spec §10.1). */
export const TECHNICAL_TICKET_CORE_SECTIONS: readonly SectionDef[] = [
  { key: "problem", en: "Problem", zh: "问题" },
  { key: "affectedScope", en: "Affected Scope", zh: "影响范围" },
  { key: "evidence", en: "Evidence", zh: "证据" },
  { key: "implementationSteps", en: "Implementation Steps", zh: "实施步骤" },
  { key: "acceptanceTests", en: "Acceptance Tests", zh: "验收测试" },
  { key: "risk", en: "Risk", zh: "风险" },
];

/**
 * Validation + rollback sections. The template ALWAYS emits them (spec §10.1);
 * the validator requires them only when the source action is a high-risk
 * technical change (spec §9.3 step 8, `requiresValidationRollback`).
 */
export const TECHNICAL_TICKET_VALIDATION_SECTIONS: readonly SectionDef[] = [
  { key: "validation", en: "Validation", zh: "验证" },
  { key: "rollback", en: "Rollback", zh: "回滚" },
];

/** Full technical_ticket section set the template produces. */
export const TECHNICAL_TICKET_SECTIONS: readonly SectionDef[] = [
  ...TECHNICAL_TICKET_CORE_SECTIONS,
  ...TECHNICAL_TICKET_VALIDATION_SECTIONS,
];

/** Map a section definition to a validator RequiredSection (both locales accepted). */
export function toRequiredSection(def: SectionDef): RequiredSection {
  return { label: def.en, aliases: [def.en, def.zh] };
}
