import { describe, expect, it } from "vitest";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { createGeoPreparedCandidate, parseGeoPreparedCandidate, GEO_PREPARED_CANDIDATE_SCHEMA } from "./kb-prepared-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
function fixture() {
  const payload = completePayloadV2(), questionSet = questionSetV2();
  const context = buildGeoSnapshotContextV2({ kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID, payload, questionSet, sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 }, availableEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 } } });
  return { schemaVersion: GEO_PREPARED_CANDIDATE_SCHEMA, candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, baseDraftVersion: "1", baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), sourceReceiptRefs: [], generatorVersion: "geo-semantic.v1", payload, questionSet, context };
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
});
