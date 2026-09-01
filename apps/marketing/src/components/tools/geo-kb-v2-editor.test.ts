import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile } from "../../lib/account-websites/contracts.ts";
import { emptyGeoKbPayload, type GeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { createGeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import type { GeoSynthesisRole } from "../../lib/geo-tools/kb-synthesis-contract.ts";
import { adoptGeoKbRoleProposals, editGeoKbFactV2, editGeoKbRoleV2, submitGeoKbPayloadV2, upgradeGeoKbDraftToV2 } from "./geo-kb-v2-editor.ts";

const GENERATION = "aaaaaa11-1111-4111-8111-111111111111";
function legacy(): GeoKbPayload {
  const profile = { ...emptyMarketingWebsiteProfile(), productName: "  Cafe\u0301 original  ", primaryIcp: "团队", country: "US", locale: "en-US" };
  const profileCopy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) }, profile);
  return { ...emptyGeoKbPayload("https://example.com"), profileCopy, officialName: "Acme", aliases: ["Acme"], categoryTerms: ["analytics"],
    roles: [{ id: "r1", label: "Finance teams", segment: "small companies", painPoints: ["late invoices"], decisionCriteria: ["setup effort"], vocabulary: ["receivables"] }],
    competitors: [{ domain: "rival.example", brandName: "Rival", aliases: ["Rival Analytics"], confirmed: true }],
    facts: [{ key: "Seats", value: "3", reason: "", sourceUrl: "https://example.com/pricing?plan=team#limits", observedAt: "2026-08-31T00:00:00.000Z" }],
    importedFrom: { websiteId: profileCopy.websiteId, snapshotId: profileCopy.snapshotId, snapshotRevision: "1" } };
}
function v2(): GeoKbPayloadV2 {
  const original = legacy();
  return { ...original, schemaVersion: "marketing-geo-kb.v2", profileCopy: original.profileCopy!,
    roles: [{ ...original.roles[0]!, questionLabel: "finance teams", alternatives: ["spreadsheets"], review: "accepted",
      source: { kind: "model", generationId: GENERATION, itemId: "r1", evidenceRefs: ["profile:primaryIcp", "gsc:G1"] } }],
    facts: [{ ...original.facts[0]!, review: "accepted", supportRef: { receiptId: "33333333-3333-4333-8333-333333333333", evidenceId: "F1" } }] };
}

describe("upgrade a complete legacy draft without rewriting it", () => {
  it("preserves every V1 field and the exact full Profile copy while adding pending-only metadata", () => {
    const source = legacy(), before = structuredClone(source);
    const result = upgradeGeoKbDraftToV2(source);
    expect(source).toEqual(before);
    expect(result).toEqual({ ...source, schemaVersion: "marketing-geo-kb.v2",
      roles: source.roles.map(role => ({ ...role, alternatives: [], questionLabel: "Finance teams", review: "pending", source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: [] } })),
      facts: source.facts.map(fact => ({ ...fact, review: "pending", supportRef: null })) });
    expect(result.profileCopy).not.toBe(source.profileCopy);
    expect(result.roles[0]?.painPoints).not.toBe(source.roles[0]?.painPoints);
  });
  it("refuses an incomplete Profile rather than inventing its copy", () => {
    const { profileCopy: _copy, ...source } = legacy();
    expect(() => upgradeGeoKbDraftToV2(source)).toThrow(/Profile copy/u);
  });
  it.each([
    ["财务团队", "en", ""], ["Finance 团队", "en", ""], ["Équipes financières", "en", ""],
    ["Finance teams", "zh-cn", ""], ["12345", "en", ""], ["A".repeat(121), "en", ""],
    ["  Finance teams  ", "en-gb", "Finance teams"],
  ])("does not guess or truncate an English question label for %s (%s)", (label, language, expected) => {
    const source = legacy();
    const result = upgradeGeoKbDraftToV2({ ...source, market: { ...source.market, language }, roles: [{ ...source.roles[0]!, label }] });
    expect(result.roles[0]?.questionLabel).toBe(expected);
    expect(result.roles[0]?.label).toBe(label);
  });
});

