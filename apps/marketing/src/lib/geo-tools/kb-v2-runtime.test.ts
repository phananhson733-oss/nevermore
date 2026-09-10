import { describe, expect, it, vi } from "vitest";
import { createGeoKbV2Runtime, type GeoKbV2RuntimeDependencies } from "./kb-v2-runtime.ts";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { completePayloadV3, FACT_KEY_PRO, FACT_KEY_TEAM, HASH_A, OBSERVED_AT, SCOPE_KEY } from "./kb-v3.test-fixtures.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { geoGenerationInputHashV3 } from "./kb-prepared-v3-contract.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";
import { buildGeoQuestionSet } from "./kb-questions.ts";
import { handleGeoKbGeneration } from "./kb-generation-handler.ts";
import type { GeoKbGenerationStore } from "./kb-generation-store.ts";
import type { KeywordLlmConfig } from "../tools/keyword-llm-client.ts";
import { collectGeoKnowledgeEvidenceV1, parseGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceReadResource } from "./kb-knowledge-evidence.ts";
import { GEO_EVIDENCE_OBSERVATION_SCHEMA_VERSION, type GeoEvidenceObservation } from "./kb-evidence-observations.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

vi.mock("../auth/server-auth-user.ts", () => ({ getServerAuthenticatedUser: vi.fn(async () => ({ status: "unauthenticated" })) }));
const USER = "11111111-1111-4111-8111-111111111111", SNAPSHOT = "33333333-3333-4333-8333-333333333333", AT = "2026-08-31T00:00:00.000Z";
const CONFIG: KeywordLlmConfig = { apiKey: "offline-key", model: "offline-model", url: "https://provider.example/v1", authScheme: "bearer", temperature: 0.4 };
/**
 * The seven paths `kb-knowledge-evidence.ts` will follow out of a home page --
 * one per entry in its private `INTENTS` list, matched by `intentFor` on the
 * link text and path.
 *
 * A home page WITHOUT links is what this file served before, and it made every
 * cold-path assertion below blind: the collector's own-site crawl reads
 * `home.links`, so a page with no `<a>` cannot exercise it however cold the
 * run is. The count of requests an update makes -- the thing the card's price
 * sentence promises -- was therefore never measured on the path that makes
 * most of them.
 */
