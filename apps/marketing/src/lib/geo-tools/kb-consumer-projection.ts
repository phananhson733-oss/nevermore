// @input -- an already verified exact stored V1/V2 question set
// @output -- explicit common report fields and version-aware citation eligibility
// @pos -- consumer-only projection; never used to hash or rewrite frozen data
import type { AnyGeoQuestionSet } from "./kb-question-set-v2.ts";
import type { GeoQuestion } from "./kb-questions.ts";
export function projectFrozenGeoQuestions(set: AnyGeoQuestionSet): readonly GeoQuestion[] {
  if (set.schemaVersion === "marketing-geo-question-set.v1") return set.questions;
  return set.questions.map(question => {
    if (question.provenance.kind === "semantic" ? question.mode !== "demand" || question.calibrated || question.templateId !== null : question.mode !== "retrieval" || !question.calibrated || question.templateId === null) throw new Error("Invalid V2 consumer calibration policy");
    const { id, text, layer, mode, roleId, requiredEntities, templateId, calibrated } = question;
    return { id, text, layer, mode, roleId, requiredEntities: [...requiredEntities], templateId, calibrated };
  });
}
export function countGeoCitationQuestions(set: AnyGeoQuestionSet): number {
  const questions = projectFrozenGeoQuestions(set);
  return questions.filter(question => question.mode === "retrieval" && (set.schemaVersion === "marketing-geo-question-set.v1" || question.calibrated)).length;
}
