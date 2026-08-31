// @input -- an owner-verified immutable snapshot and its normalized host
// @output -- bounded input metadata and question quality diagnostics for history and exact-version loads
// @pos -- frozen role labels and prompt-set identity never come from the editable draft
import type { BriefFrozenChoice } from "./brief-handler.ts";
import type { GeoKbFrozenSnapshot } from "./kb-store.ts";
import { assessGeoQuestionQuality, geoQuestionProperNames } from "./question-quality.ts";

export function projectBriefFrozenChoice(frozen: GeoKbFrozenSnapshot, host: string): BriefFrozenChoice {
  return {
    kbId: frozen.kbId,
    host,
    snapshotId: frozen.snapshotId,
    revision: frozen.revision,
    frozenAt: frozen.frozenAt,
    contentHash: frozen.contentHash,
    market: { country: frozen.payload.market.country, language: frozen.payload.market.language },
    properNames: geoQuestionProperNames(frozen.payload),
    promptsetRef: { schema: frozen.questionSet.schemaVersion, registryVersion: frozen.questionSet.registryVersion, hash: frozen.questionSetHash },
    questions: frozen.questionSet.questions.map(question => {
      const role = question.roleId === null ? undefined : frozen.payload.roles.find(role => role.id === question.roleId);
      return {
        id: question.id,
        text: question.text,
        layer: question.layer,
        roleId: question.roleId,
        role: role === undefined ? null : { id: role.id, label: role.label, segment: role.segment },
        qualityIssues: assessGeoQuestionQuality(frozen.payload, question).issues.map(issue => issue.code),
      };
    }),
  };
}
