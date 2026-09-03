import { describe, expect, it, vi } from "vitest";
import { createGeoKbV2Runtime, type GeoKbV2RuntimeDependencies } from "./kb-v2-runtime.ts";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";
import { buildGeoQuestionSet } from "./kb-questions.ts";
import { handleGeoKbGeneration } from "./kb-generation-handler.ts";
import type { GeoKbGenerationStore } from "./kb-generation-store.ts";

vi.mock("../auth/server-auth-user.ts", () => ({ getServerAuthenticatedUser: vi.fn(async () => ({ status: "unauthenticated" })) }));
const USER = "11111111-1111-4111-8111-111111111111", SNAPSHOT = "33333333-3333-4333-8333-333333333333", AT = "2026-08-31T00:00:00.000Z";
function fixture() {
  const payload = completePayloadV2(), questionSet = questionSetV2(), contentHash = geoV2Digest(payload), questionSetHash = geoV2Digest(questionSet);
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet, sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
  const snapshot = { kbId: V2_KB_ID, snapshotId: SNAPSHOT, revision: 1, frozenAt: AT, contentHash, questionSetHash, questionCount: questionSet.questions.length, payload, questionSet };
  const reference = profileCopyReference(payload.profileCopy);
  const website = { websiteId: reference.websiteId, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", displayName: "Acme", isPrimary: true, profileState: "confirmed" as const, confirmedSnapshotId: reference.snapshotId, confirmedSnapshotRevision: reference.snapshotRevision, confirmedAt: AT, createdAt: AT, updatedAt: AT, submittedUrl: "https://example.com/", draft: null, currentConfirmedSnapshot: { ...reference, confirmedAt: AT, profile: payload.profileCopy.profile } };
  const details = { kbId: V2_KB_ID, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", createdAt: AT, updatedAt: AT, draft: { payload, contentHash, draftVersion: 1, updatedAt: AT }, frozen: { snapshotId: SNAPSHOT, revision: 1, frozenAt: AT, contentHash, questionSetHash, questionCount: snapshot.questionCount } };
  const generationStore = {
    claim: vi.fn<GeoKbGenerationStore["claim"]>(async () => ({ kind: "unavailable" })),
    markDispatched: vi.fn<GeoKbGenerationStore["markDispatched"]>(async () => ({ kind: "unavailable" })), finish: vi.fn<GeoKbGenerationStore["finish"]>(async () => ({ kind: "unavailable" })),
    read: vi.fn<GeoKbGenerationStore["read"]>(async () => ({ kind: "ok", generation: null })), readLatest: vi.fn<GeoKbGenerationStore["readLatest"]>(async () => ({ kind: "ok", generation: null })), readByKey: vi.fn<GeoKbGenerationStore["readByKey"]>(async () => ({ kind: "ok", generation: null })),
  };
  const preparedStore = { read: vi.fn<GeoKbV2RuntimeDependencies["preparedStore"]["read"]>(async () => ({ kind: "ok", value: null })), readLatest: vi.fn<GeoKbV2RuntimeDependencies["preparedStore"]["readLatest"]>(async () => ({ kind: "ok", value: null })), freeze: vi.fn<GeoKbV2RuntimeDependencies["preparedStore"]["freeze"]>(async () => ({ kind: "invalid", code: "context_stale" })) };
  const dependencies = {
    authenticate: vi.fn<GeoKbV2RuntimeDependencies["authenticate"]>(async () => ({ status: "authenticated", userId: USER, email: null, avatarUrl: null })),
    ensure: vi.fn<GeoKbV2RuntimeDependencies["ensure"]>(async () => ({ kind: "ok", value: { kbId: V2_KB_ID, created: false } })),
    readDetails: vi.fn<GeoKbV2RuntimeDependencies["readDetails"]>(async () => ({ kind: "ok", value: details })),
    readProfile: vi.fn<GeoKbV2RuntimeDependencies["readProfile"]>(async () => ({ kind: "ok", value: { website, reference, profile: payload.profileCopy.profile } })),
    readWebsite: vi.fn<GeoKbV2RuntimeDependencies["readWebsite"]>(async () => ({ kind: "ok", value: website })),
    readComplete: vi.fn<GeoKbV2RuntimeDependencies["readComplete"]>(async () => ({ kind: "ok", value: { snapshot, context, completeness: "complete" } })),
    readSource: vi.fn<GeoKbV2RuntimeDependencies["readSource"]>(async () => ({ kind: "ok", value: null })), persistSource: vi.fn<GeoKbV2RuntimeDependencies["persistSource"]>(async () => ({ kind: "ok" })),
    generationStore, preparedStore, saveDraft: vi.fn<GeoKbV2RuntimeDependencies["saveDraft"]>(async () => ({ kind: "ok", value: { draftVersion: 2, contentHash, updatedAt: AT } })),
    resolveConfig: vi.fn<GeoKbV2RuntimeDependencies["resolveConfig"]>(() => null), quota: vi.fn<GeoKbV2RuntimeDependencies["quota"]>(async () => ({ kind: "allowed", hits: 1 })), validateLineage: vi.fn<NonNullable<GeoKbV2RuntimeDependencies["validateLineage"]>>(async () => "valid"),
  };
  return { payload, reference, website, details, snapshot, context, dependencies, runtime: createGeoKbV2Runtime(dependencies) };
}
describe("actual GEO v2 runtime wiring", () => {
  it("does not read config or dispatch providers during construction", () => {
    const { dependencies } = fixture();
    expect(dependencies.resolveConfig).not.toHaveBeenCalled(); expect(dependencies.readDetails).not.toHaveBeenCalled(); expect(dependencies.quota).not.toHaveBeenCalled();
  });
  it("loads full v2 frozen payload/questions/context through the immutable complete reader", async () => {
    const { runtime, dependencies, snapshot, context } = fixture();
    const value = await runtime.loadEditor({ userId: USER, url: "https://www.example.com" });
    expect(value).toMatchObject({ kind: "ok", value: { frozen: { ...snapshot, context } } });
    expect(dependencies.readComplete).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID, snapshotId: SNAPSHOT });
  });
  it("keeps legacy frozen content exact and never fills it from the current Profile", async () => {
    const { runtime, dependencies, snapshot } = fixture();
    const payload = contextPayload(), questionSet = buildGeoQuestionSet(payload);
    dependencies.readComplete.mockResolvedValue({ kind: "ok", value: { snapshot: { ...snapshot, payload, questionSet, questionCount: questionSet.questions.length, contentHash: geoV2Digest(payload), questionSetHash: geoV2Digest(questionSet) }, context: null, completeness: "legacy_partial" } });
    const value = await runtime.loadEditor({ userId: USER, url: "https://example.com" });
    expect(value).toMatchObject({ kind: "ok", value: { frozen: { payload, questions: questionSet.questions } } });
    if (value.kind !== "ok") throw new Error("Expected old frozen view");
    expect(value.value.frozen && "payload" in value.value.frozen && value.value.frozen.payload?.profileCopy).toBeUndefined();
  });
  it("does not turn a missing pointed frozen version or unavailable source store into an empty editor", async () => {
    const { runtime, dependencies } = fixture(); dependencies.readComplete.mockResolvedValue({ kind: "missing" });
    expect(await runtime.loadEditor({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
    const next = fixture(); next.dependencies.readSource.mockResolvedValue({ kind: "unavailable", reason: "offline" });
    expect(await next.runtime.loadEditor({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
  });
  it("binds source capture to the saved Profile copy rather than looking up today's Profile", async () => {
    const { runtime, dependencies, reference } = fixture();
    const asset = await runtime.sources.readAsset({ userId: USER, kbId: V2_KB_ID });
    expect(asset).toMatchObject({ kind: "ok", value: { kbId: V2_KB_ID, profileReference: reference } });
    expect(dependencies.readProfile).not.toHaveBeenCalled(); expect(dependencies.readWebsite).not.toHaveBeenCalled();
    expect(runtime.sources.persistReceipt).toBe(dependencies.persistSource);
  });
  it("verifies the exact owner/current Profile/ref/content before draft write or generation admission", async () => {
    const { runtime, dependencies, payload, reference, website } = fixture();
    const input = { userId: USER, origin: "https://example.com", copy: payload.profileCopy, expectedProfileReference: reference };
    expect(await runtime.draft.validateCurrentCopy(input)).toBe("current");
    expect(dependencies.readWebsite).toHaveBeenCalledWith(USER, reference.websiteId);
    expect(await runtime.draft.validateCurrentCopy({ ...input, expectedProfileReference: null })).toBe("stale");
    expect(await runtime.draft.validateCurrentCopy({ ...input, origin: "https://foreign.example" })).toBe("stale");
    dependencies.readWebsite.mockResolvedValue({ kind: "ok", value: { ...website, currentConfirmedSnapshot: { ...website.currentConfirmedSnapshot, snapshotId: SNAPSHOT } } });
    expect(await runtime.draft.validateCurrentCopy(input)).toBe("stale");
    dependencies.readWebsite.mockResolvedValue({ kind: "unavailable", reason: "offline" });
    expect(await runtime.draft.validateCurrentCopy(input)).toBe("unavailable");
  });
  it("holds draft writes only for a dispatched run, never for a claim nothing can clear", async () => {
    const { runtime, dependencies } = fixture();
    const record = (state: "claimed" | "dispatched" | "uncertain") => ({ kind: "ok" as const, generation: { generationId: V2_CANDIDATE_ID, userId: USER, kbId: V2_KB_ID, kind: "roles" as const, inputHash: "d".repeat(64), state, result: null, errorReason: state === "uncertain" ? ("outcome_unknown" as const) : null, attempt: state === "uncertain" ? { attemptedCalls: 1 as const, delivery: "outcome_unknown" as const, modelRequested: "m", inputTokens: 0, outputTokens: 0, requestCount: 1 } : null } });
    expect(await runtime.draft.generationRunning!(USER, V2_KB_ID)).toBe(false);
    dependencies.generationStore.readLatest.mockResolvedValue(record("dispatched"));
    expect(await runtime.draft.generationRunning!(USER, V2_KB_ID)).toBe(true);
    // Only `claim` reclaims an expired claimed lease, and claiming needs a
    // saved draft. Refusing writes here would leave the knowledge base with no
    // action able to release it, and its input was frozen at claim time anyway.
    dependencies.generationStore.readLatest.mockResolvedValue(record("claimed"));
    expect(await runtime.draft.generationRunning!(USER, V2_KB_ID)).toBe(false);
    dependencies.generationStore.readLatest.mockResolvedValue(record("uncertain"));
    expect(await runtime.draft.generationRunning!(USER, V2_KB_ID)).toBe(false);
    dependencies.generationStore.readLatest.mockResolvedValue({ kind: "unavailable" });
    expect(await runtime.draft.generationRunning!(USER, V2_KB_ID)).toBe("unavailable");
  });
  it("maps exact missing generations/candidates without substituting latest records", async () => {
    const { runtime, dependencies } = fixture();
    const scope = { userId: USER, kbId: V2_KB_ID, generationId: V2_CANDIDATE_ID };
    expect(await runtime.generation.store.read(scope)).toEqual({ kind: "missing" });
    expect(await runtime.generation.store.readByKey({ userId: USER, kbId: V2_KB_ID, kind: "roles", idempotencyKey: "fixture_key" })).toEqual({ kind: "missing" });
    expect(await runtime.prepared.read({ userId: USER, kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID })).toEqual({ kind: "missing" });
    expect(dependencies.preparedStore.readLatest).not.toHaveBeenCalled();
    expect(await runtime.prepared.read({ userId: USER, kbId: V2_KB_ID })).toEqual({ kind: "missing" });
    expect(dependencies.preparedStore.readLatest).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID });
    expect(await runtime.prepared.freeze({ userId: USER, kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID, candidateHash: "a".repeat(64) })).toEqual({ kind: "stale" });
  });
  it("fails config preflight before claim/quota with the real generation preparer", async () => {
    const { runtime, dependencies, details } = fixture();
    const request = new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v2/roles", { method: "POST", headers: { "content-type": "application/json", origin: "https://gengrowth.ai" }, body: JSON.stringify({ kbId: V2_KB_ID, baseVersion: 1, draftHash: details.draft.contentHash, idempotencyKey: "fixture_key", displayLocale: "en", sourceReceiptRefs: [] }) });
    const response = await handleGeoKbGeneration(request, "roles", runtime.generation);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: { code: "model_unavailable" } });
    expect(dependencies.generationStore.claim).not.toHaveBeenCalled(); expect(dependencies.quota).not.toHaveBeenCalled();
  });
  it("shares durable per-kind owner and KB hourly budgets and fails closed", async () => {
    const { runtime, dependencies } = fixture();
    expect(await runtime.generation.consumeQuota(USER, V2_KB_ID, "roles")).toBe("allowed");
    expect(dependencies.quota.mock.calls).toEqual([[`geo-kb-v2:roles:owner:${USER}`, 10, 3600], [`geo-kb-v2:roles:kb:${V2_KB_ID}`, 4, 3600]]);
    dependencies.quota.mockClear(); dependencies.quota.mockResolvedValue({ kind: "limited", retryAfterSeconds: 60 });
    expect(await runtime.generation.consumeQuota(USER, V2_KB_ID, "questions")).toBe("limited"); expect(dependencies.quota).toHaveBeenCalledTimes(1);
    dependencies.quota.mockResolvedValue({ kind: "unavailable", reason: "offline" });
    expect(await runtime.generation.consumeQuota(USER, V2_KB_ID, "questions")).toBe("unavailable");
  });
  it("uses the real draft lineage validator without depending on model configuration", async () => {
    const { dependencies, payload } = fixture();
    const { validateLineage: _override, ...realValidation } = dependencies;
    const runtime = createGeoKbV2Runtime(realValidation);
    expect(await runtime.draft.validateLineage({ userId: USER, kbId: V2_KB_ID, payload, previousPayload: payload })).toBe("valid");
    expect(dependencies.resolveConfig).not.toHaveBeenCalled(); expect(dependencies.quota).not.toHaveBeenCalled();
    const modelPayload = { ...payload, roles: payload.roles.map(role => ({ ...role, source: { ...role.source, kind: "model" as const, generationId: V2_CANDIDATE_ID, itemId: role.id } })) };
    expect(await runtime.draft.validateLineage({ userId: USER, kbId: V2_KB_ID, payload: modelPayload, previousPayload: payload })).toBe("invalid");
    expect(dependencies.generationStore.read).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID, generationId: V2_CANDIDATE_ID });
    dependencies.generationStore.read.mockResolvedValue({ kind: "unavailable" });
    expect(await runtime.draft.validateLineage({ userId: USER, kbId: V2_KB_ID, payload: modelPayload, previousPayload: payload })).toBe("unavailable");
  });
  it("does not downgrade read outages to missing records or no-draft source results", async () => {
    const { runtime, dependencies } = fixture();
    dependencies.generationStore.read.mockResolvedValue({ kind: "unavailable" });
    dependencies.generationStore.readByKey.mockResolvedValue({ kind: "unavailable" });
    dependencies.preparedStore.read.mockResolvedValue({ kind: "unavailable", reason: "offline" });
    dependencies.readDetails.mockResolvedValue({ kind: "unavailable", reason: "offline" });
    expect(await runtime.generation.store.read({ userId: USER, kbId: V2_KB_ID, generationId: V2_CANDIDATE_ID })).toEqual({ kind: "unavailable" });
    expect(await runtime.generation.store.readByKey({ userId: USER, kbId: V2_KB_ID, kind: "roles", idempotencyKey: "fixture_key" })).toEqual({ kind: "unavailable" });
    expect(await runtime.prepared.read({ userId: USER, kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID })).toEqual({ kind: "unavailable" });
    expect(await runtime.sources.readAsset({ userId: USER, kbId: V2_KB_ID })).toEqual({ kind: "unavailable" });
  });
});

