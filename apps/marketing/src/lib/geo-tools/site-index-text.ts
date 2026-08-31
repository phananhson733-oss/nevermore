// @input -- frozen question terms and independently read titles/headings/body
// @output -- explicit lexical relevance evidence, never semantic or causal certainty
// @pos -- pure shared relevance method for index and gap validation
import { containsGeoAlias, normalizeAliasForMatch } from "../agents/geo-alias-match.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import type { VisibilityContextV2 } from "./visibility-v2-contract.ts";
const STOP = new Set(["the", "and", "for", "with", "what", "which", "how", "best", "top", "tools", "tool", "software", "are", "can", "does", "that", "this", "from", "right", "now", "good", "you", "your", "our", "their", "about", "compare", "comparison", "versus", "need", "find"]);
export function siteQuestionTerms(question: GeoQuestion, context: VisibilityContextV2): { readonly entities: readonly string[]; readonly terms: readonly string[]; readonly searchable: boolean } {
  const names = new Set([context.officialName, ...context.aliases, ...context.competitors.flatMap((c) => [c.brandName, ...(c.aliases ?? [])])].map(normalizeAliasForMatch));
  const entities = [...new Set(question.requiredEntities.map(normalizeAliasForMatch).filter((entity) => entity.length >= 3 && !names.has(entity) && !STOP.has(entity)))];
  const terms = [...new Set(normalizeAliasForMatch(question.text).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 3 && !STOP.has(term) && !names.has(term)))].slice(0, 16);
  return { entities, terms, searchable: entities.length > 0 || terms.length >= 2 };
}
export function matchSiteQuestion(question: GeoQuestion, context: VisibilityContextV2, headingText: string, bodyText: string): { readonly questionId: string; readonly entities: readonly string[]; readonly terms: readonly string[] } | null {
  const terms = siteQuestionTerms(question, context);
  if (!terms.searchable) return null;
  const body = normalizeAliasForMatch(bodyText), headings = normalizeAliasForMatch(headingText);
  const entities = terms.entities.filter((entity) => containsGeoAlias(body, [entity]));
  const matched = terms.terms.filter((term) => containsGeoAlias(headings, [term]));
  return entities.length > 0 || matched.length >= 2 ? { questionId: question.id, entities, terms: matched } : null;
}
