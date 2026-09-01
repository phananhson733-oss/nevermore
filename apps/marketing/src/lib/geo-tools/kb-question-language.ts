// @input -- GEO question placeholders, separate from immutable Profile prose and brand names
// @output -- explicit language readiness; never translates or changes stored inputs
// @pos -- English registry quality guard for newly prepared questions
import { isSupportedGeoQuestionLanguage } from "./asset-context.ts";
import { validateGeoPlaceholderValue } from "../agents/geo-template-registry.ts";
import { validGeoCategoryPlaceholders } from "./kb-question-placeholders.ts";
import type { GeoKbPayload } from "./kb-contract.ts";
export type GeoQuestionLanguageIssue = "unsupported_language" | "category_terms_not_english" | "role_terms_not_english";
/** Latin-script terms are compatible with the English registry, not a translation claim. */
function isEnglishRegistryTerm(text: string): boolean {
  return /\p{Script=Latin}/u.test(text) && !/[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\p{Separator}\p{Mark}\s]/u.test(text);
}
export interface GeoQuestionInputOptions {
  readonly roleLayersSkipped?: boolean;
  /** Exact supported roles in source-conditioned generation; omitted for legacy all-role generation. */
  readonly activeRoleIds?: readonly string[];
}
function activeRoles(payload: GeoKbPayload, options: GeoQuestionInputOptions) {
  return options.roleLayersSkipped ? [] : payload.roles.filter(role => options.activeRoleIds === undefined || options.activeRoleIds.includes(role.id));
}
export function geoQuestionLanguageIssues(payload: GeoKbPayload, options: GeoQuestionInputOptions = {}): readonly GeoQuestionLanguageIssue[] {
  if (!isSupportedGeoQuestionLanguage(payload.market.language)) return ["unsupported_language"];
  const issues: GeoQuestionLanguageIssue[] = [];
  if (payload.categoryTerms[0] !== undefined && !isEnglishRegistryTerm(payload.categoryTerms[0])) issues.push("category_terms_not_english");
  if (activeRoles(payload, options).some(role => !isEnglishRegistryTerm(role.label))) issues.push("role_terms_not_english");
  return issues;
}

export function geoQuestionPlaceholderIssues(payload: GeoKbPayload, options: GeoQuestionInputOptions = {}): readonly ("category_placeholder_invalid" | "role_placeholder_invalid")[] {
  const issues: ("category_placeholder_invalid" | "role_placeholder_invalid")[] = [];
  if (payload.categoryTerms[0] !== undefined && !validGeoCategoryPlaceholders(payload.categoryTerms[0])) issues.push("category_placeholder_invalid");
  if (activeRoles(payload, options).some(role => validateGeoPlaceholderValue("buyer", role.label) !== null)) issues.push("role_placeholder_invalid");
  return issues;
}
