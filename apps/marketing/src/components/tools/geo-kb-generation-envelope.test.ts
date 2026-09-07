import { describe, expect, it } from "vitest";

import {
  createGeoPreparedCandidateV2,
  GEO_PREPARED_CANDIDATE_V2_MAX_BYTES,
  GEO_PREPARED_CANDIDATE_V2_SCHEMA,
  geoKnowledgeGenerationInputHash,
  parseGeoPreparedCandidateV2,
} from "../../lib/geo-tools/kb-prepared-contract.ts";
import { buildGeoKnowledgePackV1 } from "../../lib/geo-tools/kb-knowledge-pack-contract.ts";
import {
  GEO_KNOWLEDGE_SYNTHESIS_INPUT_SCHEMA,
  geoKnowledgeSynthesisInputDigest,
  geoKnowledgeSynthesisSourceCatalogueDigest,
  type GeoKnowledgeSynthesisInputBodyV1,
} from "../../lib/geo-tools/kb-knowledge-synthesis-contract.ts";
import { buildGeoSnapshotContextV2 } from "../../lib/geo-tools/snapshot-context-v2.ts";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
import { geoV2JsonbBytes } from "../../lib/geo-tools/kb-v2-json.ts";
import {
  GEO_KB_GENERATION_RECORD_WIRE_MAX_BYTES,
  GEO_KB_GENERATION_RESULT_WIRE_MAX_BYTES,
  GEO_KB_GENERATION_WIRE_MAX_BYTES,
  parseGeoKbGenerationWire,
} from "./geo-kb-v2-wire.ts";

const ATTEMPT = { attemptedCalls: 1 as const, delivery: "response_received" as const, modelRequested: "fixture-model", inputTokens: 10, outputTokens: 20, requestCount: 1 };
const AT = "2026-09-04T07:11:15.461Z";

function serverCandidateV2() {
  const payload = completePayloadV2(), questionSet = questionSetV2();
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet,
    sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }],
    sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
  const source = { id: "source:home", kind: "own_page" as const, label: "Home", url: "https://example.com/", competitor: null,
    availability: "available" as const, reason: null, observedAt: AT, bodyHash: "a".repeat(64), excerpts: ["Acme is analytics software."] };
  const knowledgePack = buildGeoKnowledgePackV1({ schemaVersion: "marketing-geo-knowledge-pack.v1",
    meta: { generatedAt: AT, lastScanAt: AT, market: payload.market.country, language: payload.market.language, counts: { facts: 0, qa: 0, comparisons: 0 } },
    entity: { status: "unavailable", reason: "generation_unavailable" }, facts: { status: "unavailable", reason: "generation_unavailable" },
    qa: { status: "unavailable", reason: "generation_unavailable" }, comparisons: { status: "unavailable", reason: "not_applicable" },
    scope: { status: "unavailable", reason: "generation_unavailable" }, evidence: { status: "unavailable", reason: "insufficient_evidence" },
    machine: { status: "unavailable", reason: "not_collected" }, coverage: { status: "unavailable", reason: "insufficient_evidence" }, sourceCatalogue: [source] });
  const synthesisBody: GeoKnowledgeSynthesisInputBodyV1 = { schemaVersion: GEO_KNOWLEDGE_SYNTHESIS_INPUT_SCHEMA,
    officialName: payload.officialName, aliases: [...payload.aliases], categoryTerms: [...payload.categoryTerms], market: payload.market.country,
    language: payload.market.language, targetUrl: new URL(payload.targetUrl).toString(),
    confirmedCompetitors: payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const })),
    evidenceContentHash: "b".repeat(64), sourceCatalogueHash: geoKnowledgeSynthesisSourceCatalogueDigest([source]), sourceCatalogue: [source] };
  const knowledgeSynthesisInput = { ...synthesisBody, contentHash: geoKnowledgeSynthesisInputDigest(synthesisBody) };
  const base = { schemaVersion: GEO_PREPARED_CANDIDATE_V2_SCHEMA, candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID,
    baseDraftVersion: "1", baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), sourceReceiptRefs: [],
    generatorVersion: questionSet.methodVersion, payload, questionSet, context, knowledgePack, knowledgeSynthesisInput };
  return createGeoPreparedCandidateV2({ ...base, knowledgeGeneration: { generationId: V2_CANDIDATE_ID,
    inputHash: geoKnowledgeGenerationInputHash(base), synthesisInputHash: knowledgeSynthesisInput.contentHash,
    evidenceContentHash: knowledgeSynthesisInput.evidenceContentHash, payloadHash: base.baseDraftHash, questionSetHash: context.questionSetHash,
    packHash: knowledgePack.contentHash, sourceCatalogueHash: geoV2Digest(knowledgePack.sourceCatalogue), promptVersion: "geo-kb-knowledge-pack.v1" } });
}

