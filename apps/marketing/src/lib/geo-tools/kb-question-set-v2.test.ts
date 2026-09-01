import { describe, expect, it } from "vitest";
import { parseGeoQuestionSetV2, assertRegistryQuestionsMatch } from "./kb-question-set-v2.ts";
import { buildGeoQuestionSet } from "./kb-questions.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";

const fixture = () => ({ schemaVersion: "marketing-geo-question-set.v2", registryVersion: "none", methodVersion: "geo-semantic.v1", language: "en", country: "US", evidenceRefs: ["manual:r1"], entityCatalog: [{ id: "E1", text: "late invoices", kind: "role_pain", roleId: "r1", evidenceRefs: ["manual:r1"] }], questions: [{ id: "q1", text: "How can finance teams reduce late invoices?", layer: "problem", mode: "demand", roleId: "r1", requiredEntities: ["late invoices"], templateId: null, calibrated: false, provenance: { kind: "semantic", generatorVersion: "geo-semantic.v1", evidenceRefs: ["manual:r1"], entityRefs: ["E1"] } }] });
describe("exact v2 questions", () => {
  it("preserves semantic metadata and evidence entities", () => expect(parseGeoQuestionSetV2(fixture())).toEqual(fixture()));
  it.each(["mode", "calibrated", "template", "unknown_entity", "unknown_evidence", "entity_text", "wrong_role"])("rejects forged %s", kind => {
    const value = fixture();
    if (kind === "mode") value.questions[0]!.mode = "retrieval";
    if (kind === "calibrated") value.questions[0]!.calibrated = true;
    if (kind === "template") Object.assign(value.questions[0]!, { templateId: "forged" });
    if (kind === "unknown_entity") value.questions[0]!.provenance.entityRefs = ["foreign"];
    if (kind === "unknown_evidence") value.questions[0]!.provenance.evidenceRefs = ["foreign"];
    if (kind === "entity_text") value.questions[0]!.requiredEntities = ["invented entity"];
    if (kind === "wrong_role") value.entityCatalog[0]!.roleId = "another-role";
    expect(() => parseGeoQuestionSetV2(value)).toThrow();
  });
  it("compares registry questions to exact server-rendered originals, not a boolean claim", () => {
    const registry = buildGeoQuestionSet(contextPayload());
    const original = registry.questions.find(q => q.mode === "retrieval")!;
    const entityCatalog = original.requiredEntities.map((text, i) => ({ id: `E${i}`, text, kind: "category", roleId: null, evidenceRefs: ["manual:r1"] }));
    const set = parseGeoQuestionSetV2({ ...fixture(), registryVersion: registry.registryVersion, entityCatalog, questions: [{ ...original, provenance: { kind: "registry", generatorVersion: registry.registryVersion, evidenceRefs: [], entityRefs: entityCatalog.map(item => item.id) } }] });
    expect(() => assertRegistryQuestionsMatch(set, registry)).not.toThrow();
    expect(() => assertRegistryQuestionsMatch({ ...set, questions: [{ ...set.questions[0]!, text: "Unmeasured replacement" }] }, registry)).toThrow();
  });
});
