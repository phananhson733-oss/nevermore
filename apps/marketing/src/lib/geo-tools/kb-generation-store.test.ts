import { describe, expect, it, vi } from "vitest";
import { createGeoKbGenerationStore } from "./kb-generation-store.ts";
import { geoGenerationInputHash } from "./kb-generation.ts";
import { buildGeoKnowledgeGenerationResultV1, geoKnowledgeGenerationResultHash } from "./kb-knowledge-generation-contract.ts";
import { collectGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceReadResource } from "./kb-knowledge-evidence.ts";
import { buildGeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
import { buildGeoKnowledgeGenerationInputManifest } from "./kb-prepared-contract.ts";
import { buildGeoKnowledgeGenerationResultV2, buildGeoKnowledgeSynthesisInputV2 } from "./kb-knowledge-synthesis-v2-contract.ts";
import { geoV2EvidenceFixture, geoV2NarrativeFixture, geoV2ProfileRefFixture } from "./kb-knowledge-synthesis-v2-fixtures.ts";
const userId = "11111111-1111-4111-8111-111111111111", kbId = "22222222-2222-4222-8222-222222222222", generationId = "33333333-3333-4333-8333-333333333333", token = "44444444-4444-4444-8444-444444444444";
const input = { userId, kbId, kind: "roles" as const, idempotencyKey: "typed_request_1", input: { kbId, baseDraftVersion: "1", baseDraftHash: "a".repeat(64), profileCopyHash: "b".repeat(64) } };
const inputHash = geoGenerationInputHash("roles", input.input);
const record = () => ({ generationId, userId, kbId, kind: "roles", inputHash, state: "claimed", result: null, errorReason: null, attempt: null });
const attempt = { attemptedCalls: 1 as const, delivery: "response_received" as const, modelRequested: "fixture-model", inputTokens: 100, outputTokens: 200, requestCount: 1 };
async function knowledgeFixture() {
  const observedAt = "2026-09-04T07:11:15.461Z";
  const readResource: GeoKnowledgeEvidenceReadResource = async ({ url }) => {
    if (url === "https://product.example/") return { kind: "ok", url, contentType: "text/html", observedAt, body: "<html lang=\"en\"><body><h1>Pine Cloud</h1><p>Pine Cloud is project software for teams of 2. It requires human approval.</p></body></html>" };
    if (url.endsWith("/robots.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "User-agent: *\nAllow: /" };
    if (url.endsWith("/sitemap.xml")) return { kind: "ok", url, contentType: "application/xml", observedAt, body: "<urlset><url><loc>https://product.example/</loc></url></urlset>" };
    return { kind: "unavailable", url, reason: "not_found" };
  };
  const evidence = await collectGeoKnowledgeEvidenceV1({ targetUrl: "https://product.example/", competitors: [] }, { readResource, now: () => new Date("2026-09-04T07:12:00.000Z") });
  const synthesisInput = buildGeoKnowledgeSynthesisInputV1({ officialName: "Pine Cloud", aliases: ["Pine"], categoryTerms: ["Project software"], market: "US", language: "en-US" }, evidence);
  const sourceRef = synthesisInput.sourceCatalogue.find(source => source.kind === "own_page")!.id;
  const narrative = {
    schemaVersion: "marketing-geo-knowledge-narrative.v1" as const,
    entity: { definitions: { w25: "Pine Cloud is project software for teams of 2.", w55: "Pine Cloud is project software for teams of 2 with human approval.", w120: "Pine Cloud is project software for teams of 2. Each workflow requires human approval." }, audience: { who: "Teams of 2", notFor: null }, founded: { year: null, team: null, location: null }, disambiguation: null, sourceRefs: [sourceRef] },
    facts: [{ id: "fact:teams", type: "feature" as const, statement: "Pine Cloud supports teams of 2.", sourceRefs: [sourceRef] }],
    qa: [{ id: "qa:teams", intent: "applicability" as const, question: "Does Pine Cloud support teams of 2?", variants: [], directAnswer: "Yes. Pine Cloud supports teams of 2.", expansion: null, sourceRefs: [sourceRef] }],
    comparisons: [], scope: { does: [{ id: "scope:does", text: "Supports teams of 2.", sourceRefs: [sourceRef] }], doesNot: [], needsHuman: [{ id: "scope:human", text: "Requires human approval.", sourceRefs: [sourceRef] }], misconceptions: [] },
  };
  const manifest = buildGeoKnowledgeGenerationInputManifest({ kbId, baseDraftVersion: "2", baseDraftHash: "a".repeat(64), profileCopyHash: "b".repeat(64), sourceReceiptRefs: [], knowledgeSynthesisInput: synthesisInput });
  const result = buildGeoKnowledgeGenerationResultV1({ schemaVersion: "marketing-geo-knowledge-generation-result.v1", generationId, kbId, manifest, evidence, synthesisInput, narrative, generatedAt: "2026-09-04T07:13:00.000Z" });
  return { manifest, result };
}
/**
 * The knowledge result a V3 run produces, built by the shipped V2 builders.
 *
 * V3 is the only shape that binds a run to `generationInputHash`; V1 binds to a
 * `profileCopy` hash, a field a V3 draft does not have. This store used to parse
 * every knowledge result as V1, so a real V3 result threw on the way in and the
 * paid narrative was reported as `store_unavailable` and discarded.
 */
function knowledgeV2Fixture(generationInputHash = "d".repeat(64)) {
  const evidence = geoV2EvidenceFixture();
  const synthesisInput = buildGeoKnowledgeSynthesisInputV2({ officialName: "Pine Cloud", aliases: ["Pine"], categoryTerms: ["Project software"],
    market: "US", language: "en-US", profileRef: geoV2ProfileRefFixture(), generationInputHash }, evidence);
  const manifest = { schemaVersion: "marketing-geo-knowledge-generation-input.v2", kbId, baseDraftVersion: "2", baseDraftHash: "a".repeat(64),
    generationInputHash, sourceReceiptRefs: [], knowledgeSynthesisInput: synthesisInput };
  const result = buildGeoKnowledgeGenerationResultV2({ schemaVersion: "marketing-geo-knowledge-generation-result.v2", generationId, kbId,
    manifest, synthesisInput, evidence, narrative: geoV2NarrativeFixture(), generatedAt: "2026-09-04T07:13:00.000Z" });
  return { manifest, result, inputHash: geoGenerationInputHash("knowledge_pack", JSON.parse(JSON.stringify(manifest))) };
}
describe("generation store transport", () => {
  it("returns the exclusive capability only for a matching claimed record", async () => {
    const callRpc = vi.fn(async () => ({ data: [{ outcome: "claimed", generation: record(), claim_token: token }], error: null }));
    expect(await createGeoKbGenerationStore({ callRpc }).claim({ ...input, inputHash })).toEqual({ kind: "claimed", generation: record(), claimToken: token });
  });
  it.each(["owner", "kb", "kind", "hash", "secret"])("refuses a wrong/leaking %s record", async field => {
    const generation = record();
    if (field === "owner") generation.userId = token;
    if (field === "kb") generation.kbId = token;
    if (field === "kind") generation.kind = "questions";
    if (field === "hash") generation.inputHash = "c".repeat(64);
    if (field === "secret") Object.assign(generation, { claimToken: token });
    const store = createGeoKbGenerationStore({ callRpc: async () => ({ data: [{ outcome: "claimed", generation, claim_token: token }], error: null }) });
    expect(await store.claim({ ...input, inputHash })).toEqual({ kind: "unavailable" });
  });
  it("fails closed on ambiguous SQL acknowledgement without dispatch authority", async () => {
    const store = createGeoKbGenerationStore({ callRpc: async () => { throw new Error("Synthetic timeout"); } });
    expect(await store.markDispatched({ userId, kbId, generationId, claimToken: token })).toEqual({ kind: "unavailable" });
  });
  it("reads a succeeded knowledge-pack generation by its exact idempotency key", async () => {
    const { manifest, result } = await knowledgeFixture();
    const knowledgeHash = geoGenerationInputHash("knowledge_pack", manifest as any);
    const generation = { generationId, userId, kbId, kind: "knowledge_pack", inputHash: knowledgeHash, state: "succeeded", result, errorReason: null, attempt };
    const callRpc = vi.fn(async () => ({ data: [{ outcome: "found", generation }], error: null }));
    const store = createGeoKbGenerationStore({ callRpc });
    expect(await store.readByKey({ userId, kbId, kind: "knowledge_pack", idempotencyKey: "knowledge_pack_1" })).toEqual({ kind: "ok", generation });
    expect(callRpc).toHaveBeenCalledWith("marketing_geo_read_generation_by_key", { p_user_id: userId, p_kb_id: kbId, p_kind: "knowledge_pack", p_idempotency_key: "knowledge_pack_1" });
  });
  it("finishes only an exact knowledge-pack result for the generation scope", async () => {
    const { manifest, result } = await knowledgeFixture();
    const generation = { generationId, userId, kbId, kind: "knowledge_pack", inputHash: geoGenerationInputHash("knowledge_pack", manifest as any), state: "succeeded", result, errorReason: null, attempt };
    const callRpc = vi.fn(async () => ({ data: [{ outcome: "finished", generation }], error: null }));
    const store = createGeoKbGenerationStore({ callRpc });
    const scope = { userId, kbId, generationId, claimToken: token };
    expect(await store.finish(scope, { state: "succeeded", result: result as any, errorReason: null, attempt })).toEqual({ kind: "ok", generation });

    const wrongGeneration: any = structuredClone(result);
    wrongGeneration.generationId = token;
    const { contentHash: _contentHash, ...wrongBody } = wrongGeneration;
    wrongGeneration.contentHash = geoKnowledgeGenerationResultHash(wrongBody);
    callRpc.mockClear();
    expect(await store.finish(scope, { state: "succeeded", result: wrongGeneration, errorReason: null, attempt })).toEqual({ kind: "unavailable" });
    expect(callRpc).not.toHaveBeenCalled();
  });
  it("stores a V2 knowledge result instead of throwing the paid narrative away", async () => {
    const { result, inputHash } = knowledgeV2Fixture();
    const generation = { generationId, userId, kbId, kind: "knowledge_pack", inputHash, state: "succeeded", result, errorReason: null, attempt };
    const callRpc = vi.fn(async () => ({ data: [{ outcome: "finished", generation }], error: null }));
    const store = createGeoKbGenerationStore({ callRpc });
    expect(await store.finish({ userId, kbId, generationId, claimToken: token }, { state: "succeeded", result: result as any, errorReason: null, attempt })).toEqual({ kind: "ok", generation });
    // The result reached the database rather than being refused before the call.
    expect(callRpc).toHaveBeenCalledWith("marketing_geo_finish_generation", expect.objectContaining({ p_state: "succeeded", p_result: result }));
  });
  it("reads a stored V2 knowledge record back, and only when its manifest is what was paid for", async () => {
    const { manifest, result, inputHash } = knowledgeV2Fixture();
    const generation = { generationId, userId, kbId, kind: "knowledge_pack", inputHash, state: "succeeded", result, errorReason: null, attempt };
    const store = createGeoKbGenerationStore({ callRpc: async () => ({ data: [{ outcome: "found", generation }], error: null }) });
    expect(await store.readLatest({ userId, kbId, kind: "knowledge_pack" })).toEqual({ kind: "ok", generation });
    // The recorded input hash is the hash of the manifest the result carries; a
    // record claiming a different one names inputs this result was not bought
    // against, and the V2 manifest has to be hashed exactly as the V1 one is.
    expect(inputHash).toBe(geoGenerationInputHash("knowledge_pack", JSON.parse(JSON.stringify(manifest))));
    const drifted = createGeoKbGenerationStore({ callRpc: async () => ({ data: [{ outcome: "found", generation: { ...generation, inputHash: "f".repeat(64) } }], error: null }) });
    expect(await drifted.readLatest({ userId, kbId, kind: "knowledge_pack" })).toEqual({ kind: "unavailable" });
  });
  it("still refuses a V2 knowledge result offered as another kind", async () => {
    const { result, inputHash } = knowledgeV2Fixture();
    for (const kind of ["roles", "questions"] as const) {
      const generation = { generationId, userId, kbId, kind, inputHash, state: "succeeded", result, errorReason: null, attempt };
      const store = createGeoKbGenerationStore({ callRpc: async () => ({ data: [{ outcome: "found", generation }], error: null }) });
      expect(await store.readLatest({ userId, kbId, kind })).toEqual({ kind: "unavailable" });
    }
  });
  it("rejects malformed or wrong-kind succeeded knowledge results", async () => {
    const { manifest, result } = await knowledgeFixture();
    const malformed = { ...result, contentHash: "f".repeat(64) };
    const base = { generationId, userId, kbId, inputHash: geoGenerationInputHash("knowledge_pack", manifest as any), state: "succeeded", errorReason: null, attempt };
    for (const generation of [
      { ...base, kind: "knowledge_pack", result: malformed },
      { ...base, kind: "knowledge_pack", inputHash: "f".repeat(64), result },
      { ...base, kind: "questions", result },
      { ...base, kind: "roles", result },
    ]) {
      const store = createGeoKbGenerationStore({ callRpc: async () => ({ data: [{ outcome: "found", generation }], error: null }) });
      expect(await store.readByKey({ userId, kbId, kind: generation.kind as any, idempotencyKey: "knowledge_pack_1" })).toEqual({ kind: "unavailable" });
    }
  });
});