describe("complete V2 submission", () => {
  it("retains source, support, alternatives and review metadata without using the lossy V1 serializer", () => {
    const source = v2(), before = structuredClone(source);
    const result = submitGeoKbPayloadV2(source);
    expect(result).toEqual(source); expect(source).toEqual(before);
    expect(result).not.toBe(source); expect(result.profileCopy).not.toBe(source.profileCopy);
    expect(result.roles[0]?.source).not.toBe(source.roles[0]?.source);
    expect(result.facts[0]?.supportRef).not.toBe(source.facts[0]?.supportRef);
    expect(parseGeoKbPayloadV2(result)).toEqual(result);
  });
  it("trims and NFC-normalizes editable values but never normalizes the copied Profile or provenance", () => {
    const source = v2();
    const draft: GeoKbPayloadV2 = { ...source, targetUrl: " https://example.com/path?x=1#part ", officialName: " Cafe\u0301 ", aliases: [" Cafe\u0301 ", "Café", ""], categoryTerms: [" analytics "], market: { country: " gb ", language: " en-GB " },
      roles: [{ ...source.roles[0]!, label: "  Finance teams ", questionLabel: " finance teams ", segment: " small companies ", painPoints: [" late invoices ", "late invoices", ""], decisionCriteria: [" setup effort "], vocabulary: [" Cafe\u0301 "], alternatives: [" spreadsheets "] }],
      competitors: [{ domain: " RIVAL.EXAMPLE ", brandName: " Rival ", aliases: [" Rival Analytics "], confirmed: true }],
      facts: [{ ...source.facts[0]!, key: " Seats ", value: " 3 ", sourceUrl: " https://example.com/pricing?plan=team#limits ", observedAt: " 2026-08-31T00:00:00.000Z " }] };
    const result = submitGeoKbPayloadV2(draft);
    expect(result).toMatchObject({ targetUrl: "https://example.com/path?x=1#part", officialName: "Café", aliases: ["Café"], categoryTerms: ["analytics"], market: { country: "GB", language: "en-gb" } });
    expect(result.roles[0]).toEqual({ ...source.roles[0]!, vocabulary: ["Café"] });
    expect(result.competitors).toEqual(source.competitors); expect(result.facts).toEqual(source.facts);
    expect(result.profileCopy).toEqual(source.profileCopy); expect(result.profileCopy.profile.productName).toBe("  Cafe\u0301 original  ");
    expect(parseGeoKbPayloadV2(result)).toEqual(result);
  });
  it("does not fill source, review, timestamp or reason for pending rows and never truncates long input", () => {
    const source = v2();
    const draft = { ...source, aliases: ["x".repeat(81)], facts: [{ ...source.facts[0]!, value: "proposed", sourceUrl: "", observedAt: "", review: "pending" as const, supportRef: null }] };
    const result = submitGeoKbPayloadV2(draft);
    expect(result.aliases).toEqual(draft.aliases); expect(result.facts).toEqual(draft.facts);
    expect(() => parseGeoKbPayloadV2(result)).toThrow();
  });
});

describe("review invalidation never rewrites lineage", () => {
  it.each(["label", "questionLabel", "segment", "painPoints", "decisionCriteria", "vocabulary", "alternatives"] as const)("makes an edited role %s pending and keeps its source", field => {
    const role = v2().roles[0]!;
    const patch = { [field]: typeof role[field] === "string" ? "New text " : ["New item"] };
    const changed = editGeoKbRoleV2(role, patch);
    expect(changed[field]).toEqual(patch[field]); expect(changed.review).toBe("pending");
    expect(changed.source).toEqual(role.source); expect(changed.id).toBe(role.id); expect(role.review).toBe("accepted");
  });
  it("preserves accepted role review on no-op scalar or array patches", () => {
    const role = v2().roles[0]!;
    expect(editGeoKbRoleV2(role, { label: role.label, alternatives: [...role.alternatives] })).toBe(role);
    expect(editGeoKbRoleV2(role, {})).toBe(role);
  });
  it.each(["key", "value", "sourceUrl", "observedAt", "reason"] as const)("clears fact support and approval on a real %s change", field => {
    const fact = v2().facts[0]!;
    const patch = field === "reason" ? { reason: "conflicting" as const } : { [field]: "Changed" };
    const changed = editGeoKbFactV2(fact, patch);
    expect(changed).toEqual({ ...fact, ...patch, review: "pending", supportRef: null });
    expect(fact.review).toBe("accepted"); expect(fact.supportRef).not.toBeNull();
  });
  it("keeps fact approval and support for a no-op", () => {
    const fact = v2().facts[0]!;
    expect(editGeoKbFactV2(fact, { value: fact.value, observedAt: fact.observedAt })).toBe(fact);
    expect(editGeoKbFactV2(fact, {})).toBe(fact);
  });
});

describe("persisted role proposal adoption", () => {
  it("returns only detached pending model roles tied to their persisted generation and item", () => {
    const original = v2().roles[0]!;
    const proposal: GeoSynthesisRole = { id: original.id, label: original.label, questionLabel: original.questionLabel, segment: original.segment,
      painPoints: original.painPoints, decisionCriteria: original.decisionCriteria, vocabulary: original.vocabulary, alternatives: original.alternatives,
      evidenceRefs: ["profile:primaryIcp", "gsc:G1"] };
    const before = structuredClone(proposal);
    const roles = adoptGeoKbRoleProposals([proposal], GENERATION);
    expect(roles).toEqual([{ ...original, review: "pending", source: { kind: "model", generationId: GENERATION, itemId: proposal.id, evidenceRefs: proposal.evidenceRefs } }]);
    expect(proposal).toEqual(before); expect(roles[0]?.source.evidenceRefs).not.toBe(proposal.evidenceRefs);
    expect(roles[0]?.painPoints).not.toBe(proposal.painPoints);
    expect(Array.isArray(roles)).toBe(true); expect(roles[0]?.source.kind).not.toBe("gsc");
  });
});
