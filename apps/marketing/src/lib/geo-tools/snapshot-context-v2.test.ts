import { describe, expect, it } from "vitest";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "./kb-v2.test-fixtures.ts";
import { assertGeoSnapshotContextV2KnownInput, buildGeoSnapshotContextV2, parseGeoSnapshotContextV2, type BuildGeoSnapshotContextV2Input } from "./snapshot-context-v2.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { buildGeoQuestionSet } from "./kb-questions.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";
import { parseGeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { extractGeoCompetitorSourceV2 } from "./kb-sources.ts";
function input(): BuildGeoSnapshotContextV2Input { return { candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload: completePayloadV2(), questionSet: questionSetV2(), sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } }; }
describe("v2 context policy", () => {
  it("retains the complete last competitor extraction separately from the saved manual mapping", () => {
    const value = input();
    const capture = extractGeoCompetitorSourceV2("rival.example", { kind: "ok", url: "https://rival.example/", observedAt: "2026-08-31T00:00:00.000Z", body: '<meta property="og:site_name" content="Old Name"><title>Other Name</title>' }, "C1");
    const evidence = { receiptId: V2_CANDIDATE_ID, contentHash: "e".repeat(64), receiptCreatedAt: "2026-08-31T00:00:00.000Z", capture };
    const context = buildGeoSnapshotContextV2({ ...value, payload: { ...value.payload, competitors: [{ domain: "rival.example", brandName: "Manually corrected name", confirmed: true }] }, sourceReceiptRefs: [{ receiptId: evidence.receiptId, contentHash: evidence.contentHash }], competitorEvidence: [evidence] });
    expect(capture.status).toBe("conflict");
    expect(context.competitorEvidence).toEqual([evidence]);
    expect(context.competitors[0]).toMatchObject({ brandName: "Manually corrected name", confirmed: true });
    expect(parseGeoSnapshotContextV2(JSON.parse(JSON.stringify(context)))).toEqual(context);
  });
  it("records the absence of any selected competitor capture explicitly", () => {
    expect(buildGeoSnapshotContextV2(input()).competitorEvidence).toEqual([]);
  });
  it.each(["missing_field", "missing_ref", "wrong_hash", "wrong_domain", "duplicate_domain", "future_observation", "foreign_signal", "missing_body_hash"])("rejects rehashed competitor capture %s", kind => {
    const value = input(), capture = extractGeoCompetitorSourceV2("rival.example", { kind: "ok", url: "https://rival.example/", observedAt: "2026-08-31T00:00:00.000Z", body: '<meta property="og:site_name" content="Old Name">' }, "C1");
    const evidence = { receiptId: V2_CANDIDATE_ID, contentHash: "e".repeat(64), receiptCreatedAt: "2026-08-31T00:00:00.000Z", capture };
    const { contentHash: _hash, ...body } = buildGeoSnapshotContextV2({ ...value, payload: { ...value.payload, competitors: [{ domain: "rival.example", brandName: "Manual", confirmed: true }] }, sourceReceiptRefs: [{ receiptId: evidence.receiptId, contentHash: evidence.contentHash }], competitorEvidence: [evidence] });
    const bad = structuredClone(body);
    if (kind === "missing_field") Reflect.deleteProperty(bad, "competitorEvidence");
    if (kind === "missing_ref") bad.sourceReceiptRefs = [];
    if (kind === "wrong_hash") Object.assign(bad.competitorEvidence[0]!, { contentHash: "a".repeat(64) });
    if (kind === "wrong_domain") bad.competitors = [];
    if (kind === "duplicate_domain") bad.competitorEvidence = [...bad.competitorEvidence, ...bad.competitorEvidence];
    if (kind === "future_observation") Object.assign(bad.competitorEvidence[0]!, { receiptCreatedAt: "2026-08-30T00:00:00.000Z" });
    if (kind === "foreign_signal") bad.competitorEvidence[0]!.capture.signals[0]!.url = "https://foreign.example/";
    if (kind === "missing_body_hash") bad.competitorEvidence[0]!.capture.bodyHash = null;
    expect(() => parseGeoSnapshotContextV2({ ...bad, contentHash: geoV2Digest(bad) })).toThrow();
  });
  it("rejects known oversized capture metadata before any questions exist and retains response-copy costs", () => {
    const value = input(), contentHash = "e".repeat(64), receiptCreatedAt = "2026-08-31T00:00:00.000Z";
    const competitors = Array.from({ length: 5 }, (_, index) => ({ domain: `rival${index}.example`, brandName: "Manual", confirmed: true }));
    const competitorEvidence = competitors.map((competitor, i) => ({ receiptId: V2_CANDIDATE_ID, contentHash, receiptCreatedAt, capture: extractGeoCompetitorSourceV2(competitor.domain, { kind: "ok", url: `https://${competitor.domain}/`, observedAt: receiptCreatedAt,
      body: `<script type="application/ld+json">${JSON.stringify({ "@graph": Array.from({ length: 20 }, (_, index) => ({ "@type": "Organization", url: `https://${competitor.domain}/`, name: `${index}${"名".repeat(198)}`, alternateName: Array.from({ length: 10 }, (_, n) => `${n}${"别".repeat(198)}`) })) })}</script>` }, `C${i + 1}`) }));
    const known = { ...value, payload: { ...value.payload, competitors }, sourceReceiptRefs: [{ receiptId: V2_CANDIDATE_ID, contentHash }], competitorEvidence };
    expect(Buffer.byteLength(JSON.stringify(competitorEvidence))).toBeGreaterThan(524288);
    expect(() => assertGeoSnapshotContextV2KnownInput(known)).toThrow(/byte limit/u);
    expect(() => buildGeoSnapshotContextV2(known)).toThrow(/byte limit/u);
    // The full capture remains in prepared, latest-generation result and frozen;
    // no lossy summary is substituted merely to reduce the editor response size.
    const small = { ...known, competitorEvidence: competitorEvidence.slice(0, 1) };
    expect(() => assertGeoSnapshotContextV2KnownInput(small)).not.toThrow();
    const withEvidence = buildGeoSnapshotContextV2(small), without = buildGeoSnapshotContextV2({ ...small, competitorEvidence: [] });
    const bytes = (context: unknown) => Buffer.byteLength(JSON.stringify({ prepared: { context }, generation: { result: { context } }, frozen: { context } }));
    expect(bytes(withEvidence) - bytes(without)).toBe(3 * (Buffer.byteLength(JSON.stringify(small.competitorEvidence)) - 2));
  });
  it("allows an exact global registry evaluation probe without inventing a role", () => {
    const value = input(), registry = buildGeoQuestionSet(contextPayload());
    const q = registry.questions.find(item => item.templateId === "geo.retrieval.free_plan")!;
    expect(q.roleId).toBeNull();
    const entityCatalog = q.requiredEntities.map((text, i) => ({ id: `E${i}`, text, kind: "category", roleId: null, evidenceRefs: ["manual:r1"] }));
    const questions = parseGeoQuestionSetV2({ ...value.questionSet, registryVersion: registry.registryVersion, entityCatalog, questions: [{ ...q, provenance: { kind: "registry", generatorVersion: registry.registryVersion, evidenceRefs: [], entityRefs: entityCatalog.map(item => item.id) } }] });
    const context = buildGeoSnapshotContextV2({ ...value, questionSet: questions, payload: { ...value.payload, roles: [] } });
    expect(context.roles).toEqual([]);
    expect(context.skippedLayers).toEqual(["problem", "evaluation"]);
    expect(context.questionSetHash).toBe(geoV2Digest(questions));
  });
  it("allows reviewed manual roles without GSC and preserves user confirmation as non-observed", () => {
    const value = buildGeoSnapshotContextV2(input());
    expect(value.roles[0]).toMatchObject({ source: { kind: "manual" }, eligibleLayers: ["problem", "evaluation"] });
    expect(value.skippedLayers).toEqual([]);
    expect(value.facts[0]).toMatchObject({ source: "user_confirmed", value: "3" });
    expect(parseGeoSnapshotContextV2(value)).toEqual(value);
  });
  it.each(["pending", "excluded"] as const)("never uses %s roles as question authority", review => {
    const value = input();
    expect(() => buildGeoSnapshotContextV2({ ...value, payload: { ...value.payload, roles: [{ ...value.payload.roles[0]!, review }] } })).toThrow();
  });
  it.each(["pending", "excluded"] as const)("keeps %s facts but does not turn their filled values into positive evidence", review => {
    const value = input();
    const context = buildGeoSnapshotContextV2({ ...value, payload: { ...value.payload, facts: [{ ...value.payload.facts[0]!, review }] } });
    expect(context.facts[0]).toMatchObject({ review, value: null, source: "none" });
  });
  it("requires server-known model edit lineage and retains original generation/source links", () => {
    const value = input();
    const source = { ...value.payload.roles[0]!.source, kind: "model" as const, generationId: "generation-1", itemId: "role-1" };
    const updated = { ...value, payload: { ...value.payload, roles: [{ ...value.payload.roles[0]!, source, label: "Manually clarified label" }] } };
    expect(() => buildGeoSnapshotContextV2(updated)).toThrow();
    expect(buildGeoSnapshotContextV2({ ...updated, modelRoleEdits: { r1: true } }).roles[0]).toMatchObject({ source, userEdited: true });
  });
  it("will not accept an invented crawl support reference as observed evidence", () => {
    const value = input();
    const supportRef = { receiptId: V2_CANDIDATE_ID, evidenceId: "F1" };
    const context = buildGeoSnapshotContextV2({ ...value, payload: { ...value.payload, facts: [{ ...value.payload.facts[0]!, supportRef }] } });
    expect(context.facts[0]).toMatchObject({ source: "none", value: null });
  });
  it("checks source counts and refs instead of allowing self-rehashed metadata lies", () => {
    const value = buildGeoSnapshotContextV2(input());
    const { contentHash: _hash, ...body } = value;
    const wrong = { ...body, sourceSummary: { ...body.sourceSummary, selectedEvidenceCounts: { profile: 0, gsc: 99, crawl: 0, manual: 1 } } };
    expect(() => parseGeoSnapshotContextV2({ ...wrong, contentHash: geoV2Digest(wrong) })).toThrow();
  });
});
