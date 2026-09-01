import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile, canonicalProfileJson } from "../account-websites/contracts.ts";
import { createHash } from "node:crypto";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { createGeoKbEditorLoader, type GeoKbEditorLoaderDependencies } from "./kb-editor-loader.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { upgradeGeoKbDraftToV2 } from "./kb-upgrade.ts";

const USER = "11111111-1111-4111-8111-111111111111", KB = "22222222-2222-4222-8222-222222222222", WEBSITE = "33333333-3333-4333-8333-333333333333";
const SNAP = "44444444-4444-4444-8444-444444444444";
const AT = "2026-08-31T00:00:00.000Z";
const profile = { ...emptyMarketingWebsiteProfile(), productName: "Original product", primaryIcp: "Finance teams", categories: ["invoice reminders"], country: "US", locale: "en" };
const ref = { schemaVersion: "website-profile-reference.v1" as const, websiteId: WEBSITE, snapshotId: SNAP, snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1" as const, profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") };
const copy = createGeoProfileCopy(ref, profile);
const legacy = { ...emptyGeoKbPayload("https://example.com"), officialName: "Original product", categoryTerms: ["invoice reminders"], profileCopy: copy };
function fixture() {
  const calls: string[] = [];
  const details = { kbId: KB, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", createdAt: AT, updatedAt: AT,
    draft: { draftVersion: 2, contentHash: geoV2Digest(legacy), updatedAt: AT, payload: legacy }, frozen: null };
  const deps: GeoKbEditorLoaderDependencies = {
    ensure: async () => ({ kind: "ok", value: { kbId: KB, created: false } }),
    readDetails: async () => ({ kind: "ok", value: details }),
    readProfile: async () => ({ kind: "ok", value: { reference: ref, profile } }),
    readFrozen: async () => { throw new Error("no snapshot"); },
    readSource: async () => { calls.push("source"); return { kind: "ok", value: null }; },
    readPrepared: async () => { calls.push("prepared"); return { kind: "ok", value: null }; },
    readGeneration: async () => ({ kind: "ok", generation: null }),
  };
  return { deps, details, calls };
}
describe("complete V2 editor load", () => {
  it("previews a V1 upgrade without saving or replacing its stored hash", async () => {
    const { deps, details } = fixture();
    const result = await createGeoKbEditorLoader(deps)({ userId: USER, url: "https://www.example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v2", requiresSave: true, draftHash: details.draft.contentHash,
      payload: { schemaVersion: "marketing-geo-kb.v2", profileCopy: copy }, prepared: null, generations: { roles: null, questions: null } } });
    expect(details.draft.payload.schemaVersion).toBe("marketing-geo-kb.v1");
  });
  it("keeps an existing V2 copy even when a newer confirmed Profile is available", async () => {
    const { deps, details } = fixture();
    const payload = upgradeGeoKbDraftToV2(legacy);
    const newer = { ...profile, productName: "New source proposal" };
    const result = await createGeoKbEditorLoader({ ...deps,
      readDetails: async () => ({ kind: "ok", value: { ...details, draft: { ...details.draft, payload, contentHash: geoV2Digest(payload) } } }),
      readProfile: async () => ({ kind: "ok", value: { reference: { ...ref, snapshotRevision: 2, profileHash: createHash("sha256").update(canonicalProfileJson(newer)).digest("hex") }, profile: newer } }),
    })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { requiresSave: false, payload: { profileCopy: copy }, profile: { productName: "New source proposal" } } });
  });
  it("does not call unavailable candidate/source reads an empty knowledge base", async () => {
    const { deps } = fixture();
    for (const overrides of [{ readPrepared: async () => ({ kind: "unavailable" as const, reason: "offline" }) }, { readSource: async () => ({ kind: "unavailable" as const, reason: "offline" }) }]) {
      expect(await createGeoKbEditorLoader({ ...deps, ...overrides })({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
    }
  });
  it("starts with a full Profile copy but no invented accepted roles or facts", async () => {
    const { deps, details } = fixture();
    const result = await createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "ok", value: { ...details, draft: null } }) })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { draftVersion: 0, draftHash: null, requiresSave: true, payload: { profileCopy: copy, roles: [], facts: [] } } });
  });
  it("lets a first-time user fill missing GEO categories without fabricating a category to load the editor", async () => {
    const { deps, details } = fixture();
    const incomplete = { ...profile, categories: [] };
    const result = await createGeoKbEditorLoader({ ...deps,
      readDetails: async () => ({ kind: "ok", value: { ...details, draft: null } }),
      readProfile: async () => ({ kind: "ok", value: { profile: incomplete, reference: { ...ref, profileHash: createHash("sha256").update(canonicalProfileJson(incomplete)).digest("hex") } } }),
    })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { requiresSave: true, payload: { categoryTerms: [] } } });
  });
  it("preserves an unsupported Profile language and an unspecified market for explicit user selection", async () => {
    const { deps, details } = fixture();
    const unsupported = { ...profile, locale: "fil", country: "" };
    const result = await createGeoKbEditorLoader({ ...deps,
      readDetails: async () => ({ kind: "ok", value: { ...details, draft: null } }),
      readProfile: async () => ({ kind: "ok", value: { profile: unsupported, reference: { ...ref, profileHash: createHash("sha256").update(canonicalProfileJson(unsupported)).digest("hex") } } }),
    })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { requiresSave: true, payload: { market: { country: "", language: "fil" } } } });
  });
  it("refuses a foreign returned KB and a frozen read failure", async () => {
    const { deps, details } = fixture();
    expect(await createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "ok", value: { ...details, kbId: WEBSITE } }) })({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
    expect(await createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "ok", value: { ...details, frozen: { snapshotId: SNAP, revision: 1, contentHash: "a".repeat(64), questionSetHash: "b".repeat(64), frozenAt: AT, questionCount: 3 } } }) })({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
  });
});
