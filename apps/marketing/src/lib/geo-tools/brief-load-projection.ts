// @input -- an owner-verified immutable snapshot and its normalized host
// @output -- the same bounded input metadata for history and exact-version loads
// @pos -- frozen role labels and prompt-set identity never come from the editable draft
import type { BriefFrozenChoice } from "./brief-handler.ts";
import type { GeoKbFrozenSnapshot } from "./kb-store.ts";

export function projectBriefFrozenChoice(frozen: GeoKbFrozenSnapshot, host: string): BriefFrozenChoice {
  return {
    kbId: frozen.kbId,
    host,
    snapshotId: frozen.snapshotId,
    revision: frozen.revision,
    frozenAt: frozen.frozenAt,
    contentHash: frozen.contentHash,
    promptsetRef: { schema: frozen.questionSet.schemaVersion, registryVersion: frozen.questionSet.registryVersion, hash: frozen.questionSetHash },
    questions: frozen.questionSet.questions.map(question => {
      const role = question.roleId === null ? undefined : frozen.payload.roles.find(role => role.id === question.roleId);
      return {
        id: question.id,
        text: question.text,
        layer: question.layer,
        roleId: question.roleId,
        role: role === undefined ? null : { id: role.id, label: role.label, segment: role.segment },
      };
    }),
  };
}
