import { describe, expect, it } from "vitest";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { buildGeoKnowledgeGenerationInputManifest, createGeoPreparedCandidate, createGeoPreparedCandidateV2, geoKnowledgeGenerationInputHash, parseAnyGeoPreparedCandidate, parseGeoPreparedCandidate, parseGeoPreparedCandidateV2, GEO_PREPARED_CANDIDATE_SCHEMA, GEO_PREPARED_CANDIDATE_V2_SCHEMA } from "./kb-prepared-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { buildGeoKnowledgePackV1 } from "./kb-knowledge-pack-contract.ts";
import { GEO_KNOWLEDGE_SYNTHESIS_INPUT_SCHEMA, geoKnowledgeSynthesisInputDigest, geoKnowledgeSynthesisSourceCatalogueDigest, type GeoKnowledgeSynthesisInputBodyV1, type GeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
function fixture() {
  const payload = completePayloadV2(), questionSet = questionSetV2();
  const context = buildGeoSnapshotContextV2({ kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID, payload, questionSet, sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 }, availableEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 } } });
  return { schemaVersion: GEO_PREPARED_CANDIDATE_SCHEMA, candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, baseDraftVersion: "1", baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), sourceReceiptRefs: [], generatorVersion: "geo-semantic.v1", payload, questionSet, context };
}
function knowledgePack() {
  return buildGeoKnowledgePackV1({
    schemaVersion: "marketing-geo-knowledge-pack.v1", meta: { generatedAt: "2026-09-04T07:11:15.461Z", lastScanAt: "2026-09-04T07:11:15.461Z", market: "US", language: "en", counts: { facts: 0, qa: 0, comparisons: 0 } },
    entity: { status: "unavailable", reason: "generation_unavailable" }, facts: { status: "unavailable", reason: "generation_unavailable" }, qa: { status: "unavailable", reason: "generation_unavailable" }, comparisons: { status: "unavailable", reason: "not_applicable" }, scope: { status: "unavailable", reason: "generation_unavailable" }, evidence: { status: "unavailable", reason: "insufficient_evidence" }, machine: { status: "unavailable", reason: "not_collected" }, coverage: { status: "unavailable", reason: "insufficient_evidence" },
    sourceCatalogue: [{ id: "source:home", kind: "own_page", label: "Home", url: "https://example.com/", competitor: null, availability: "available", reason: null, observedAt: "2026-09-04T07:11:15.461Z", bodyHash: "a".repeat(64), excerpts: ["Example public evidence."] }],
  });
}
function synthesisInput(payload: ReturnType<typeof completePayloadV2>, pack: ReturnType<typeof knowledgePack>): GeoKnowledgeSynthesisInputV1 {
  const sourceCatalogue: GeoKnowledgeSynthesisInputBodyV1["sourceCatalogue"] = pack.sourceCatalogue.flatMap(source => source.availability === "unavailable" ? [] : [{ ...source, availability: source.availability }]);
  const body: GeoKnowledgeSynthesisInputBodyV1 = { schemaVersion: GEO_KNOWLEDGE_SYNTHESIS_INPUT_SCHEMA, officialName: payload.officialName, aliases: [...payload.aliases], categoryTerms: [...payload.categoryTerms], market: payload.market.country, language: payload.market.language, targetUrl: new URL(payload.targetUrl).toString(), confirmedCompetitors: payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const })), evidenceContentHash: "d".repeat(64), sourceCatalogueHash: geoKnowledgeSynthesisSourceCatalogueDigest(sourceCatalogue), sourceCatalogue };
  return { ...body, contentHash: geoKnowledgeSynthesisInputDigest(body) };
}
describe("immutable prepared candidate", () => {
  it("round-trips the complete exact candidate without a source/generator lookup", () => {
    const body = fixture();
    const value = createGeoPreparedCandidate(body);
    expect(value).toEqual({ ...body, candidateHash: geoV2Digest(body) });
    expect(parseGeoPreparedCandidate(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });
  it.each(["draft", "copy", "candidate", "kb", "receipts", "question", "positive_fact", "role_policy", "unknown_field"])("rejects self-rehashed %s mismatch", kind => {
    const original = fixture();
    let body: unknown = original;
    if (kind === "draft") body = { ...original, baseDraftHash: "a".repeat(64) };
    if (kind === "copy") body = { ...original, profileCopyHash: "a".repeat(64) };
    if (kind === "candidate") body = { ...original, candidateId: V2_KB_ID };
    if (kind === "kb") body = { ...original, kbId: V2_CANDIDATE_ID };
    if (kind === "receipts") body = { ...original, sourceReceiptRefs: [{ receiptId: V2_KB_ID, contentHash: "a".repeat(64) }] };
    if (kind === "question") body = { ...original, questionSet: { ...original.questionSet, questions: [{ ...original.questionSet.questions[0]!, text: "Another question?" }] } };
    if (kind === "positive_fact" || kind === "role_policy") {
      const { contentHash: _hash, ...contextBody } = original.context;
      const context = kind === "positive_fact" ? { ...contextBody, facts: [{ ...contextBody.facts[0]!, value: "999" }] } : { ...contextBody, roles: [{ ...contextBody.roles[0]!, eligibleLayers: ["problem"] }], skippedLayers: ["evaluation"] };
      body = { ...original, context: { ...context, contentHash: geoV2Digest(context) } };
    }
    if (kind === "unknown_field") body = { ...original, secret: "not accepted" };
    expect(() => parseGeoPreparedCandidate({ ...(body as object), candidateHash: geoV2Digest(body) })).toThrow();
  });
  it("creates deterministic v2 candidates, keeps v1 dispatch exact, and binds pack/identity bytes", () => {
    const v1 = fixture(), pack = knowledgePack(), knowledgeSynthesisInput = synthesisInput(v1.payload, pack), base = { ...v1, schemaVersion: GEO_PREPARED_CANDIDATE_V2_SCHEMA, knowledgePack: pack, knowledgeSynthesisInput };
    const body = { ...base, knowledgeGeneration: { generationId: V2_CANDIDATE_ID, inputHash: geoKnowledgeGenerationInputHash(base), synthesisInputHash: knowledgeSynthesisInput.contentHash, evidenceContentHash: knowledgeSynthesisInput.evidenceContentHash, payloadHash: v1.baseDraftHash, questionSetHash: v1.context.questionSetHash, packHash: pack.contentHash, sourceCatalogueHash: geoV2Digest(pack.sourceCatalogue), promptVersion: "geo-kb-knowledge-pack.v1" as const } };
    const value = createGeoPreparedCandidateV2(body);
    expect(parseGeoPreparedCandidateV2(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(parseAnyGeoPreparedCandidate(createGeoPreparedCandidate(v1))).toMatchObject({ schemaVersion: GEO_PREPARED_CANDIDATE_SCHEMA });
    expect(parseAnyGeoPreparedCandidate(value)).toEqual(value);
    const { contentHash: _synthesisHash, ...synthesisBody } = value.knowledgeSynthesisInput;
    const changedSynthesisBody: GeoKnowledgeSynthesisInputBodyV1 = { ...synthesisBody, targetUrl: "https://example.com/pricing" };
    const changedSynthesis: GeoKnowledgeSynthesisInputV1 = { ...changedSynthesisBody, contentHash: geoKnowledgeSynthesisInputDigest(changedSynthesisBody) };
    const changedTarget = { ...value, knowledgeSynthesisInput: changedSynthesis,
      knowledgeGeneration: { ...value.knowledgeGeneration, synthesisInputHash: changedSynthesis.contentHash } };
    const changedInput = { ...changedTarget, knowledgeGeneration: { ...changedTarget.knowledgeGeneration, inputHash: geoKnowledgeGenerationInputHash(changedTarget) } };
    const { candidateHash: _outerHash, ...candidateBody } = changedInput;
    const wrongTarget = { ...candidateBody, candidateHash: geoV2Digest(candidateBody) };
    expect(() => parseGeoPreparedCandidateV2(wrongTarget)).toThrow(/target|scope/i);
    expect(() => parseGeoPreparedCandidateV2({ ...value, knowledgePack: { ...pack, meta: { ...pack.meta, language: "fr" } }, candidateHash: geoV2Digest({ ...body, knowledgePack: { ...pack, meta: { ...pack.meta, language: "fr" } } }) })).toThrow();
    expect(() => parseGeoPreparedCandidateV2({ ...value, knowledgeGeneration: { ...value.knowledgeGeneration, inputHash: "e".repeat(64) } })).toThrow(/hash/i);
  });

  it("binds canonical source receipt refs into the knowledge manifest and its hash", () => {
    const value = fixture(), pack = knowledgePack(), knowledgeSynthesisInput = synthesisInput(value.payload, pack);
    const first = { receiptId: "33333333-3333-4333-8333-333333333333", contentHash: "b".repeat(64) };
    const second = { receiptId: "22222222-2222-4222-8222-222222222222", contentHash: "a".repeat(64) };
    const base = { ...value, knowledgeSynthesisInput, sourceReceiptRefs: [first, second] };

    const manifest = buildGeoKnowledgeGenerationInputManifest(base);

    expect(manifest.sourceReceiptRefs).toEqual([second, first]);
    expect(geoKnowledgeGenerationInputHash(base)).not.toBe(geoKnowledgeGenerationInputHash({ ...base, sourceReceiptRefs: [second] }));
    expect(() => buildGeoKnowledgeGenerationInputManifest({ ...base, sourceReceiptRefs: [second, second] })).toThrow(/receipt|duplicate/i);
    expect(() => buildGeoKnowledgeGenerationInputManifest({ ...base, sourceReceiptRefs: [{ ...second, contentHash: "not-a-hash" }] })).toThrow(/receipt|hash/i);
  });
});
