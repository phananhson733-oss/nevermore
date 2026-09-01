// @input -- a legacy draft with an exact, complete Profile copy
// @output -- detached V2 review data, not an implicit save or confirmation
// @pos -- shared server/editor preparation; old stored and frozen values are untouched
import type { GeoKbPayload } from "./kb-contract.ts";
import { GEO_KB_SCHEMA_VERSION_V2, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";

function legacyQuestionLabel(label: string, language: string): string {
  const candidate = label.trim().normalize("NFC");
  return /^en(?:-|$)/iu.test(language) && candidate.length <= 120 && /[A-Za-z]/u.test(candidate) && /^[\u0020-\u007e]+$/u.test(candidate)
    ? candidate : "";
}

export function upgradeGeoKbDraftToV2(payload: GeoKbPayload): GeoKbPayloadV2 {
  if (payload.profileCopy === undefined) throw new Error("Complete Profile copy required before V2 upgrade");
  const copy = structuredClone(payload);
  return { ...copy, schemaVersion: GEO_KB_SCHEMA_VERSION_V2, profileCopy: copy.profileCopy!,
    roles: copy.roles.map(role => ({ ...role, alternatives: [], questionLabel: legacyQuestionLabel(role.label, copy.market.language), review: "pending",
      source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: [] } })),
    facts: copy.facts.map(fact => ({ ...fact, review: "pending", supportRef: null })) };
}
