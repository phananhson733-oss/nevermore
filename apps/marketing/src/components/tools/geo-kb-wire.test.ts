import { describe, expect, it } from "vitest";

import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { isGeoKbFreezeResponse, isGeoKbSaveResponse, isGeoKbView } from "./geo-kb-wire.ts";
import { emptyMarketingWebsiteProfile } from "../../lib/account-websites/contracts.ts";

const PROFILE = {
  reference: { schemaVersion: "website-profile-reference.v1", websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6", snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987", snapshotRevision: 2, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) },
  productName: "Example", oneLinePositioning: "Exact positioning", coreFeatures: ["Feature"],
  market: { country: "US", language: "en-US" },
};
const VIEW = { kbId: "kb", origin: "https://example.com", host: "example.com", draftVersion: 2, payload: emptyGeoKbPayload("https://example.com"), frozen: null, importAvailable: true, profile: PROFILE };
const FREEZE = { snapshotId: "snap", revision: 1, frozenAt: "2026-08-31T00:00:00Z", contentHash: "a".repeat(64), questionCount: 1, retrievalCount: 1, reusedExisting: false,
  questions: [{ id: "q1", text: "Question", layer: "problem", mode: "retrieval", calibrated: true, roleId: "role-a", requiredEntities: ["Topic"] }],
};

describe("GEO editor inherited-profile wire contract", () => {
  it("validates present complete Profile copies in drafts, frozen payloads and source proposals", () => {
    const profile = { ...emptyMarketingWebsiteProfile(), productName: "Example", locale: "en-US" };
    const profileCopy = { schemaVersion: "marketing-geo-profile-copy.v1", websiteId: PROFILE.reference.websiteId,
      snapshotId: PROFILE.reference.snapshotId, snapshotRevision: "2", profileHash: PROFILE.reference.profileHash, profile };
    const payload = { ...VIEW.payload, profileCopy };
    expect(isGeoKbView({ ...VIEW, payload, profile: { ...PROFILE, fullProfile: profile } })).toBe(true);
    expect(isGeoKbView({ ...VIEW, payload: { ...payload, profileCopy: { ...profileCopy, profile: { ...profile, categories: "invalid" } } } })).toBe(false);
    expect(isGeoKbView({ ...VIEW, profile: { ...PROFILE, fullProfile: { ...profile, buyer: 42 } } })).toBe(false);
    expect(isGeoKbView({ ...VIEW, frozen: { ...FREEZE, payload: { ...payload, profileCopy: null } } })).toBe(false);
  });
  it("checks optional draft-source policy and frozen definitions without requiring them on legacy views", () => {
    const context = { skippedLayers: ["problem", "evaluation"], questionSetHash: "c".repeat(64), contentHash: "e".repeat(64) };
    const frozen = { ...FREEZE, questionSetHash: "d".repeat(64), registryVersion: "registry-test.v1", skippedLayers: ["problem", "evaluation"] };
    expect(isGeoKbView({ ...VIEW, context, frozen })).toBe(true);
    expect(isGeoKbView({ ...VIEW, context: { ...context, skippedLayers: ["invented"] } })).toBe(false);
    expect(isGeoKbView({ ...VIEW, context: { ...context, activeRoleIds: ["gsc-role"] } })).toBe(true);
    expect(isGeoKbView({ ...VIEW, context: { ...context, activeRoleIds: ["gsc-role", "gsc-role"] } })).toBe(false);
    expect(isGeoKbView({ ...VIEW, context: { ...context, questionSetHash: "fake" } })).toBe(false);
    expect(isGeoKbView({ ...VIEW, context: { ...context, contentHash: "fake" } })).toBe(false);
    expect(isGeoKbView({ ...VIEW, frozen: { ...frozen, questions: [{ ...FREEZE.questions[0], templateId: 3 }] } })).toBe(false);
    expect(isGeoKbView({ ...VIEW, frozen: { ...frozen, registryVersion: 8 } })).toBe(false);
    expect(isGeoKbSaveResponse({ draftVersion: 3, updatedAt: "2026-08-31T00:00:00Z", blockers: [], context })).toBe(true);
    expect(isGeoKbSaveResponse({ draftVersion: 3, updatedAt: "2026-08-31T00:00:00Z", blockers: [], context: null })).toBe(false);
  });
  it("preserves optional competitor aliases but refuses malformed alias arrays", () => {
    const payload = { ...VIEW.payload, competitors: [{ domain: "rival.example", brandName: "Rival", confirmed: false, aliases: ["Alternate Rival"] }] };
    expect(isGeoKbView({ ...VIEW, payload })).toBe(true);
    expect(isGeoKbView({ ...VIEW, payload: { ...payload, competitors: [{ ...payload.competitors[0], aliases: "Alias" }] } })).toBe(false);
  });
  it("accepts a complete immutable profile and preserves old unlinked views", () => {
    expect(isGeoKbView(VIEW)).toBe(true);
    expect(isGeoKbView({ ...VIEW, profile: null })).toBe(true);
    const { profile: _profile, ...legacy } = VIEW;
    expect(isGeoKbView(legacy)).toBe(true);
  });
  it.each([
    { ...PROFILE, coreFeatures: null },
    { ...PROFILE, market: null },
    { ...PROFILE, productName: 4 },
    { ...PROFILE, reference: { ...PROFILE.reference, profileHash: "fake" } },
    { ...PROFILE, reference: { ...PROFILE.reference, websiteId: "../../foreign" } },
  ])("refuses a malformed inherited profile rather than rendering partial authority", (profile) => {
    expect(isGeoKbView({ ...VIEW, profile })).toBe(false);
  });
  it("accepts server question-role/entity metadata and rejects malformed present fields", () => {
    expect(isGeoKbFreezeResponse(FREEZE)).toBe(true);
    expect(isGeoKbFreezeResponse({ ...FREEZE, questions: [{ ...FREEZE.questions[0], roleId: null }] })).toBe(true);
    expect(isGeoKbFreezeResponse({ ...FREEZE, questions: [{ ...FREEZE.questions[0], requiredEntities: "Topic" }] })).toBe(false);
    expect(isGeoKbFreezeResponse({ ...FREEZE, questions: [{ ...FREEZE.questions[0], roleId: 9 }] })).toBe(false);
  });
});