function generation(result: unknown) {
  return { generationId: V2_CANDIDATE_ID, kbId: V2_KB_ID, kind: "questions" as const, inputHash: "c".repeat(64),
    state: "succeeded" as const, result, errorReason: null, attempt: ATTEMPT };
}

function observedSyntheticCandidate(candidate: ReturnType<typeof serverCandidateV2>, padding: number) {
  const result = { ...candidate, payload: { ...candidate.payload, officialName: "x".repeat(padding) } };
  let schemaReads = 0;
  Object.defineProperty(result, "schemaVersion", { enumerable: true, configurable: true,
    get: () => { schemaReads += 1; return GEO_PREPARED_CANDIDATE_V2_SCHEMA; } });
  return { envelope: generation(result), reads: () => schemaReads, reset: () => { schemaReads = 0; } };
}

describe("browser generation envelope bounds", () => {
  it("keeps the browser result allowance aligned with the server candidate contract plus bounded record overhead", () => {
    expect(GEO_KB_GENERATION_RESULT_WIRE_MAX_BYTES).toBe(GEO_PREPARED_CANDIDATE_V2_MAX_BYTES);
    expect(GEO_KB_GENERATION_RECORD_WIRE_MAX_BYTES).toBe(4_096);
    expect(GEO_KB_GENERATION_WIRE_MAX_BYTES).toBe(GEO_KB_GENERATION_RESULT_WIRE_MAX_BYTES + GEO_KB_GENERATION_RECORD_WIRE_MAX_BYTES);
  });

  it("round-trips a strictly server-accepted V2 candidate through the browser generation parser", () => {
    const candidate = serverCandidateV2(), envelope = generation(candidate);
    expect(parseGeoPreparedCandidateV2(candidate)).toEqual(candidate);
    expect(parseGeoKbGenerationWire(envelope)).toEqual(envelope);
  });

  it("does not reject a declared-boundary envelope before the strict inner candidate parser runs", () => {
    const synthetic = observedSyntheticCandidate(serverCandidateV2(), 2_150_000);
    const bytes = geoV2JsonbBytes(synthetic.envelope);
    expect(bytes).toBeGreaterThan(2_100_000);
    expect(bytes).toBeLessThanOrEqual(GEO_KB_GENERATION_WIRE_MAX_BYTES);
    synthetic.reset();
    expect(parseGeoKbGenerationWire(synthetic.envelope)).toBeNull();
    // One outer byte measurement visits values twice (canonical text and JSONB
    // spacing). More than two proves the inner candidate parser was reached.
    expect(synthetic.reads()).toBeGreaterThan(2);
  });

  it("rejects an oversized envelope before traversing its inner candidate a second time", () => {
    const synthetic = observedSyntheticCandidate(serverCandidateV2(), GEO_KB_GENERATION_WIRE_MAX_BYTES + 8_192);
    expect(geoV2JsonbBytes(synthetic.envelope)).toBeGreaterThan(GEO_KB_GENERATION_WIRE_MAX_BYTES);
    synthetic.reset();
    expect(parseGeoKbGenerationWire(synthetic.envelope)).toBeNull();
    expect(synthetic.reads()).toBe(2);
  });
});
