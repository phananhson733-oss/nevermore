// @input -- an editable GEO draft or an already persisted role proposal
// @output -- detached V2 editor values; adoption and edits never imply approval
// @pos -- client-only editing helpers, with no requests or persistence
import type { GeoKbFactV2, GeoKbPayloadV2, GeoKbRoleV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import type { GeoSynthesisRole } from "../../lib/geo-tools/kb-synthesis-contract.ts";
import { geoProfileFactSource, pendingGeoProfileFact } from "./geo-kb-feature-candidates.ts";
import { cleanGeoList, cleanGeoText } from "../../lib/geo-tools/kb-v2-clean.ts";
export { upgradeGeoKbDraftToV2 } from "../../lib/geo-tools/kb-upgrade.ts";

export type GeoKbRoleBodyPatch = Partial<Pick<GeoKbRoleV2,
  "label" | "questionLabel" | "segment" | "painPoints" | "decisionCriteria" | "vocabulary" | "alternatives">>;
export type GeoKbFactBodyPatch = Partial<Pick<GeoKbFactV2,
  "key" | "value" | "reason" | "sourceUrl" | "observedAt">>;

const roleFields = ["label", "questionLabel", "segment", "painPoints", "decisionCriteria", "vocabulary", "alternatives"] as const;
const factFields = ["key", "value", "reason", "sourceUrl", "observedAt"] as const;
const clean = cleanGeoText, cleanList = cleanGeoList;

/** Editor normalization only. Validation remains separate so unfinished rows
 * can be identified in the UI; nothing is truncated, filled or approved here. */
export function submitGeoKbPayloadV2(payload: GeoKbPayloadV2): GeoKbPayloadV2 {
  const copy = structuredClone(payload);
  return { ...copy,
    targetUrl: clean(copy.targetUrl), officialName: clean(copy.officialName), aliases: cleanList(copy.aliases), categoryTerms: cleanList(copy.categoryTerms),
    market: { country: clean(copy.market.country).toUpperCase(), language: clean(copy.market.language).toLowerCase() },
    roles: copy.roles.map(role => ({ ...role, id: clean(role.id), label: clean(role.label), questionLabel: clean(role.questionLabel), segment: clean(role.segment),
      painPoints: cleanList(role.painPoints), decisionCriteria: cleanList(role.decisionCriteria), vocabulary: cleanList(role.vocabulary), alternatives: cleanList(role.alternatives) })),
    competitors: copy.competitors.map(competitor => ({ ...competitor, domain: clean(competitor.domain).toLowerCase(), brandName: clean(competitor.brandName),
      ...(competitor.aliases === undefined ? {} : { aliases: cleanList(competitor.aliases) }) })),
    facts: copy.facts.map(fact => ({ ...fact, key: clean(fact.key), value: clean(fact.value), sourceUrl: clean(fact.sourceUrl), observedAt: clean(fact.observedAt) })) };
}

/** Keep raw typing, including trailing spaces. Canonicalization is for submit,
 * not keystrokes. A text edit retains its original source but needs re-review. */
export function editGeoKbRoleV2(role: GeoKbRoleV2, patch: GeoKbRoleBodyPatch): GeoKbRoleV2 {
  const changed = roleFields.filter(field => patch[field] !== undefined && JSON.stringify(role[field]) !== JSON.stringify(patch[field]));
  if (changed.length === 0) return role;
  const body = Object.fromEntries(changed.map(field => [field, structuredClone(patch[field])])) as GeoKbRoleBodyPatch;
  return { ...structuredClone(role), ...body, review: "pending" };
}

/** Support refers to the exact fact claim. A changed reason also invalidates
 * approval/support: conflict or unknown is not the previously accepted claim. */
export function editGeoKbFactV2(fact: GeoKbFactV2, patch: GeoKbFactBodyPatch): GeoKbFactV2 {
  const changed = factFields.filter(field => patch[field] !== undefined && fact[field] !== patch[field]);
  if (changed.length === 0) return fact;
  const body = Object.fromEntries(changed.map(field => [field, patch[field]])) as GeoKbFactBodyPatch;
  return { ...structuredClone(fact), ...body, review: "pending", supportRef: null };
}

/** Caller must use a successfully persisted, validated generation. This only
 * converts selected proposals; it does not merge or overwrite current drafts. */
export function adoptGeoKbRoleProposals(roles: readonly GeoSynthesisRole[], generationId: string): readonly GeoKbRoleV2[] {
  return roles.map(proposal => {
    const { evidenceRefs, ...role } = structuredClone(proposal);
    return { ...role, review: "pending", source: { kind: "model", generationId, itemId: proposal.id, evidenceRefs } };
  });
}

/**
 * Turning an inherited Profile value into a pending fact, with whatever source
 * the archive already recorded for that field. The fact is never accepted here.
 */
export function appendGeoProfileFactV2(payload: GeoKbPayloadV2, key: string, value: string): GeoKbPayloadV2 | null {
  const candidate = pendingGeoProfileFact(key, value, payload.facts, geoProfileFactSource(payload.profileCopy.profile, key));
  return candidate.status === "ready"
    ? { ...payload, facts: [...payload.facts, { ...candidate.fact, review: "pending", supportRef: null }] }
    : null;
}
