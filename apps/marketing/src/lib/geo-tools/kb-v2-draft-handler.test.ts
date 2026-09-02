import { describe, expect, it, vi } from "vitest";
import { handleGeoKbV2Load, handleGeoKbV2Draft, type GeoKbV2DraftDependencies, type GeoKbV2LoadDependencies } from "./kb-v2-draft-handler.ts";
import { completePayloadV2, V2_KB_ID } from "./kb-v2.test-fixtures.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
const USER = "11111111-1111-4111-8111-111111111111", AT = "2026-08-31T00:00:00.000Z";
const authenticated = async () => ({ status: "authenticated" as const, userId: USER, email: null, avatarUrl: null });
const request = (body: unknown, origin = "https://gengrowth.ai", contentType = "application/json") => new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v2/draft", { method: "POST", headers: { origin, "content-type": contentType }, body: JSON.stringify(body) });
function fixture() {
  const payload = completePayloadV2(), contentHash = geoV2Digest(payload);
  const details = { kbId: V2_KB_ID, origin: "https://example.com", canonicalSiteKey: "example.com", draft: { payload, draftVersion: 2, contentHash, updatedAt: AT } };
  const dependencies = {
    authenticate: vi.fn(authenticated), readDetails: vi.fn<GeoKbV2DraftDependencies["readDetails"]>(async () => ({ kind: "ok", value: details })),
    validateCurrentCopy: vi.fn<GeoKbV2DraftDependencies["validateCurrentCopy"]>(async () => "current"), validateLineage: vi.fn<GeoKbV2DraftDependencies["validateLineage"]>(async () => "valid"),
    saveDraft: vi.fn<GeoKbV2DraftDependencies["saveDraft"]>(async () => ({ kind: "ok", value: { draftVersion: 3, contentHash, updatedAt: AT } })), blockers: () => [],
  } satisfies GeoKbV2DraftDependencies;
  const body = { kbId: V2_KB_ID, baseVersion: 2, payload, expectedProfileReference: profileCopyReference(payload.profileCopy) };
  return { payload, contentHash, details, dependencies, body };
}

describe("v2 private load HTTP", () => {
  function loadFixture() {
    const { payload, contentHash } = fixture();
    const view = { schemaVersion: "marketing-geo-kb-editor.v2" as const, kbId: V2_KB_ID, origin: "https://example.com", host: "example.com", draftVersion: 2, draftHash: contentHash, profileCopyHash: geoV2Digest(payload.profileCopy), payload, requiresSave: false, profile: null, frozen: null, sourceReceipt: null, prepared: null, generations: { roles: null, questions: null } };
    return { view, dependencies: { authenticate: authenticated, loadEditor: vi.fn<GeoKbV2LoadDependencies["loadEditor"]>(async () => ({ kind: "ok", value: view })) } };
  }
  it("loads only the authenticated account and returns complete private editor data", async () => {
    const { view, dependencies } = loadFixture();
    const response = await handleGeoKbV2Load(request({ url: "https://example.com/" }), dependencies);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: view });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(dependencies.loadEditor).toHaveBeenCalledWith({ userId: USER, url: "https://example.com/" });
  });
  it("gates authentication, origin and exact request fields before loading", async () => {
    const { dependencies } = loadFixture();
    expect((await handleGeoKbV2Load(request({ url: "https://example.com/" }), { ...dependencies, authenticate: async () => ({ status: "unauthenticated" }) })).status).toBe(401);
    expect((await handleGeoKbV2Load(request({ url: "https://example.com/" }, "https://evil.example"), dependencies)).status).toBe(403);
    expect((await handleGeoKbV2Load(request({ url: "https://example.com/", userId: USER }), dependencies)).status).toBe(400);
    expect((await handleGeoKbV2Load(request({ url: "http://127.0.0.1/" }), dependencies)).status).toBe(400);
    expect(dependencies.loadEditor).not.toHaveBeenCalled();
  });
  it.each([["not_found", 404], ["profile_copy_required", 409], ["unavailable", 503]] as const)("keeps %s distinct from an empty successful view", async (kind, status) => {
    const { dependencies } = loadFixture();
    dependencies.loadEditor.mockResolvedValue(kind === "unavailable" ? { kind, reason: "internal secret diagnostic" } : { kind });
    const response = await handleGeoKbV2Load(request({ url: "https://example.com" }), dependencies);
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("internal secret");
  });
});

