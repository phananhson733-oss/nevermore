import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { parseGeoQuestionSynthesisInput, parseGeoRoleSynthesisInput } from "./kb-synthesis-contract.ts";
import { buildGeoRoleSynthesisBasis, buildGeoQuestionSynthesisBasis } from "./kb-synthesis-input.ts";

function payload() {
  const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", coreFeatures: ["Invoice reminders"], primaryIcp: "Finance teams", country: "US", locale: "en" };
  const copy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) }, profile);
  return parseGeoKbPayloadV2({ ...emptyGeoKbPayload("https://example.com"), schemaVersion: "marketing-geo-kb.v2", profileCopy: copy, officialName: "Acme", aliases: ["Acme"], categoryTerms: ["invoice reminder software"],
    roles: [{ id: "finance", label: "财务团队", questionLabel: "finance teams", segment: "", painPoints: ["手工催收耗时"], decisionCriteria: ["审计记录"], vocabulary: ["应收账款"], alternatives: ["电子表格"], review: "accepted", source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: [] } }],
    facts: [{ key: "Price", value: "$19", reason: "", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", review: "pending", supportRef: null }],
  });
}

describe("semantic input uses an exact, disclosed selection", () => {
  it("keeps complete Profile field values and marks their derivation instead of claiming observation", () => {
    const draft = payload();
    const result = buildGeoRoleSynthesisBasis(draft, "zh", []);
    expect(parseGeoRoleSynthesisInput(result.input).ok).toBe(true);
    const feature = result.input.sources.find(source => source.id.endsWith(":coreFeatures"));
    expect(feature?.text).toContain('"Invoice reminders"');
    expect(feature?.text).toContain("not independently verified");
    expect(result.input.sources.some(source => source.id.includes(draft.profileCopy.snapshotId))).toBe(true);
    expect(result.selectedEvidenceCounts.profile).toBe(result.availableEvidenceCounts.profile);
  });
  it("discloses bounded GSC selection without pretending excluded queries did not exist", () => {
    const extra = Array.from({ length: 1000 }, (_, index) => ({ id: `G${index}`, kind: "gsc" as const, text: `查询${index}：${"中".repeat(500)}` }));
    const result = buildGeoRoleSynthesisBasis(payload(), "zh", extra);
    expect(result.availableEvidenceCounts.gsc).toBe(1000);
    expect(result.selectedEvidenceCounts.gsc).toBeGreaterThan(0);
    expect(result.selectedEvidenceCounts.gsc).toBeLessThan(1000);
    expect(Buffer.byteLength(JSON.stringify(result.input), "utf8")).toBeLessThanOrEqual(163_840);
    for (const source of result.input.sources.filter(source => source.kind === "gsc")) expect(extra.find(item => item.id === source.id)).toEqual(source);
  });
  it("uses accepted role wording as user-reviewed input while not claiming edited wording is a raw query", () => {
    const result = buildGeoQuestionSynthesisBasis(payload(), []);
    expect(parseGeoQuestionSynthesisInput(result.input)).toMatchObject({ ok: true });
    expect(result.input.roles).toHaveLength(1);
    const pain = result.input.entities.find(entity => entity.kind === "role_pain")!;
    expect(pain).toMatchObject({ text: "手工催收耗时", roleId: "finance" });
    const support = result.input.evidenceSources.find(source => source.id === pain.evidenceRefs[0]);
    expect(support).toMatchObject({ kind: "manual" });
    expect(support?.text).toContain("User-reviewed");
  });
  it("never promotes Profile prose or pending facts into the question fact catalogue", () => {
    const result = buildGeoQuestionSynthesisBasis(payload(), []);
    expect(result.input.entities.some(entity => entity.kind === "fact")).toBe(false);
    expect(result.input.evidenceSources.some(source => source.text.includes("$19"))).toBe(false);
  });
  it("includes only separately admitted facts with known source IDs and exact numeric wording", () => {
    const result = buildGeoQuestionSynthesisBasis(payload(), [{ key: "Price", value: "$19", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", source: "user_confirmed" }]);
    expect(result.input.entities.find(entity => entity.kind === "fact")?.text).toBe("$19");
    expect(parseGeoQuestionSynthesisInput(result.input).ok).toBe(true);
  });
  it("excludes unreviewed or explicitly excluded roles and unconfirmed competitors", () => {
    const original = payload();
    const draft = { ...original, roles: original.roles.map(role => ({ ...role, review: "pending" as const })), competitors: [{ domain: "rival.example", brandName: "Rival", aliases: [], confirmed: false }] };
    const result = buildGeoQuestionSynthesisBasis(draft, []);
    expect(result.input.roles).toHaveLength(0);
    expect(result.input.entities.some(entity => entity.kind.startsWith("role_") || entity.kind === "competitor")).toBe(false);
  });
  it("uses a bounded per-role selection with exact available/selected counts", () => {
    const original = payload();
    const draft = { ...original, roles: original.roles.map(role => ({ ...role, painPoints: Array.from({ length: 8 }, (_, index) => `complete pain ${index}`), decisionCriteria: Array.from({ length: 8 }, (_, index) => `complete criterion ${index}`) })) };
    const result = buildGeoQuestionSynthesisBasis(draft, []);
    expect(result.availableEntityCounts.role_pain).toBe(8);
    expect(result.selectedEntityCounts.role_pain).toBe(4);
    expect(result.availableEntityCounts.role_criterion).toBe(8);
    expect(result.selectedEntityCounts.role_criterion).toBe(4);
    expect(result.input.roles[0]?.painPoints).toHaveLength(8);
    expect(parseGeoQuestionSynthesisInput(result.input).ok).toBe(true);
  });
});
