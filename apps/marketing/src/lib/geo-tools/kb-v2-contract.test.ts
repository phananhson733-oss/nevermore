import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { emptyGeoKbPayload, parseGeoKbPayload } from "./kb-contract.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { parseAnyGeoKbPayload, parseGeoKbPayloadV2, geoRoleEligibleForLayer } from "./kb-v2-contract.ts";

export function v2PayloadFixture() {
  const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", country: "US", locale: "en" };
  const profileCopy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) }, profile);
  return { ...emptyGeoKbPayload("https://example.com"), schemaVersion: "marketing-geo-kb.v2", profileCopy, officialName: "Acme", aliases: ["Acme"], categoryTerms: ["analytics"],
    roles: [{ id: "r1", label: "Finance teams", questionLabel: "finance teams", segment: "small companies", painPoints: ["late invoices"], decisionCriteria: ["setup effort"], vocabulary: ["receivables"], alternatives: ["spreadsheets"], review: "accepted", source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: ["manual:r1"] } }],
    facts: [{ key: "Seats", value: "3", reason: "", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", review: "accepted", supportRef: null }],
  };
}

describe("versioned GEO payload", () => {
  it("round-trips v2 review states, alternatives and source references without a lossy V1 projection", () => {
    const payload = v2PayloadFixture();
    expect(parseAnyGeoKbPayload(payload)).toEqual(payload);
    expect(parseGeoKbPayload(payload)).toEqual({ ok: false, reason: "schema_version" });
  });
  it.each(["missing_copy", "model_missing_generation", "manual_fake_generation", "unknown_fact_url", "fact_missing_time", "fact_conflict", "unknown_source", "duplicate_role", "duplicate_fact", "empty_accepted_label"])("rejects %s", kind => {
    const payload = v2PayloadFixture();
    let value: unknown = payload;
    if (kind === "missing_copy") { const { profileCopy: _copy, ...partial } = payload; value = partial; }
    if (kind === "model_missing_generation") value = { ...payload, roles: [{ ...payload.roles[0], source: { ...payload.roles[0]!.source, kind: "model" } }] };
    if (kind === "manual_fake_generation") value = { ...payload, roles: [{ ...payload.roles[0], source: { ...payload.roles[0]!.source, generationId: "fake" } }] };
    if (kind === "unknown_fact_url") value = { ...payload, facts: [{ ...payload.facts[0], sourceUrl: "example.com/pricing" }] };
    if (kind === "fact_missing_time") value = { ...payload, facts: [{ ...payload.facts[0], observedAt: "" }] };
    if (kind === "fact_conflict") value = { ...payload, facts: [{ ...payload.facts[0], reason: "conflicting" }] };
    if (kind === "unknown_source") value = { ...payload, roles: [{ ...payload.roles[0], source: { ...payload.roles[0]!.source, kind: "observed_persona" } }] };
    if (kind === "duplicate_role") value = { ...payload, roles: [payload.roles[0], payload.roles[0]] };
    if (kind === "duplicate_fact") value = { ...payload, facts: [payload.facts[0], payload.facts[0]] };
    if (kind === "empty_accepted_label") value = { ...payload, roles: [{ ...payload.roles[0], label: "" }] };
    expect(() => parseGeoKbPayloadV2(value)).toThrow();
  });
  it("stores unsupported/conflicting proposals without granting accepted fact authority", () => {
    const value = v2PayloadFixture();
    expect(parseGeoKbPayloadV2({ ...value, facts: [{ ...value.facts[0], review: "pending", sourceUrl: "", observedAt: "", reason: "conflicting" }] }).facts[0]).toMatchObject({ value: "3", review: "pending", reason: "conflicting" });
  });
  it.each(["pending", "excluded"])("preserves legacy raw source/time while fact review is %s", review => {
    const value = v2PayloadFixture();
    const fact = { ...value.facts[0]!, sourceUrl: "/old-pricing", observedAt: "last Tuesday" };
    const { review: _review, supportRef: _support, ...legacyFact } = fact;
    const legacy = parseGeoKbPayload({ ...value, schemaVersion: "marketing-geo-kb.v1", facts: [legacyFact] });
    expect(legacy.ok).toBe(true);
    const parsed = parseGeoKbPayloadV2({ ...value, facts: [{ ...fact, review }] });
    expect(parsed.facts[0]).toMatchObject({ sourceUrl: "/old-pricing", observedAt: "last Tuesday", review });
    expect(() => parseGeoKbPayloadV2({ ...value, facts: [{ ...fact, review: "accepted" }] })).toThrow();
  });
  it("makes role eligibility explicit per layer without requiring GSC", () => {
    const role = parseGeoKbPayloadV2(v2PayloadFixture()).roles[0]!;
    expect(geoRoleEligibleForLayer(role, "problem")).toBe(true);
    expect(geoRoleEligibleForLayer({ ...role, decisionCriteria: [] }, "evaluation")).toBe(false);
    expect(geoRoleEligibleForLayer({ ...role, review: "pending" }, "problem")).toBe(false);
  });
});