describe("v2 draft save HTTP", () => {
  it("checks owner, exact source, lineage and CAS before saving a complete draft", async () => {
    const { dependencies, body, payload, contentHash, details } = fixture();
    const response = await handleGeoKbV2Draft(request(body), dependencies);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { draftVersion: 3, contentHash, updatedAt: AT, blockers: [] } });
    expect(dependencies.validateCurrentCopy).toHaveBeenCalledWith({ userId: USER, origin: details.origin, copy: payload.profileCopy, expectedProfileReference: body.expectedProfileReference });
    expect(dependencies.validateLineage).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID, payload, previousPayload: details.draft.payload });
    expect(dependencies.saveDraft).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID, payload, baseVersion: 2 });
  });
  it("meters the write per owner and per knowledge base before any store work, so a runaway autosave cannot flood it", async () => {
    const { dependencies, body } = fixture();
    const limited = { ...dependencies, consumeQuota: vi.fn(async () => "limited" as const) };
    const response = await handleGeoKbV2Draft(request(body), limited);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "rate_limited" } });
    expect(limited.consumeQuota).toHaveBeenCalledWith(USER, V2_KB_ID);
    expect(dependencies.readDetails).not.toHaveBeenCalled();
    expect(dependencies.saveDraft).not.toHaveBeenCalled();
    expect((await handleGeoKbV2Draft(request(body), { ...dependencies, consumeQuota: async () => "unavailable" })).status).toBe(503);
    expect((await handleGeoKbV2Draft(request(body), { ...dependencies, consumeQuota: async () => "allowed" })).status).toBe(200);
  });
  it("refuses a write while a generation is running for this knowledge base, and fails open when it cannot tell", async () => {
    const { dependencies, body } = fixture();
    const refused = await handleGeoKbV2Draft(request(body), { ...dependencies, generationRunning: async () => true });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { code: "generation_running" } });
    expect(dependencies.saveDraft).not.toHaveBeenCalled();
    expect((await handleGeoKbV2Draft(request(body), { ...dependencies, generationRunning: async () => false })).status).toBe(200);
    expect((await handleGeoKbV2Draft(request(body), { ...dependencies, generationRunning: async () => "unavailable" })).status).toBe(200);
  });
  it("allows an omitted compatibility reference only with exact current-copy validation", async () => {
    const { dependencies, body } = fixture(); const { expectedProfileReference: _ref, ...input } = body;
    expect((await handleGeoKbV2Draft(request(input), dependencies)).status).toBe(200);
    expect(dependencies.validateCurrentCopy).toHaveBeenCalledTimes(1);
  });
  it("authenticates and rejects cross-origin or oversized bodies before any store work", async () => {
    const { dependencies, body } = fixture();
    expect((await handleGeoKbV2Draft(request(body), { ...dependencies, authenticate: async () => ({ status: "unauthenticated" }) })).status).toBe(401);
    expect((await handleGeoKbV2Draft(request(body, "https://evil.example"), dependencies)).status).toBe(403);
    expect((await handleGeoKbV2Draft(request({ ...body, huge: "x".repeat(397_313) }), dependencies)).status).toBe(413);
    expect((await handleGeoKbV2Draft(request(body, "https://gengrowth.ai", "text/plain"), dependencies)).status).toBe(415);
    expect(dependencies.readDetails).not.toHaveBeenCalled();
  });
  it.each(["unknown", "legacy", "incomplete", "bad_reference"])("rejects %s inputs without accepting a pending preview as write-ready", async (kind) => {
    const { dependencies, body } = fixture();
    const input = structuredClone(body);
    if (kind === "unknown") Object.assign(input, { userId: USER });
    if (kind === "legacy") Object.assign(input.payload, { schemaVersion: "marketing-geo-kb.v1" });
    if (kind === "incomplete") Object.assign(input.payload, { categoryTerms: [] });
    if (kind === "bad_reference") Object.assign(input, { expectedProfileReference: { websiteId: "invalid" } });
    expect((await handleGeoKbV2Draft(request(input), dependencies)).status).toBe(400);
    expect(dependencies.saveDraft).not.toHaveBeenCalled();
  });
  it("refuses stale draft versions and foreign target sites before source validation", async () => {
    const { dependencies, body } = fixture();
    expect((await handleGeoKbV2Draft(request({ ...body, baseVersion: 1 }), dependencies)).status).toBe(409);
    expect((await handleGeoKbV2Draft(request({ ...body, payload: { ...body.payload, targetUrl: "https://foreign.example" } }), dependencies)).status).toBe(400);
    expect(dependencies.validateCurrentCopy).not.toHaveBeenCalled(); expect(dependencies.saveDraft).not.toHaveBeenCalled();
  });
  it.each([["stale", 409], ["unavailable", 503]] as const)("does not save a %s current Profile", async (state, status) => {
    const { dependencies, body } = fixture(); dependencies.validateCurrentCopy.mockResolvedValue(state);
    expect((await handleGeoKbV2Draft(request(body), dependencies)).status).toBe(status);
    expect(dependencies.validateLineage).not.toHaveBeenCalled(); expect(dependencies.saveDraft).not.toHaveBeenCalled();
  });
  it.each([["invalid", 422], ["unavailable", 503]] as const)("does not save %s role/fact lineage", async (state, status) => {
    const { dependencies, body } = fixture(); dependencies.validateLineage.mockResolvedValue(state);
    expect((await handleGeoKbV2Draft(request(body), dependencies)).status).toBe(status); expect(dependencies.saveDraft).not.toHaveBeenCalled();
  });
  it.each([["missing", 404], ["conflict", 409], ["stale", 409], ["unavailable", 503]] as const)("maps final store %s without leaking an implementation reason", async (state, status) => {
    const { dependencies, body } = fixture();
    dependencies.saveDraft.mockResolvedValue(state === "stale" ? { kind: "invalid", code: "context_stale" } : state === "unavailable" ? { kind: state, reason: "PRIVATE_DIAGNOSTIC" } : state === "conflict" ? { kind: state, currentDraftVersion: 3 } : { kind: state });
    const response = await handleGeoKbV2Draft(request(body), dependencies);
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("PRIVATE_DIAGNOSTIC");
  });
});
