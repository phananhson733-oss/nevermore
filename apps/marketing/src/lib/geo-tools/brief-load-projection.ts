// @input -- an owner-verified immutable snapshot and its normalized host
// @output -- bounded input metadata and question quality diagnostics, or null when the version asks nothing
// @pos -- frozen role labels and prompt-set identity never come from the editable draft
import type { BriefFrozenChoice } from "./brief-handler.ts";
import { geoVersionedPayloadIdentity, type VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import { assessGeoQuestionQuality, geoQuestionProperNames } from "./question-quality.ts";

/**
 * Null when the version has no question set.
 *
 * A v3 version may be published without one -- the question step is optional --
 * and a Brief is written against a frozen question. There is no honest empty
 * form of `promptsetRef`: its hash names the set the Brief is bound to, and a
 * zeroed one would claim a set that does not exist. The caller decides what to
 * do with a version it cannot offer.
 */
export function projectBriefFrozenChoice(frozen: VersionedGeoKbFrozenSnapshot, host: string): BriefFrozenChoice | null {
  const questionSet = frozen.questionSet;
  if (questionSet === null || frozen.questionSetHash === null) return null;
  const payload = geoVersionedPayloadIdentity(frozen.payload);
  return {
    kbId: frozen.kbId,
    host,
    snapshotId: frozen.snapshotId,
    revision: frozen.revision,
    frozenAt: frozen.frozenAt,
    contentHash: frozen.contentHash,
    market: { country: payload.market.country, language: payload.market.language },
    properNames: geoQuestionProperNames(payload),
    promptsetRef: { schema: questionSet.schemaVersion, registryVersion: questionSet.registryVersion, hash: frozen.questionSetHash },
    questions: questionSet.questions.map(question => {
      const role = question.roleId === null ? undefined : payload.roles.find(role => role.id === question.roleId);
      return {
        id: question.id,
        text: question.text,
        layer: question.layer,
        roleId: question.roleId,
        role: role === undefined ? null : { id: role.id, label: role.label, segment: role.segment },
        qualityIssues: assessGeoQuestionQuality(payload, question).issues.map(issue => issue.code),
      };
    }),
  };
}