const LINKED_PATHS = ["/about", "/pricing", "/product", "/integrations", "/docs", "/faq", "/changelog"] as const;
const knowledgeReader: GeoKnowledgeEvidenceReadResource = async ({ url }) => {
  const observedAt = AT;
  if (url.endsWith("/robots.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "User-agent: *\nAllow: /" };
  if (url.endsWith("/sitemap.xml")) return { kind: "ok", url, contentType: "application/xml", observedAt, body: "<urlset><url><loc>https://example.com/</loc></url></urlset>" };
  if (url.endsWith("/llms.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "# Acme\nAnalytics software." };
  const page = new URL(url);
  const nav = page.pathname === "/"
    ? `<nav>${LINKED_PATHS.map(path => `<a href="${path}">${path.slice(1)}</a>`).join("")}</nav>`
    : "";
  return { kind: "ok", url, contentType: "text/html", observedAt, body: `<html><head><title>${page.host}</title></head><body><h1>Analytics software</h1><p>${page.pathname}</p>${nav}</body></html>` };
};
function fixture() {
  const payload = completePayloadV2(), questionSet = questionSetV2(), contentHash = geoV2Digest(payload), questionSetHash = geoV2Digest(questionSet);
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet, sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
  const snapshot = { kbId: V2_KB_ID, snapshotId: SNAPSHOT, revision: 1, frozenAt: AT, contentHash, questionSetHash, questionCount: questionSet.questions.length, preparedId: V2_CANDIDATE_ID, payload, questionSet };
  const reference = profileCopyReference(payload.profileCopy);
  const website = { websiteId: reference.websiteId, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", displayName: "Acme", isPrimary: true, profileState: "confirmed" as const, confirmedSnapshotId: reference.snapshotId, confirmedSnapshotRevision: reference.snapshotRevision, confirmedAt: AT, createdAt: AT, updatedAt: AT, submittedUrl: "https://example.com/", draft: null, currentConfirmedSnapshot: { ...reference, confirmedAt: AT, profile: payload.profileCopy.profile } };
  const details = { kbId: V2_KB_ID, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", createdAt: AT, updatedAt: AT, draft: { payload, contentHash, draftVersion: 1, updatedAt: AT }, frozen: { snapshotId: SNAPSHOT, revision: 1, frozenAt: AT, contentHash, questionSetHash, questionCount: snapshot.questionCount } };
  const generationStore = {
    claim: vi.fn<GeoKbGenerationStore["claim"]>(async () => ({ kind: "unavailable" })),
    markDispatched: vi.fn<GeoKbGenerationStore["markDispatched"]>(async () => ({ kind: "unavailable" })), finish: vi.fn<GeoKbGenerationStore["finish"]>(async () => ({ kind: "unavailable" })),
    read: vi.fn<GeoKbGenerationStore["read"]>(async () => ({ kind: "ok", generation: null })), readLatest: vi.fn<GeoKbGenerationStore["readLatest"]>(async () => ({ kind: "ok", generation: null })), readByKey: vi.fn<GeoKbGenerationStore["readByKey"]>(async () => ({ kind: "ok", generation: null })),
  };
  const preparedStore = { read: vi.fn<GeoKbV2RuntimeDependencies["preparedStore"]["read"]>(async () => ({ kind: "ok", value: null })), readLatest: vi.fn<GeoKbV2RuntimeDependencies["preparedStore"]["readLatest"]>(async () => ({ kind: "ok", value: null })), freeze: vi.fn<GeoKbV2RuntimeDependencies["preparedStore"]["freeze"]>(async () => ({ kind: "invalid", code: "context_stale" })) };
  const collectKnowledgeEvidence = vi.fn<typeof collectGeoKnowledgeEvidenceV1>(collectGeoKnowledgeEvidenceV1);
  // One spy per fixture, wrapping the same canned site. Every assertion
  // about what an update costs is counted off THIS, because the number of
  // requests that leave the process is the thing the card promises.
  const readResource = vi.fn<GeoKnowledgeEvidenceReadResource>(async request => await knowledgeReader(request));
  const createKnowledgeResourceReader = vi.fn(() => readResource);
  const dependencies = {
    authenticate: vi.fn<GeoKbV2RuntimeDependencies["authenticate"]>(async () => ({ status: "authenticated", userId: USER, email: null, avatarUrl: null })),
    ensure: vi.fn<GeoKbV2RuntimeDependencies["ensure"]>(async () => ({ kind: "ok", value: { kbId: V2_KB_ID, created: false } })),
    readDetails: vi.fn<GeoKbV2RuntimeDependencies["readDetails"]>(async () => ({ kind: "ok", value: details })),
    readProfile: vi.fn<GeoKbV2RuntimeDependencies["readProfile"]>(async () => ({ kind: "ok", value: { website, reference, profile: payload.profileCopy.profile } })),
    readWebsite: vi.fn<GeoKbV2RuntimeDependencies["readWebsite"]>(async () => ({ kind: "ok", value: website })),
    readComplete: vi.fn<GeoKbV2RuntimeDependencies["readComplete"]>(async () => ({ kind: "ok", value: { snapshot, context, completeness: "complete", knowledgePack: null } })),
    readSource: vi.fn<GeoKbV2RuntimeDependencies["readSource"]>(async () => ({ kind: "ok", value: null })), persistSource: vi.fn<GeoKbV2RuntimeDependencies["persistSource"]>(async () => ({ kind: "ok" })),
    generationStore, preparedStore, saveDraft: vi.fn<GeoKbV2RuntimeDependencies["saveDraft"]>(async () => ({ kind: "ok", value: { draftVersion: 2, contentHash, updatedAt: AT } })),
    resolveConfig: vi.fn<GeoKbV2RuntimeDependencies["resolveConfig"]>(() => null), quota: vi.fn<GeoKbV2RuntimeDependencies["quota"]>(async () => ({ kind: "allowed", hits: 1 })), validateLineage: vi.fn<NonNullable<GeoKbV2RuntimeDependencies["validateLineage"]>>(async () => "valid"),
    collectKnowledgeEvidence, createKnowledgeResourceReader,
    readLatestObservation: vi.fn<GeoKbV2RuntimeDependencies["readLatestObservation"]>(async () => ({ kind: "ok", value: null })),
    now: vi.fn(() => new Date(AT)),
  };
  return { payload, reference, website, details, snapshot, context, dependencies, readResource, runtime: createGeoKbV2Runtime(dependencies) };
}
describe("one runtime entry point for both editor formats", () => {
  it("answers a v3 knowledge base with the v3 review view, through the real dependency wiring", async () => {
    const { runtime, dependencies, details } = fixture();
    const payload = completePayloadV3();
    dependencies.readDetails.mockResolvedValue({ kind: "ok", value: { ...details, frozen: null,
      draft: { payload, contentHash: geoV2Digest(payload), draftVersion: 3, updatedAt: AT } } });
    const value = await runtime.loadEditorAny({ userId: USER, url: "https://example.com" });
    expect(value).toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v3",
      kbId: V2_KB_ID, origin: "https://example.com", host: "example.com", draftVersion: 3, payload, published: null } });
  });
  it("reads the published version's decisions through the complete reader the v2 path already uses", async () => {
    const { runtime, dependencies, details, snapshot } = fixture();
    // The two generations differ, rather than being one payload with `review`
    // swapped: the draft lost the Team fact and regained the scope statement,
    // and the published version is the other way round. A fixture that shares
    // one knowledge body cannot tell which of the two the baseline was keyed
    // to, which is the only thing `published` exists to answer.
    const base = completePayloadV3();
    const clone = () => JSON.parse(JSON.stringify(base.knowledge)) as Record<string, unknown> & { facts: { value: { itemKey: string }[] } };
    const draftKnowledge = clone();
    draftKnowledge.facts.value = draftKnowledge.facts.value.filter(fact => fact.itemKey !== FACT_KEY_TEAM);
    const draft = parseGeoKbPayloadV3({ ...base, knowledge: draftKnowledge });
    const publishedKnowledge = clone();
    publishedKnowledge.scope = { status: "unavailable", reason: "not_applicable" };
    const publishedPayload = parseGeoKbPayloadV3({ ...base, knowledge: publishedKnowledge, review: { decisions: [
      { itemKey: FACT_KEY_PRO, decision: "excluded", override: null, baseContentHash: HASH_A, decidedAt: OBSERVED_AT, baseDraftVersion: "2" },
      { itemKey: FACT_KEY_TEAM, decision: "accepted_in_bulk", override: null, baseContentHash: HASH_A, decidedAt: OBSERVED_AT, baseDraftVersion: "2" },
    ], suppressions: [{ itemKey: SCOPE_KEY, suppressedAt: OBSERVED_AT }] } });
    dependencies.readDetails.mockResolvedValue({ kind: "ok", value: { ...details,
      draft: { payload: draft, contentHash: geoV2Digest(draft), draftVersion: 3, updatedAt: AT } } });
    dependencies.readComplete.mockResolvedValue({ kind: "ok", value: { snapshot: { ...snapshot, payload: publishedPayload,
      questionSet: null, questionSetHash: null, questionCount: null }, context: null, completeness: "complete", knowledgePack: null } });

    const value = await runtime.loadEditorAny({ userId: USER, url: "https://example.com" });
    expect(value).toMatchObject({ kind: "ok", value: { published: { kind: "comparable", revision: 1, contentHash: snapshot.contentHash } } });
    if (value.kind !== "ok" || !("schemaVersion" in value.value) || value.value.schemaVersion !== "marketing-geo-kb-editor.v3") throw new Error("Expected the v3 review view");
    const published = value.value.published;
    if (published === null || published.kind !== "comparable") throw new Error("Expected a comparable published version");
    expect(published.decisions[FACT_KEY_PRO]).toBe("excluded");
    // Only in the published generation: a baseline keyed to the draft loses it.
    expect(published.decisions[FACT_KEY_TEAM]).toBe("accepted_in_bulk");
    // Only in the draft, and suppressed in the published review because a
    // suppression outlives its item. A baseline keyed to the draft reports it
    // as excluded by a version that never contained it.
    expect(Object.hasOwn(published.decisions, SCOPE_KEY)).toBe(false);
    expect(dependencies.readComplete).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID, snapshotId: SNAPSHOT });
  });
  it("still answers a v1/v2 knowledge base with the v2 editor view", async () => {
    const { runtime } = fixture();
    expect(await runtime.loadEditorAny({ userId: USER, url: "https://example.com" }))
      .toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v2" } });
  });
});

describe("actual GEO v2 runtime wiring", () => {
  it("does not read config or dispatch providers during construction", () => {
    const { dependencies } = fixture();
    expect(dependencies.resolveConfig).not.toHaveBeenCalled(); expect(dependencies.readDetails).not.toHaveBeenCalled(); expect(dependencies.quota).not.toHaveBeenCalled();
  });
  it("loads full v2 frozen payload/questions/context through the immutable complete reader", async () => {
    const { runtime, dependencies, snapshot, context } = fixture();
    const value = await runtime.loadEditor({ userId: USER, url: "https://www.example.com" });
    const { preparedId: _preparedId, ...wireSnapshot } = snapshot;
    expect(value).toMatchObject({ kind: "ok", value: { frozen: { ...wireSnapshot, context,
      wireSchemaVersion: "marketing-geo-kb-frozen-wire.v1", knowledgePack: null } } });
    if (value.kind === "ok") expect(value.value.frozen).not.toHaveProperty("preparedId");
    expect(dependencies.readComplete).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID, snapshotId: SNAPSHOT });
  });
  it("keeps legacy frozen content exact and never fills it from the current Profile", async () => {
    const { runtime, dependencies, snapshot } = fixture();
    const payload = contextPayload(), questionSet = buildGeoQuestionSet(payload);
    dependencies.readComplete.mockResolvedValue({ kind: "ok", value: { snapshot: { ...snapshot, payload, questionSet, questionCount: questionSet.questions.length, contentHash: geoV2Digest(payload), questionSetHash: geoV2Digest(questionSet), preparedId: null }, context: null, completeness: "legacy_partial", knowledgePack: null } });
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
    // A blip reading one kind must not hide a run the other kind reports.
    dependencies.generationStore.readLatest.mockImplementation(async ({ kind }) =>
      kind === "roles" ? { kind: "unavailable" } : { ...record("dispatched"), generation: { ...record("dispatched").generation, kind } });
    expect(await runtime.draft.generationRunning!(USER, V2_KB_ID)).toBe(true);
    dependencies.generationStore.readLatest.mockImplementation(async ({ kind }) =>
      kind === "knowledge_pack" ? { ...record("dispatched"), generation: { ...record("dispatched").generation, kind } } : { kind: "ok", generation: null });
    expect(await runtime.draft.generationRunning!(USER, V2_KB_ID)).toBe(true);
  });
  it("maps exact missing generations/candidates without substituting latest records", async () => {
    const { runtime, dependencies } = fixture();
    const scope = { userId: USER, kbId: V2_KB_ID, generationId: V2_CANDIDATE_ID };
    expect(await runtime.generation.store.read(scope)).toEqual({ kind: "ok", generation: null });
    expect(await runtime.generation.store.readByKey({ userId: USER, kbId: V2_KB_ID, kind: "roles", idempotencyKey: "fixture_key" })).toEqual({ kind: "ok", generation: null });
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
  it("collects bounded website evidence for knowledge preflight with the injected owner reader and clock", async () => {
    const { runtime, dependencies, details, payload, readResource } = fixture();
    dependencies.resolveConfig.mockReturnValue(CONFIG);
    const ready = await runtime.generation.prepare({ userId: USER, kind: "knowledge_pack", kbId: V2_KB_ID, baseVersion: 1, draftHash: details.draft.contentHash,
      idempotencyKey: "knowledge_fixture_1", displayLocale: "en", sourceReceiptRefs: [] });
    expect(ready.kind).toBe("ready");
    expect(dependencies.createKnowledgeResourceReader).toHaveBeenCalledWith(USER, expect.objectContaining({ now: dependencies.now }));
    expect(dependencies.collectKnowledgeEvidence).toHaveBeenCalledOnce();
    expect(dependencies.collectKnowledgeEvidence.mock.calls[0]![0]).toEqual({ targetUrl: "https://example.com/", competitors: [{ key: "rival.example", name: "Rival", confirmed: true }] });
    // The reader is wrapped now -- an observation the update already filed
    // answers for its own page -- so identity is no longer the thing to check.
    // What still has to hold is that every request the collector makes reaches
    // the OWNER's gated reader rather than one the collector built itself.
    expect(dependencies.collectKnowledgeEvidence.mock.calls[0]![1]).toMatchObject({ reusedSources: [expect.objectContaining({ kind: "accepted_fact", label: "Seats", excerpts: ["3"] })] });
    expect(readResource).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com/" }));
    expect(readResource.mock.calls.length).toBeGreaterThan(1);
    expect(dependencies.now).toHaveBeenCalled();
    expect(details.draft.payload).toEqual(payload);
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

/**
 * What one update actually spends on reading the web, measured at the seam the
 * card's price sentence describes.
 *
 * The knowledge model step used to run a crawl of its own -- a second gated
 * reader, the home page again, up to seven pages linked from it, three machine
 * files and up to two pages per competitor. None of it carried a ledger row,
 * and `kb-run-plan.ts` says every operation that spends a shared crawl
 * allowance gets one. The one end-to-end test over a run could not see it:
 * `kb-run-seam.integration.test.ts` stubs `collectKnowledgeEvidence` outright,
 * so the defect lived exactly behind the seam its coverage stopped at.
 *
 * These drive the REAL collector through the REAL runtime adapter and count the
 * requests that reach the owner's reader. Nothing here reads the wording of the
 * card from the component that renders it; the sentence is compared with what
 * the code did.
 */
describe("the model step reads nothing the update already read", () => {
  const HOME = "https://example.com/", RIVAL = "https://astro.example/";
  /** The three files an update still reads outside its ledger, named by the card. */
  const MACHINE_FILES = ["robots.txt", "sitemap.xml", "llms.txt"] as const;
  const BODY_HASH = "c".repeat(64);
  const FRESH = "2026-08-30T23:00:00.000Z";
  const EXPIRED = "2026-08-29T00:00:00.000Z";

  /*
   * `structured` carries the three keys the collect executor writes for an own
   * page, because a row the generation step cannot rebuild into a page is not
   * credited at all -- it is fetched again. That is deliberate: crediting the
   * source without the page is what made `machine.jsonLd` and
   * `machine.hreflang` report `absent` while citing the row that held them.
   * A fixture with a bare `{}` therefore measures the REFETCH path, not reuse.
   */
  const observed = (kind: "own_page" | "competitor_page", url: string, overrides: Partial<GeoEvidenceObservation> = {}): GeoEvidenceObservation => ({
    schemaVersion: GEO_EVIDENCE_OBSERVATION_SCHEMA_VERSION, observationId: V2_CANDIDATE_ID, websiteId: SNAPSHOT,
    kind, url, observedAt: FRESH, independence: null,
    status: { kind: "ok", bodyHash: BODY_HASH, excerpts: [`${new URL(url).host} sells analytics software`],
      structured: { jsonLdTypes: [], hreflangLocales: [], hreflang: [] } },
    ...overrides,
  });

  function v3Fixture(library: ReadonlyMap<string, GeoEvidenceObservation>, draft: GeoKbPayloadV3 = completePayloadV3()) {
    const state = fixture();
    const payload = draft, contentHash = geoV2Digest(payload);
    state.dependencies.readDetails.mockResolvedValue({ kind: "ok", value: { ...state.details, frozen: null,
      draft: { payload, contentHash, draftVersion: 3, updatedAt: AT } } });
    state.dependencies.resolveConfig.mockReturnValue(CONFIG);
    state.dependencies.readLatestObservation.mockImplementation(async ({ kind, url }) =>
      ({ kind: "ok", value: library.get(`${kind} ${url}`) ?? null }));
    return { ...state, payload, contentHash,
      prepare: async () => await state.runtime.generation.prepare({ userId: USER, kind: "knowledge_pack", kbId: V2_KB_ID,
        baseVersion: 3, draftHash: contentHash, idempotencyKey: "knowledge_v3_1", displayLocale: "en", sourceReceiptRefs: [] }),
      /** The evidence the collector actually produced for this preparation. */
      evidence: async () => parseGeoKnowledgeEvidenceV1(await state.dependencies.collectKnowledgeEvidence.mock.results[0]!.value),
      fetched: () => state.readResource.mock.calls.map(([request]) => request.url) };
  }

  const library = (...entries: readonly GeoEvidenceObservation[]) =>
    new Map(entries.map(entry => [`${entry.kind} ${entry.url}`, entry] as const));

  it("carries the structure the row stored into the bundle's machine summaries", async () => {
    /**
     * The production defect of 2026-09-09. `machine.jsonLd` and
     * `machine.hreflang` are derived from the bundle's PAGES and cited against
     * its SOURCES; a credited row used to contribute the source alone, so both
     * summaries read `absent` while pointing at the row that held six JSON-LD
     * types.
     */
    const state = v3Fixture(library(observed("own_page", HOME, {
      status: { kind: "ok", bodyHash: BODY_HASH, excerpts: ["example.com sells analytics software"],
        structured: {
          jsonLdTypes: ["FAQPage", "Organization"],
          hreflangLocales: ["en", "zh-Hans"],
          hreflang: [{ locale: "en", url: `${HOME}en` }, { locale: "zh-Hans", url: `${HOME}zh-hans` }],
        } },
    })));

    expect((await state.prepare()).kind).toBe("ready");
    const evidence = await state.evidence();
    expect(evidence.machine.jsonLd).toMatchObject({ status: "present", types: ["FAQPage", "Organization"] });
    expect(evidence.machine.hreflang).toMatchObject({ status: "present", locales: ["en", "zh-Hans"] });
    // Still not fetched: the structure came out of the row.
    expect(state.fetched()).not.toContain(HOME);
  });

  it("reads the page again rather than crediting a row it cannot rebuild", async () => {
    /**
     * A row written before the alternates were stored as pairs. It cannot
     * become a page (the contract's page shape refuses a locale with no URL),
     * and crediting its SOURCE without a page is exactly the shape that made
     * both summaries read `absent` while citing it -- with `reusedUrls` then
     * stopping the collector from reading the page to find out otherwise.
     *
     * So it is not credited at all and the page is fetched. One extra read for
     * a legacy row, and the row it writes is rebuildable.
     */
    const state = v3Fixture(library(observed("own_page", HOME, {
      status: { kind: "ok", bodyHash: BODY_HASH, excerpts: ["example.com sells analytics software"],
        structured: { jsonLdTypes: ["Organization"], hreflangLocales: ["en"] } },
    })));

    expect((await state.prepare()).kind).toBe("ready");
    expect(state.fetched()).toContain(HOME);
  });

  it("spends no request on a page the update's own fetch operations already filed", async () => {
    const state = v3Fixture(library(observed("own_page", HOME), observed("competitor_page", RIVAL)));

    expect((await state.prepare()).kind).toBe("ready");

    // The home page and the competitor's are not read again, and neither are
    // the seven pages the collector follows out of a home page it did read:
    // with the home page reused there is no parsed body to take links from.
    // The canned home page really does carry those seven links (`LINKED_PATHS`
    // above), so this is a statement about the credit and not about the
    // fixture -- which is what it used to be.
    expect([...state.fetched()].sort()).toEqual(MACHINE_FILES.map(name => `https://example.com/${name}`).sort());
    // A second gated reader is still built -- the three machine files need one
    // -- but it is the owner's, and it is built once for the whole collection.
    expect(state.dependencies.createKnowledgeResourceReader).toHaveBeenCalledOnce();

    /*
     * The link between what this cost and what the card says it costs.
     *
     * Every page the model step still reads has to be named in the price
     * sentence, in both locales. Add a fetch of `/about` here and this goes red
     * on the sentence rather than passing quietly, which is the failure the
     * previous wording survived. The exact rendered string is pinned separately
     * in `components/tools/geo-kb-card.test.tsx`.
     */
    for (const url of state.fetched()) {
      const named = new URL(url).pathname.replace(/^\//u, "");
      expect(named).not.toBe("");
      for (const catalogue of [en, zh]) expect(catalogue.tools.geoKnowledgeBase.card.cost).toContain(named);
    }
  });

  /**
   * The counts, in words, that the price sentence has to name.
   *
   * Words rather than digits because the sentence uses words, and because a
   * digit ban next to "model call" is what keeps `COST_FORBIDDEN` in
   * `components/tools/geo-kb-card.test.tsx` a check on the model call.
   * `two` is `两` in the Chinese sentence and `二` in a plausible rewrite of
   * it, so both are accepted; nothing here accepts a missing number.
   */
  const COUNT_WORDS: Readonly<Record<number, Readonly<Record<string, RegExp>>>> = {
    2: { en: /\btwo\b/iu, zh: /[两二]/u },
    3: { en: /\bthree\b/iu, zh: /三/u },
    5: { en: /\bfive\b/iu, zh: /五/u },
    6: { en: /\bsix\b/iu, zh: /六/u },
    7: { en: /\bseven\b/iu, zh: /七/u },
    8: { en: /\beight\b/iu, zh: /八/u },
    9: { en: /\bnine\b/iu, zh: /九/u },
    10: { en: /\bten\b/iu, zh: /十/u },
  };
  const COMPETITOR_KEYS = ["astro.example", "bode.example", "cass.example", "dorn.example", "elba.example"] as const;

  /**
   * The path the price sentence is actually about, and the one nothing here
   * used to measure.
   *
   * A COLD collection -- no observation to credit, so the collector reads for
   * itself -- fetches the home page, follows one link per intent out of it,
   * reads the three machine files, and reads a home page plus one
   * pricing-or-product page for every confirmed competitor. That is twenty-one
   * requests at five competitors against a sentence that used to promise nine,
   * and it is reached two ordinary ways: `reads the page again when the
   * observation has outlived its day` below (a run resumed after a day, whose
   * `fetch` operations are `succeeded` and so re-observe nothing), and
   * `credits nothing when the target has no website row` below that.
   *
   * Two things this asserts that a cap written as
   * `expect(own).toBeLessThanOrEqual(GEO_KNOWLEDGE_EVIDENCE_LIMITS.ownPages)`
   * would not:
   *
   *  - the home page here links to twenty-one plausible paths, not to the
   *    seven the collector follows today, so the measured count is what the
   *    collector CAN take rather than what this fixture happens to offer. The
   *    own-site figure is `min(1 + INTENTS.length, ownPages)`, and widening
   *    the crawl means moving both -- an eighth intent alone is capped by
   *    `ownPages = 8` and a larger `ownPages` alone has no eighth link to
   *    spend itself on, so each of those on its own leaves the sentence true
   *    and this test green, which is the right answer. Move both and the
   *    count reaches nine, a number the sentence does not contain, and the
   *    check below turns red rather than quietly widening the crawl;
   *  - the number is then required to appear in the card's sentence, in both
   *    locales. Nothing in this test reads that sentence to decide what to
   *    expect: the count comes from counting requests, and the catalog is
   *    asked whether it says so.
   */
  const WIDE_LINKS = ["/about", "/company", "/team", "/pricing", "/plans", "/price-list", "/product", "/features",
    "/integrations", "/docs", "/help", "/guide", "/faq", "/questions", "/changelog", "/release-notes",
    "/blog", "/news", "/careers", "/contact", "/security"] as const;

  it("reads no more on the cold path than the card's price sentence names", async () => {
    const base = completePayloadV3();
    const generationInput = { ...base.generationInput,
      competitors: COMPETITOR_KEYS.map((domain, index) => ({ domain, brandName: `Rival ${index + 1}`, confirmed: true })) };
    const widened = parseGeoKbPayloadV3({ ...base, generationInput,
      runRef: { ...base.runRef, generationInputHash: geoGenerationInputHashV3({ ...base, generationInput }) } });
    // Cold: the library holds nothing, so nothing is credited and the
    // collector reads every page for itself.
    const state = v3Fixture(library(), widened);
    state.readResource.mockImplementation(async request => {
      const page = new URL(request.url);
      if (page.pathname !== "/") return await knowledgeReader(request);
      const nav = WIDE_LINKS.map(path => `<a href="${path}">${path.slice(1)}</a>`).join("");
      return { kind: "ok", url: request.url, contentType: "text/html", observedAt: AT,
        body: `<html><head><title>${page.host}</title></head><body><h1>Analytics software</h1><nav>${nav}</nav></body></html>` };
    });

    expect((await state.prepare()).kind).toBe("ready");

    const fetched = state.fetched();
    const machine = fetched.filter(url => MACHINE_FILES.some(name => url.endsWith(`/${name}`)));
    const own = fetched.filter(url => new URL(url).host === "example.com" && !machine.includes(url));
    const competitor = fetched.filter(url => new URL(url).host !== "example.com");
    const perCompetitor = COMPETITOR_KEYS.map(key => competitor.filter(url => new URL(url).host === key).length);

    // Measured, not derived from `GEO_KNOWLEDGE_EVIDENCE_LIMITS`: a cap
    // checked against the constant that sets it proves only that the constant
    // equals itself.
    expect({ own: own.length, machine: machine.length, competitor: competitor.length, total: fetched.length })
      .toEqual({ own: 8, machine: 3, competitor: 10, total: 21 });
    expect(perCompetitor).toEqual([2, 2, 2, 2, 2]);
    expect(new Set(competitor.map(url => new URL(url).host)).size).toBe(COMPETITOR_KEYS.length);
    // Every own-site request is the home page or a page linked from it.
    expect(own.filter(url => url !== HOME && !WIDE_LINKS.includes(new URL(url).pathname as (typeof WIDE_LINKS)[number]))).toEqual([]);

    /*
     * And the sentence names those counts. The own-site budget is stated as
     * the home page plus the pages followed out of it, so both halves are
     * required: dropping "up to seven pages linked from it" while keeping
     * "up to eight pages" would leave an owner reading one number and no
     * account of where the other seven reads come from.
     */
    for (const [label, catalogue] of [["en", en], ["zh", zh]] as const) {
      const sentence = catalogue.tools.geoKnowledgeBase.card.cost;
      // A count with no word in the table counts as missing rather than
      // throwing: a crawl that widened past `COUNT_WORDS` should report the
      // number the sentence does not name, not a TypeError.
      const missing = [own.length, own.length - 1, perCompetitor[0]!, COMPETITOR_KEYS.length]
        .filter(count => !(COUNT_WORDS[count]?.[label]?.test(sentence) ?? false));
      expect({ [label]: missing }).toEqual({ [label]: [] });
    }

    /*
     * And the reuse window is claimed for the home pages ALONE. The library is
     * never even asked about `/about` or about a competitor's pricing page:
     * `creditObservedTargets` builds exactly one request shape per site, so
     * those pages carry no observation and are re-read on every update. The
     * day window covers six of the eighteen page reads here, and the previous
     * sentence offered it as though it covered every page it named because it
     * named only those six.
     */
    expect(state.dependencies.readLatestObservation.mock.calls.map(([selector]) => selector.url))
      .toEqual([HOME, ...COMPETITOR_KEYS.map(key => `https://${key}/`)]);
  });

  it("carries the observation's own receipt into the evidence rather than a fresh-looking one", async () => {
    const state = v3Fixture(library(observed("own_page", HOME), observed("competitor_page", RIVAL)));
    expect((await state.prepare()).kind).toBe("ready");

    const evidence = await state.evidence();
    const own = evidence.sourceCatalogue.find(source => source.kind === "own_page");
    const rival = evidence.sourceCatalogue.find(source => source.kind === "competitor_page");
    // `observedAt` is when the update looked, not when the model step ran: the
    // collection is stamped `AT` and these rows are an hour older.
    expect(own).toMatchObject({ url: HOME, availability: "available", observedAt: FRESH, bodyHash: BODY_HASH,
      excerpts: ["example.com sells analytics software"] });
    expect(rival).toMatchObject({ url: RIVAL, availability: "available", observedAt: FRESH,
      competitor: { key: "astro.example", name: "Astro", confirmed: true } });
    expect(evidence.collectedAt).toBe(AT);
    expect(own!.observedAt! < evidence.collectedAt).toBe(true);
  });

  it("reads the page again when the library holds nothing for it", async () => {
    const state = v3Fixture(library());
    expect((await state.prepare()).kind).toBe("ready");
    expect(state.fetched()).toContain(HOME);
    expect(state.fetched()).toContain(RIVAL);
  });

  it("reads the page again when the observation has outlived its day", async () => {
    const state = v3Fixture(library(observed("own_page", HOME, { observedAt: EXPIRED }), observed("competitor_page", RIVAL)));
    expect((await state.prepare()).kind).toBe("ready");
    // Only the expired one is re-read. Reuse is per target, not per run.
    expect(state.fetched()).toContain(HOME);
    expect(state.fetched()).not.toContain(RIVAL);
  });

  it("reads the page again rather than inventing a source the evidence contract would refuse", async () => {
    // An observation with nothing quotable cannot become a source -- the
    // contract requires an excerpt -- and trimming one into shape would be a
    // claim about a page nobody can cite. It falls back to the fetch.
    const empty = observed("own_page", HOME);
    const state = v3Fixture(library({ ...empty, status: { kind: "ok", bodyHash: BODY_HASH, excerpts: [], structured: {} } },
      observed("competitor_page", RIVAL)));
    expect((await state.prepare()).kind).toBe("ready");
    expect(state.fetched()).toContain(HOME);
  });

  it("does not read a page the update already found unreachable, and does not call it observed", async () => {
    const state = v3Fixture(library(observed("own_page", HOME),
      observed("competitor_page", RIVAL, { status: { kind: "unavailable", reason: "not_found" } })));
    expect((await state.prepare()).kind).toBe("ready");

    expect(state.fetched()).not.toContain(RIVAL);
    const evidence = await state.evidence();
    const rival = evidence.sourceCatalogue.find(source => source.kind === "competitor_page");
    // Reported as the failure it was, with no observation time: a reused
    // failure is not a fresh measurement of anything.
    expect(rival).toMatchObject({ url: RIVAL, availability: "unavailable", reason: "not_found", observedAt: null, bodyHash: null });
    expect(evidence.availability).toBe("partial");
  });

  it("falls back to fetching when the observation library cannot be reached", async () => {
    const state = v3Fixture(library(observed("own_page", HOME), observed("competitor_page", RIVAL)));
    state.dependencies.readLatestObservation.mockResolvedValue({ kind: "unavailable" });
    expect((await state.prepare()).kind).toBe("ready");
    // An outage in the library is not evidence that a page was read today.
    expect(state.fetched()).toContain(HOME);
    expect(state.fetched()).toContain(RIVAL);
  });

  it("reads nothing at all for a confirmed competitor the update's plan leaves out", async () => {
    /*
     * Two confirmed competitors that are one site: `planGeoRunCollection`
     * budgets against the apex host, so `www.astro.example` shares
     * `astro.example`'s hourly allowance and gets no operation of its own.
     * Before this, the model step read it anyway -- its home page and then a
     * pricing or product page off it -- two requests against an allowance a
     * sibling target had already spent, under no ledger row at all.
     */
    const base = completePayloadV3();
    const generationInput = { ...base.generationInput, competitors: [
      { domain: "astro.example", brandName: "Astro", confirmed: true },
      { domain: "www.astro.example", brandName: "Astro WWW", confirmed: true },
    ] };
    const widened = parseGeoKbPayloadV3({ ...base, generationInput,
      runRef: { ...base.runRef, generationInputHash: geoGenerationInputHashV3({ ...base, generationInput }) } });
    const state = v3Fixture(library(observed("own_page", HOME), observed("competitor_page", RIVAL),
      // A row for the sibling exists, and is still not credited: crediting a
      // target the plan never named would put reuse where no operation is.
      observed("competitor_page", "https://www.astro.example/")), widened);

    expect((await state.prepare()).kind).toBe("ready");
    expect([...state.fetched()].sort()).toEqual(MACHINE_FILES.map(name => `https://example.com/${name}`).sort());
    expect(state.dependencies.readLatestObservation.mock.calls.map(([selector]) => selector.url))
      .toEqual([HOME, RIVAL]);

    const evidence = await state.evidence();
    const sibling = evidence.sourceCatalogue.find(source => source.url === "https://www.astro.example/");
    // Said, not hidden: "this update did not look" is its own answer, distinct
    // from "we looked and got nothing" and from a page we actually read.
    expect(sibling).toMatchObject({ kind: "competitor_page", availability: "unavailable", reason: "not_collected",
      observedAt: null, bodyHash: null, excerpts: [] });
  });

  it("credits nothing when the target has no website row to key the library by", async () => {
    const state = v3Fixture(library(observed("own_page", HOME), observed("competitor_page", RIVAL)));
    state.dependencies.readProfile.mockResolvedValue({ kind: "missing" });
    expect((await state.prepare()).kind).toBe("ready");
    expect(state.dependencies.readLatestObservation).not.toHaveBeenCalled();
    expect(state.fetched()).toContain(HOME);
  });
});

describe("v2 route entrypoints", () => {
  it.each([["load", 60], ["draft", 60], ["sources", 120], ["roles", 300], ["knowledge", 300], ["prepare", 300], ["generation", 30], ["prepared", 30], ["freeze", 30]] as const)("wires %s to Node private POST admission without dispatching in a module import", async (name, maxDuration) => {
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