describe("v2 route entrypoints", () => {
  it.each([["load", 60], ["draft", 60], ["sources", 120], ["roles", 300], ["prepare", 300], ["generation", 30], ["prepared", 30], ["freeze", 30]] as const)("wires %s to Node private POST admission without dispatching in a module import", async (name, maxDuration) => {
    const route = await import(`../../app/api/tools/geo-knowledge-base/v2/${name}/route.ts`);
    const auth = await import("../auth/server-auth-user.ts");
    const request = (origin: string) => new Request(`https://gengrowth.ai/api/tools/geo-knowledge-base/v2/${name}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
    expect(route.runtime).toBe("nodejs"); expect(route.maxDuration).toBe(maxDuration);
    try {
      vi.mocked(auth.getServerAuthenticatedUser).mockResolvedValue({ status: "unauthenticated" });
      expect((await route.POST(request("https://gengrowth.ai"))).status).toBe(401);
      vi.mocked(auth.getServerAuthenticatedUser).mockResolvedValue({ status: "authenticated", userId: USER, email: null, avatarUrl: null });
      expect((await route.POST(request("https://evil.example"))).status).toBe(403);
      expect((await route.POST(request("https://gengrowth.ai"))).status).toBe(400);
    } finally { vi.mocked(auth.getServerAuthenticatedUser).mockResolvedValue({ status: "unauthenticated" }); }
  });
});
