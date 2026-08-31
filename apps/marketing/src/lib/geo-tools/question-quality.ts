// @input -- frozen or draft question text and its owned knowledge-base payload
// @output -- bounded language/entity issues; never rewritten text or inferred facts
// @pos -- browser-safe quality checks shared by freezing and Brief generation
import type { GeoKbPayload } from "./kb-contract.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import { isSupportedGeoQuestionLanguage } from "./asset-context.ts";

export interface GeoQuestionQualityIssue {
  readonly code: "category_language_mismatch" | "question_language_mismatch" | "unrelated_required_entities";
  readonly field: "categoryTerms" | "question" | "requiredEntities";
  readonly values: readonly string[];
}

function entityPattern(entity: string): RegExp {
  const escaped = entity.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
}

export function geoQuestionReferencesEntity(text: string, entity: string): boolean {
  return entity.trim().length > 0 && entityPattern(entity).test(text.normalize("NFC"));
}

/** A script mismatch, not language detection: known proper names remain valid. */
export function geoQuestionLanguageIssue(text: string, language: string, properNames: readonly string[] = []): boolean {
  if (!isSupportedGeoQuestionLanguage(language)) return false;
  let wording = text.normalize("NFC");
  for (const name of [...properNames].filter((value) => value.trim().length > 0).sort((a, b) => b.length - a.length)) {
    wording = wording.replace(entityPattern(name), " ");
  }
  return [...wording].some((character) => /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character));
}

export function geoQuestionProperNames(payload: GeoKbPayload): readonly string[] {
  return [payload.officialName, ...payload.aliases, ...payload.competitors.flatMap((competitor) => [competitor.brandName, ...(competitor.aliases ?? [])])];
}

export function assessGeoQuestionQuality(payload: GeoKbPayload, question: Pick<GeoQuestion, "text" | "roleId" | "requiredEntities">, language = payload.market.language): { readonly ok: boolean; readonly issues: readonly GeoQuestionQualityIssue[] } {
  const issues: GeoQuestionQualityIssue[] = [];
  const properNames = geoQuestionProperNames(payload);
  const category = payload.categoryTerms[0] ?? "";
  if (geoQuestionLanguageIssue(category, language, properNames)) {
    issues.push({ code: "category_language_mismatch", field: "categoryTerms", values: [category] });
  }
  if (geoQuestionLanguageIssue(question.text, language, properNames)) {
    issues.push({ code: "question_language_mismatch", field: "question", values: [question.text] });
  }
  // Diagnose known background terms that the old policy promoted wholesale.
  // Unknown terms are left alone: lexical matching cannot prove semantic relevance.
  const background = new Set([
    ...payload.categoryTerms.slice(1), ...properNames,
    ...payload.roles.flatMap((role) => [role.label, role.segment, ...role.painPoints, ...role.decisionCriteria, ...role.vocabulary]),
  ].map((value) => value.normalize("NFC").toLowerCase()));
  const unrelated = question.requiredEntities.filter((entity) =>
    entity !== category && background.has(entity.normalize("NFC").toLowerCase()) && !geoQuestionReferencesEntity(question.text, entity),
  );
  if (unrelated.length > 0) {
    issues.push({ code: "unrelated_required_entities", field: "requiredEntities", values: unrelated });
  }
  return { ok: issues.length === 0, issues };
}
