// @input -- one immutable GEO Brief and optional quality assessment of its exact frozen question
// @output -- display-only evidence counts and Draft eligibility, never replacement source data
// @pos -- shared result/export quality projection; contract validation remains server-owned
import type { GeoContentBrief, GeoMustAnswerItem } from "@sf/public-tools/content-brief/geo-contract";

export function geoBriefQuality(brief: GeoContentBrief, options: { questionNeedsRevision?: boolean } = {}) {
  const origin = brief.geo_origin;
  const outlineSections = brief.outline.status === "available" ? brief.outline.items.length : 0;
  const usableFacts = brief.fact_table.filter(fact => fact.value !== null && fact.evidence_refs.length > 0
    && fact.evidence_refs.every(ref => brief.evidence.facts.some(receipt => receipt.id === ref && receipt.text === fact.value))).length;
  const missingFacts = brief.fact_table.length - usableFacts;
  const samples = brief.evidence.samples.filter(sample => sample.status === "answered" && sample.run_id === origin.run_ref?.id
    && sample.question_id === origin.question.id && origin.sample_refs.includes(sample.id));
  const observedQuestions = brief.must_answer.items.filter(item => item.source === "ai_sample" && item.covered_by > 0
    && item.sample_total === samples.length && item.covered_by === new Set(item.cluster.members.map(member => member.sample_id)).size
    && item.cluster.members.every(member => samples.some(sample => sample.id === member.sample_id && sample.topics.includes(member.heading)))).length;
  const status = options.questionNeedsRevision ? "revise_question" : outlineSections === 0 ? "no_outline" : usableFacts === 0 ? "structure_only"
    : missingFacts > 0 || samples.length === 0 || observedQuestions === 0 ? "limited" : "evidence_available";
  return {
    status,
    origin: origin.run_ref !== null ? "visibility" : origin.question.id !== null ? "frozen_question" : "typed_question",
    outlineSections, usableFacts, missingFacts, answeredSamples: samples.length, observedQuestions,
    hasProfile: origin.profile_ref !== null, hasSiteIndex: brief.evidence.site_index.length > 0,
    canDraft: outlineSections > 0 && !options.questionNeedsRevision,
  } as const;
}

export function geoBriefQuestionSource(brief: GeoContentBrief, item: GeoMustAnswerItem) {
  if (item.source === "ai_sample") return "observedQuestion";
  if (item.id !== brief.lead_answer.question_id && item.source === "kb") return "frozenCriterion";
  return brief.geo_origin.question.id === null ? "openingManual" : "openingFrozen";
}
