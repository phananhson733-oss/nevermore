import { describe, expect, it } from "vitest";
import { buildGeoPreparedKnowledgeBase } from "./kb-preparation.ts";
import { completePayloadV2, V2_CANDIDATE_ID, V2_KB_ID } from "./kb-v2.test-fixtures.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { parseGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import { parseGeoKbPayload, type GeoKbPayload } from "./kb-contract.ts";
import { buildGeoQuestionSet } from "./kb-questions.ts";
import { assertRegistryQuestionsMatch } from "./kb-question-set-v2.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { GEO_QUESTION_SYNTHESIS_PROMPT_VERSION } from "./kb-synthesis.ts";
import { ROLE_SYNTHESIS_OUTPUT, QUESTION_SYNTHESIS_INPUT, QUESTION_SYNTHESIS_OUTPUT } from "./kb-synthesis-fixtures.ts";
import type { GeoSourceSummaryV2 } from "./snapshot-context-v2.ts";
import { extractGeoCompetitorSourceV2 } from "./kb-sources.ts";

function fixture() {
  const { evidenceRefs, ...role } = ROLE_SYNTHESIS_OUTPUT.roles[0]!;
  const payload = parseGeoKbPayloadV2({ ...completePayloadV2(), aliases: QUESTION_SYNTHESIS_INPUT.aliases, categoryTerms: ["invoice reminder software"], competitors: [],
    roles: [{ ...role, review: "accepted", source: { kind: "manual", generationId: null, itemId: null, evidenceRefs } }],
    facts: [{ key: "Price", value: "$19 per month", reason: "", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", review: "accepted", supportRef: null }],
  });
  const semanticInput = { ...structuredClone(QUESTION_SYNTHESIS_INPUT), language: payload.market.language };
  const sourceSummary: GeoSourceSummaryV2 = { gsc: { status: "available", reason: null, property: "sc-domain:example.com", window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: 3, truncated: false, observedAt: "2026-08-31T00:00:00.000Z" }, selectedEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 } };
  return { candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, baseDraftVersion: 7, payload, semanticInput, semanticOutput: structuredClone(QUESTION_SYNTHESIS_OUTPUT), sourceReceiptRefs: [], evidenceCatalog: structuredClone(semanticInput.evidenceSources), sourceSummary };
}

function expectedRegistryProjection(input: Pick<ReturnType<typeof fixture>, "payload">): GeoKbPayload {
  const parsed = parseGeoKbPayload({ ...input.payload, schemaVersion: "marketing-geo-kb.v1", facts: [], roles: [{ id: "finance", label: "finance managers", segment: input.payload.roles[0]!.segment, painPoints: ["manual invoice reminders"], decisionCriteria: ["audit trails"], vocabulary: ["overdue invoices"] }] });
  if (!parsed.ok) throw new Error("Invalid independent registry fixture");
  return parsed.value;
}

describe("server-owned prepared GEO knowledge assembly", () => {
  it("freezes failed competitor extraction metadata without changing the saved mapping", () => {
    const input = fixture(), receiptId = "11111111-1111-4111-8111-111111111118", contentHash = "c".repeat(64);
    const capture = extractGeoCompetitorSourceV2("rival.example", { kind: "unavailable", url: "https://rival.example/", reason: "fetch_failed" }, "C1");
    const competitorEvidence = [{ receiptId, contentHash, receiptCreatedAt: "2026-08-31T00:00:00.000Z", capture }];
    const payload = parseGeoKbPayloadV2({ ...input.payload, competitors: [{ domain: "rival.example", brandName: "Manual Rival", confirmed: true }] });
    const value = buildGeoPreparedKnowledgeBase({ ...input, payload, sourceReceiptRefs: [{ receiptId, contentHash }], competitorEvidence });
    expect(value.context.competitorEvidence).toEqual(competitorEvidence);
    expect(parseGeoPreparedCandidate(JSON.parse(JSON.stringify(value))).context.competitorEvidence).toEqual(competitorEvidence);
    expect(value.payload.competitors).toEqual(payload.competitors);
  });
  it("seals exact saved content, source metadata and independently verifiable semantic/registry cohorts", () => {
    const input = fixture(), before = JSON.stringify(input);
    const candidate = buildGeoPreparedKnowledgeBase(input);
    expect(candidate.payload).toEqual(input.payload);
    expect(candidate.baseDraftVersion).toBe("7");
    expect(candidate.baseDraftHash).toBe(geoV2Digest(input.payload));
    expect(candidate.profileCopyHash).toBe(geoV2Digest(input.payload.profileCopy));
    expect(candidate.generatorVersion).toBe(GEO_QUESTION_SYNTHESIS_PROMPT_VERSION);
    expect(candidate.questionSet.methodVersion).toBe(GEO_QUESTION_SYNTHESIS_PROMPT_VERSION);
    expect(candidate.context.sourceSummary).toEqual(input.sourceSummary);
    expect(candidate.context.evidenceCatalog).toEqual(input.evidenceCatalog);
    expect(candidate.context.sourceReceiptRefs).toEqual(input.sourceReceiptRefs);
    expect(parseGeoPreparedCandidate(JSON.parse(JSON.stringify(candidate)))).toEqual(candidate);
    expect(JSON.stringify(input)).toBe(before);
    const semantic = candidate.questionSet.questions.filter(question => question.provenance.kind === "semantic");
    expect(semantic).toHaveLength(input.semanticOutput.questions.length);
    expect(semantic.every(question => question.id.startsWith("semantic:") && question.mode === "demand" && !question.calibrated && question.templateId === null)).toBe(true);
    expect(semantic[0]).toMatchObject({ text: input.semanticOutput.questions[0]!.text, requiredEntities: ["manual invoice reminders"], provenance: { generatorVersion: GEO_QUESTION_SYNTHESIS_PROMPT_VERSION } });
    const registry = buildGeoQuestionSet(expectedRegistryProjection(input));
    const included = candidate.questionSet.questions.filter(question => question.provenance.kind === "registry");
    expect(included.length).toBeGreaterThan(0);
    const sourceCategory = input.semanticInput.entities.find(entity => entity.kind === "category")!;
    expect(candidate.questionSet.entityCatalog.find(entity => entity.text === "invoice reminder")).toMatchObject({
      kind: "category",
      roleId: null,
      evidenceRefs: sourceCategory.evidenceRefs,
    });
    expect(included.every(question => question.mode === "retrieval" && question.calibrated)).toBe(true);
    expect(() => assertRegistryQuestionsMatch(candidate.questionSet, registry)).not.toThrow();
    for (const { provenance: _source, ...question } of included) expect(question).toEqual(registry.questions.find(original => original.id === question.id));
  });
  it("retains global calibrated evaluation probes while manual roles enable semantic pain/criteria without GSC", () => {
    const input = fixture();
    const evidence = input.evidenceCatalog.map(item => ({ ...item, kind: "manual" as const }));
    const candidate = buildGeoPreparedKnowledgeBase({ ...input, semanticInput: { ...input.semanticInput, evidenceSources: evidence }, evidenceCatalog: evidence, sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, manual: 2, crawl: 0 }, availableEvidenceCounts: { profile: 0, gsc: 0, manual: 2, crawl: 0 } } });
    expect(candidate.context.skippedLayers).toEqual([]);
    expect(candidate.context.roles[0]).toMatchObject({ source: { kind: "manual" }, eligibleLayers: ["problem", "evaluation"] });
    expect(candidate.questionSet.questions.some(question => question.provenance.kind === "registry" && question.layer === "evaluation" && question.roleId === null)).toBe(true);
  });
  it("drops only unmappable registry rows instead of inventing source entities or editing calibrated text", () => {
    const input = fixture();
    const competitors = [{ domain: "rival.example", brandName: "Rival Billing", confirmed: true }, { domain: "unused.example", brandName: "Other Billing", confirmed: true }];
    const entities = [...input.semanticInput.entities, ...competitors.map((entry, index) => ({ id: `competitor:${index}`, text: entry.brandName, kind: "competitor" as const, roleId: null, evidenceRefs: ["P1"] }))];
    const semanticOutput = { entities: [...input.semanticOutput.entities, { id: "competitor:0", text: "Rival Billing" }], questions: [...input.semanticOutput.questions, { id: "compare-rival", text: "How does Acme compare with Rival Billing?", layer: "comparison" as const, roleId: null, entityRefs: ["brand", "competitor:0"], evidenceRefs: ["P1"] }] };
    const expanded = { ...input, payload: parseGeoKbPayloadV2({ ...input.payload, competitors }), semanticInput: { ...input.semanticInput, entities }, semanticOutput };
    const candidate = buildGeoPreparedKnowledgeBase(expanded);
    const registry = buildGeoQuestionSet(expectedRegistryProjection(expanded));
    const unmappable = registry.questions.filter(question => question.calibrated && question.mode === "retrieval" && question.requiredEntities.includes("Other Billing"));
    expect(unmappable.length).toBeGreaterThan(0);
    expect(candidate.questionSet.questions.some(question => unmappable.some(skipped => skipped.id === question.id))).toBe(false);
    expect(candidate.questionSet.entityCatalog.some(entity => entity.text === "Other Billing")).toBe(false);
    expect(() => assertRegistryQuestionsMatch(candidate.questionSet, registry)).not.toThrow();
  });
  it.each(["brand", "aliases", "language", "role_wording", "missing_role", "unaccepted_role", "category", "competitor", "fact", "source_text", "source_kind", "source_missing", "model_calibration"])("refuses a detached or untrusted %s basis", (kind) => {
    const input = fixture();
    if (kind === "brand") input.semanticInput.officialName = "Other";
    if (kind === "aliases") input.semanticInput.aliases = ["Other"];
    if (kind === "language") input.semanticInput.language = "en-gb";
    if (kind === "role_wording") input.semanticInput.roles[0]!.label = "Other persona";
    if (kind === "missing_role") input.semanticInput.roles = [];
    if (kind === "unaccepted_role") input.payload = parseGeoKbPayloadV2({ ...input.payload, roles: input.payload.roles.map(role => ({ ...role, review: "pending" })) });
    if (kind === "category") input.semanticInput.entities.find(entity => entity.kind === "category")!.text = "unrelated software";
    if (kind === "competitor") input.semanticInput.entities.push({ id: "foreign-brand", text: "Foreign Company", kind: "competitor", roleId: null, evidenceRefs: ["P1"] } as never);
    if (kind === "fact") input.semanticInput.entities.find(entity => entity.kind === "fact")!.text = "$99 per month";
    if (kind === "source_text") input.evidenceCatalog[0]!.text = "Changed source";
    if (kind === "source_kind") input.evidenceCatalog[0]!.kind = "manual" as never;
    if (kind === "source_missing") input.evidenceCatalog = input.evidenceCatalog.slice(1);
    if (kind === "model_calibration") Object.assign(input.semanticOutput.questions[0]!, { calibrated: true });
    expect(() => buildGeoPreparedKnowledgeBase(input)).toThrow();
  });
  it("requires verified crawl support instead of treating a reference as proof", () => {
    const input = fixture(), receiptId = "11111111-1111-4111-8111-111111111118";
    const fact = input.payload.facts[0]!;
    const payload = parseGeoKbPayloadV2({ ...input.payload, facts: [{ ...fact, supportRef: { receiptId, evidenceId: "C1" } }] });
    const sourceReceiptRefs = [{ receiptId, contentHash: "c".repeat(64) }];
    expect(() => buildGeoPreparedKnowledgeBase({ ...input, payload, sourceReceiptRefs })).toThrow();
    const candidate = buildGeoPreparedKnowledgeBase({ ...input, payload, sourceReceiptRefs, verifiedFactSupport: [{ receiptId, evidenceId: "C1", key: fact.key, value: fact.value, sourceUrl: fact.sourceUrl, observedAt: fact.observedAt }] });
    expect(candidate.context.facts[0]).toMatchObject({ source: "crawl", value: "$19 per month", supportRef: { receiptId, evidenceId: "C1" } });
  });
  it("preserves server-resolved edits of a model role and refuses missing edit lineage", () => {
    const input = fixture();
    const payload = parseGeoKbPayloadV2({ ...input.payload, roles: input.payload.roles.map(role => ({ ...role, source: { kind: "model", generationId: "known-generation", itemId: "known-role", evidenceRefs: role.source.evidenceRefs } })) });
    expect(() => buildGeoPreparedKnowledgeBase({ ...input, payload })).toThrow();
    const candidate = buildGeoPreparedKnowledgeBase({ ...input, payload, modelRoleEdits: { finance: true } });
    expect(candidate.context.roles[0]).toMatchObject({ userEdited: true, source: { kind: "model", generationId: "known-generation", itemId: "known-role" } });
  });
  it.each([0, -1, 1.5, Number.NaN])("rejects invalid base draft revision %s", baseDraftVersion => {
    expect(() => buildGeoPreparedKnowledgeBase({ ...fixture(), baseDraftVersion })).toThrow();
  });
  it("keeps valid long model question IDs bounded and deterministic in the semantic namespace", () => {
    const input = fixture(); input.semanticOutput.questions[0]!.id = "q".repeat(128);
    const first = buildGeoPreparedKnowledgeBase(input), second = buildGeoPreparedKnowledgeBase(input);
    expect(first.questionSet.questions[0]!.id).toMatch(/^semantic:/u);
    expect(first.questionSet.questions[0]!.id.length).toBeLessThanOrEqual(128);
    expect(first).toEqual(second);
  });
  it("does not invent registry content when a translated category cannot fit its historical contract", () => {
    const input = fixture(), phrase = "invoice reminder software for finance teams with detailed collection workflows and customer follow-up requirements";
    input.semanticOutput.entities.find(entity => entity.id === "category")!.text = phrase;
    input.semanticOutput.questions.find(question => question.layer === "discovery")!.text = `Which ${phrase} is suitable?`;
    input.semanticOutput.questions.find(question => question.layer === "comparison")!.text = `How does ${phrase} compare with spreadsheets?`;
    const candidate = buildGeoPreparedKnowledgeBase(input);
    expect(candidate.questionSet.registryVersion).toBe("none");
    expect(candidate.questionSet.questions.every(question => question.provenance.kind === "semantic" && !question.calibrated)).toBe(true);
    expect(candidate.payload.categoryTerms).toEqual(input.payload.categoryTerms);
  });
});
