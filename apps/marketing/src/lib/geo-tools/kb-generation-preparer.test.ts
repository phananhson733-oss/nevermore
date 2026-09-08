import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalProfileJson } from "../account-websites/contracts.ts";
import type { KeywordLlmConfig } from "../tools/keyword-llm-client.ts";
import { createGeoKbGenerationPreparer, creditGeoKnowledgeObservation, validateGeoKbDraftLineage, type GeoKbGenerationPreparerDependencies } from "./kb-generation-preparer.ts";
import { completePayloadV2, V2_KB_ID as KB, V2_CANDIDATE_ID as ID } from "./kb-v2.test-fixtures.ts";
import { createGeoProfileCopy, profileCopyReference } from "./kb-profile-copy.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import { createGeoRoleProposal, parseGeoRoleProposal, type GeoRoleProposalInput } from "./kb-role-proposal.ts";
import { prepareGeoRoleSynthesis, prepareGeoQuestionSynthesis, type GeoSynthesisResult } from "./kb-synthesis.ts";
import { ROLE_SYNTHESIS_INPUT, QUESTION_SYNTHESIS_INPUT } from "./kb-synthesis-fixtures.ts";
import type { GeoRoleSynthesisInput, GeoRoleSynthesis, GeoQuestionSynthesisInput, GeoQuestionSynthesis } from "./kb-synthesis-contract.ts";
import { geoGenerationInputHash, type GeoKbGenerationRecord } from "./kb-generation.ts";
import { buildGeoKnowledgeGenerationInputManifest, geoKnowledgeGenerationInputHash, parseGeoPreparedCandidate, parseGeoPreparedCandidateV2 } from "./kb-prepared-contract.ts";
import { finalizeGeoKbSourceReportV2, collectGeoQueryEvidenceV2, inspectGeoFactSourceV2, extractGeoCompetitorSourceV2 } from "./kb-sources.ts";
import { GEO_KB_SOURCE_SCHEMA, type GeoKbSourceReportV2 } from "./kb-source-contract.ts";
import { collectGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceReadResource, type GeoKnowledgeEvidenceSource } from "./kb-knowledge-evidence.ts";
import { GEO_EVIDENCE_OBSERVATION_SCHEMA_VERSION, type GeoEvidenceObservation } from "./kb-evidence-observations.ts";
import { prepareGeoKnowledgeSynthesis, type GeoKnowledgeSynthesisResult } from "./kb-knowledge-synthesis.ts";
import { buildGeoKnowledgeSynthesisInputV1, type GeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
import { buildGeoKnowledgeGenerationResultV1, parseGeoKnowledgeGenerationResultV1 } from "./kb-knowledge-generation-contract.ts";
import { completePayloadV3, V3_KB_ID, V3_TARGET_URL } from "./kb-v3.test-fixtures.ts";
import { geoGenerationInputHashV3 } from "./kb-prepared-v3-contract.ts";
import { parseGeoKnowledgeGenerationResultV2, type GeoKnowledgeNarrativeV2, type GeoKnowledgeSynthesisInputV2 } from "./kb-knowledge-synthesis-v2-contract.ts";
import { prepareGeoKnowledgeSynthesisV2, type GeoKnowledgeSynthesisV2Result } from "./kb-knowledge-synthesis-v2.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { buildGeoPreparedKnowledgeBase } from "./kb-preparation.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const CONFIG: KeywordLlmConfig = { apiKey: "offline-private-key", model: "offline-model", url: "https://provider.example/complete?private=offline-url-secret", authScheme: "api-key", temperature: 0.4 };
function payload() {
  const base = completePayloadV2();
  const profile = { ...base.profileCopy.profile, valueProposition: "Acme helps finance teams reduce late invoices and evaluate setup effort.", coreFeatures: ["invoice reminders"] };
  const copy = createGeoProfileCopy({ ...profileCopyReference(base.profileCopy), profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") }, profile);
  return { ...base, profileCopy: copy };
}
function roleOutput(input: GeoRoleSynthesisInput): GeoRoleSynthesis {
  const source = input.sources.find((entry) => entry.id.endsWith(":valueProposition")) ?? input.sources[0]!;
  return { roles: [{ id: "finance", label: "Finance teams", questionLabel: "finance teams", segment: "Teams handling invoices", painPoints: ["late invoices"], alternatives: ["spreadsheets"], decisionCriteria: ["setup effort"], vocabulary: ["receivables"], evidenceRefs: [source.id] }], categoryTerms: [{ text: "analytics", evidenceRefs: [source.id] }] };
}
function questionOutput(input: GeoQuestionSynthesisInput): GeoQuestionSynthesis {
  const chosen = (kind: GeoQuestionSynthesisInput["entities"][number]["kind"]) => input.entities.find((entity) => entity.kind === kind)!;
  const question = (id: string, text: string, layer: GeoQuestionSynthesis["questions"][number]["layer"], entity: GeoQuestionSynthesisInput["entities"][number]) => ({ id, text, layer, roleId: entity.roleId, entityRefs: [entity.id], evidenceRefs: entity.evidenceRefs });
  const category = chosen("category"), brand = chosen("brand");
  return { entities: input.entities.map(({ id, text }) => ({ id, text })), questions: [
    question("discovery", `Which ${category.text} tools are available?`, "discovery", category),
    question("branded", `What is ${brand.text}?`, "branded", brand),
    ...input.roles.flatMap((role) => {
      const pain = input.entities.find((entity) => entity.roleId === role.id && entity.kind === "role_pain");
      const criterion = input.entities.find((entity) => entity.roleId === role.id && entity.kind === "role_criterion");
      const alternative = input.entities.find((entity) => entity.roleId === role.id && entity.kind === "role_alternative");
      return [...(pain ? [question(`problem-${role.id}`, `How can ${role.questionLabel} reduce ${pain.text}?`, "problem", pain)] : []), ...(criterion ? [question(`evaluation-${role.id}`, `How can ${role.questionLabel} evaluate ${criterion.text}?`, "evaluation", criterion)] : []),
        ...(alternative ? [question(`comparison-${role.id}`, `How can ${role.questionLabel} compare ${alternative.text} with available tools?`, "comparison", alternative)] : [])];
    }),
    ...input.entities.filter((entity) => entity.kind === "competitor").map((entity, index) => question(`competitor-${index}`, `How does ${entity.text} compare with available tools?`, "comparison", entity)),
  ] };
}
const usage = { inputTokens: 12, outputTokens: 34, requestCount: 1, retryCount: 0 };
function knowledgeOutput(input: GeoKnowledgeSynthesisInputV1) {
  const own = input.sourceCatalogue.find(source => source.kind === "own_page")!;
  return {
    schemaVersion: "marketing-geo-knowledge-narrative.v1" as const,
    entity: { definitions: { w25: "Acme is analytics software.", w55: "Acme is analytics software for finance teams.", w120: "Acme is analytics software that helps finance teams research reporting workflows." }, audience: { who: "Finance teams researching analytics", notFor: null }, founded: { year: null, team: null, location: null }, disambiguation: null, sourceRefs: [own.id] },
    facts: [], qa: [], comparisons: [],
    scope: { does: [{ id: "scope:analytics", text: "Supports analytics research workflows.", sourceRefs: [own.id] }], doesNot: [], needsHuman: [], misconceptions: [] },
  };
}
async function collectKnowledge(input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0], collectedAt = "2026-09-01T01:00:00.000Z") {
  const observedAt = "2026-09-01T00:00:00.000Z";
  return await collectGeoKnowledgeEvidenceV1({ targetUrl: input.targetUrl, competitors: [...input.confirmedCompetitors] }, {
    reusedSources: input.reusedSources,
    now: () => new Date(collectedAt),
    readResource: async ({ url }) => {
      if (url === input.targetUrl) return { kind: "ok", url, contentType: "text/html", observedAt, body: "<html lang=\"en\"><body><h1>Acme analytics</h1><p>Acme is analytics software for finance teams researching reporting workflows.</p></body></html>" };
      if (new URL(url).host === "rival.example") return { kind: "ok", url, contentType: "text/html", observedAt, body: "<html><body><h1>Rival analytics</h1></body></html>" };
      if (url.endsWith("/robots.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "User-agent: *\nAllow: /" };
      if (url.endsWith("/sitemap.xml")) return { kind: "ok", url, contentType: "application/xml", observedAt, body: `<urlset><url><loc>${input.targetUrl}</loc></url></urlset>` };
      if (url.endsWith("/llms.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "# Acme\nAnalytics software." };
      return { kind: "unavailable", url, reason: "not_found" };
    },
  });
}
function setup(overrides: Partial<GeoKbGenerationPreparerDependencies> = {}) {
  const value = payload(), draft = { payload: value, draftVersion: 4, contentHash: geoV2Digest(value), updatedAt: "2026-08-31T00:00:00.000Z" };
  const receipts = new Map<string, GeoKbSourceReportV2>(), generations = new Map<string, GeoKbGenerationRecord>();
  const deps: GeoKbGenerationPreparerDependencies = {
    readDetails: vi.fn(async () => ({ kind: "ok" as const, value: { kbId: KB, origin: "https://example.com", draft } })),
    validateCurrentProfileCopy: vi.fn(async () => "current" as const),
    readReceipt: vi.fn(async ({ receiptId }) => receipts.has(receiptId) ? { kind: "ok" as const, value: receipts.get(receiptId)! } : { kind: "missing" as const }),
    readGeneration: vi.fn(async ({ generationId }) => generations.has(generationId) ? { kind: "ok" as const, generation: generations.get(generationId)! } : { kind: "missing" as const }),
    resolveConfig: vi.fn(() => CONFIG),
    collectKnowledgeEvidence: vi.fn(collectKnowledge),
    now: vi.fn(() => new Date("2026-09-02T00:00:00.000Z")),
    synthesizeRoles: vi.fn(async (input: GeoRoleSynthesisInput): Promise<GeoSynthesisResult<GeoRoleSynthesis>> => {
      const prepared = prepareGeoRoleSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline role fixture");
      return { ok: true, value: roleOutput(input), provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    }),
    synthesizeQuestions: vi.fn(async (input: GeoQuestionSynthesisInput): Promise<GeoSynthesisResult<GeoQuestionSynthesis>> => {
      const prepared = prepareGeoQuestionSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline question fixture");
      return { ok: true, value: questionOutput(input), provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    }),
    synthesizeKnowledge: vi.fn(async (input: GeoKnowledgeSynthesisInputV1): Promise<GeoKnowledgeSynthesisResult> => {
      const prepared = prepareGeoKnowledgeSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline knowledge fixture");
      return { ok: true, value: knowledgeOutput(input), provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    }), ...overrides,
  };
  const request = { userId: USER, kind: "roles" as const, kbId: KB, baseVersion: 4, draftHash: draft.contentHash, idempotencyKey: "offline-prepare-1", displayLocale: "en" as const, sourceReceiptRefs: [] };
  return { deps, draft, request, receipts, generations, prepare: createGeoKbGenerationPreparer(deps) };
}
const RID = "44444444-4444-4444-8444-444444444444";
function receipt(state: ReturnType<typeof setup>, changes: Partial<GeoKbSourceReportV2> = {}) {
  const fact = state.draft.payload.facts[0]!;
  return finalizeGeoKbSourceReportV2({ schemaVersion: GEO_KB_SOURCE_SCHEMA, receiptId: RID, kbId: KB, targetHost: "example.com", draftVersion: 1, draftHash: "e".repeat(64), profileReference: profileCopyReference(state.draft.payload.profileCopy), createdAt: "2026-08-31T00:00:00.000Z", competitors: [],
    facts: [inspectGeoFactSourceV2(fact, { kind: "ok", url: fact.sourceUrl, observedAt: fact.observedAt, body: `<p>${fact.key}: ${fact.value}.</p>` }, "F1")],
    gsc: { status: "available", reason: null, property: "sc-domain:example.com", window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: 1, truncated: false, observedAt: "2026-08-31T00:00:00.000Z", queries: [...collectGeoQueryEvidenceV2(["late invoice reminders"])] }, ...changes,
  });
}
const ref = (value: GeoKbSourceReportV2) => ({ receiptId: value.receiptId, contentHash: value.contentHash });
describe("GEO generation pure preflight", () => {
  it.each(["roles", "questions"] as const)("binds the %s strict response schema separately from prompt bytes", async (kind) => {
    const state = setup(), ready = await state.prepare({ ...state.request, kind });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const prepared = kind === "roles" ? prepareGeoRoleSynthesis(ROLE_SYNTHESIS_INPUT, CONFIG) : prepareGeoQuestionSynthesis(QUESTION_SYNTHESIS_INPUT, CONFIG);
    expect(prepared.ok).toBe(true); if (!prepared.ok) return;
    expect(ready.input.responseSchemaHash).toBe(geoV2Digest(prepared.value.responseJsonSchema));
    expect(ready.input.responseSchemaHash).not.toBe(ready.input.promptHash);
    expect(geoGenerationInputHash(kind, { ...ready.input, responseSchemaHash: "0".repeat(64) })).not.toBe(geoGenerationInputHash(kind, ready.input));
  });
  it("binds owned saved data and exposes no config secrets before deferring the provider call", async () => {
    const { deps, request, prepare, draft } = setup();
    const ready = await prepare(request); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(deps.readDetails).toHaveBeenCalledWith({ userId: USER, kbId: KB });
    expect(deps.synthesizeRoles).not.toHaveBeenCalled();
    expect(ready.input).toMatchObject({ kbId: KB, baseDraftVersion: "4", baseDraftHash: draft.contentHash, profileCopyHash: geoV2Digest(draft.payload.profileCopy) });
    expect(() => geoGenerationInputHash("roles", ready.input)).not.toThrow();
    expect(JSON.stringify(ready.input)).not.toContain(CONFIG.apiKey); expect(JSON.stringify(ready.input)).not.toContain(CONFIG.url); expect(JSON.stringify(ready.input)).not.toContain("offline-url-secret");
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    const proposal = parseGeoRoleProposal(result.value);
    expect(proposal).toMatchObject({ generationId: ID, kbId: KB, baseDraftVersion: "4", baseDraftHash: draft.contentHash });
    expect(result.attempt).toMatchObject({ attemptedCalls: 1, delivery: "response_received", inputTokens: 12, outputTokens: 34, modelRequested: "offline-model" });
    expect(deps.synthesizeRoles).toHaveBeenCalledTimes(1);
  });
  it("refuses missing or stale saved identities and changed Profile copies before invocation", async () => {
    for (const [overrides, expected] of [[{ readDetails: async () => ({ kind: "missing" as const }) }, "missing"], [{ validateCurrentProfileCopy: async () => "stale" as const }, "input_stale"], [{ validateCurrentProfileCopy: async () => "unavailable" as const }, "unavailable"]] as const) {
      const state = setup(overrides); expect(await state.prepare(state.request)).toEqual({ kind: expected }); expect(state.deps.synthesizeRoles).not.toHaveBeenCalled();
    }
    const state = setup(); expect(await state.prepare({ ...state.request, baseVersion: 3 })).toEqual({ kind: "input_stale" });
    expect(await state.prepare({ ...state.request, draftHash: "f".repeat(64) })).toEqual({ kind: "input_stale" });
  });
  it("refuses unconfigured or unsupported generation without calling an adapter", async () => {
    const state = setup({ resolveConfig: () => null });
    expect(await state.prepare(state.request)).toEqual({ kind: "model_unavailable" }); expect(state.deps.synthesizeRoles).not.toHaveBeenCalled();
    const foreign = setup(); foreign.draft.payload.market = { country: "US", language: "zh" }; foreign.draft.contentHash = geoV2Digest(foreign.draft.payload);
    expect(await foreign.prepare({ ...foreign.request, draftHash: foreign.draft.contentHash })).toEqual({ kind: "unsupported_language" });
  });
  it("keeps unknown delivery and unknown usage honest without returning exception secrets", async () => {
    const state = setup({ synthesizeRoles: async () => { throw new Error(`${CONFIG.apiKey} ${CONFIG.url}`); } });
    const ready = await state.prepare(state.request); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const result = await ready.invoke(ID);
    expect(result).toMatchObject({ ok: false, reason: "outcome_unknown", delivery: "outcome_unknown", attempt: { attemptedCalls: 1, inputTokens: null, outputTokens: null, requestCount: null } });
    expect(JSON.stringify(result)).not.toContain(CONFIG.apiKey); expect(JSON.stringify(result)).not.toContain(CONFIG.url);
  });
  it("rejects untrusted model calibration without converting a received response into an unknown outcome", async () => {
    const state = setup({ synthesizeQuestions: async (input) => {
      const prepared = prepareGeoQuestionSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid fixture");
      const value = questionOutput(input); Object.assign(value.questions[0]!, { calibrated: true, mode: "retrieval" });
      return { ok: true, value, usage, provider: prepared.value.provider, attemptedCalls: 1, delivery: "response_received" };
    } });
    const ready = await state.prepare({ ...state.request, kind: "questions" }); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(await ready.invoke(ID)).toMatchObject({ ok: false, reason: "invalid_output", delivery: "response_received", attempt: { attemptedCalls: 1, inputTokens: 12, outputTokens: 34 } });
  });
});

describe("exact owned source receipts", () => {
  it("uses the pinned source receipt even after a human review changed the draft hash", async () => {
    const state = setup(), source = receipt(state); state.receipts.set(RID, source);
    const ready = await state.prepare({ ...state.request, sourceReceiptRefs: [ref(source)] }); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(state.deps.readReceipt).toHaveBeenCalledWith({ userId: USER, kbId: KB, receiptId: RID });
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    const proposal = parseGeoRoleProposal(result.value);
    expect(proposal.sourceReceiptRefs).toEqual([ref(source)]);
    expect(proposal.availableEvidenceCounts.gsc).toBe(1);
    expect(proposal.input.sources.some((source) => source.id.startsWith(`S:${RID}:G`))).toBe(true);
    expect(source.draftHash).not.toBe(state.request.draftHash);
  });
  it.each(["missing", "hash", "kb", "host", "profile"])("rejects %s receipt scope before adapter invocation", async (kind) => {
    const state = setup(); let source = receipt(state);
    if (kind === "kb") source = receipt(state, { kbId: USER });
    if (kind === "host") source = receipt(state, { targetHost: "foreign.example", gsc: { ...source.gsc, property: "sc-domain:foreign.example" } });
    if (kind === "profile") source = receipt(state, { profileReference: { ...source.profileReference!, snapshotRevision: 99 } });
    if (kind !== "missing") state.receipts.set(RID, source);
    const selected = { ...ref(source), ...(kind === "hash" ? { contentHash: "a".repeat(64) } : {}) };
    expect(await state.prepare({ ...state.request, sourceReceiptRefs: [selected] })).toEqual({ kind: "invalid_input" });
    expect(state.deps.synthesizeRoles).not.toHaveBeenCalled();
  });
  it("discloses bounded prompt selection while keeping the full receipt unchanged", async () => {
    const state = setup(), small = receipt(state);
    const source = receipt(state, { gsc: { ...small.gsc, status: "available", reason: null, property: "sc-domain:example.com", queryCount: 1000, truncated: true, observedAt: "2026-08-31T00:00:00.000Z",
      queries: [...collectGeoQueryEvidenceV2(Array.from({ length: 1000 }, (_, index) => `${String(index).padStart(4, "0")}${"界".repeat(500)}`))] } });
    state.receipts.set(RID, source);
    const ready = await state.prepare({ ...state.request, sourceReceiptRefs: [ref(source)] }); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    const proposal = parseGeoRoleProposal(result.value);
    expect(proposal.availableEvidenceCounts.gsc).toBe(1000);
    expect(proposal.selectedEvidenceCounts.gsc).toBeGreaterThan(0);
    expect(proposal.selectedEvidenceCounts.gsc).toBeLessThan(1000);
    expect(source.gsc.queries).toHaveLength(1000);
  });
});

describe("evidence-bound knowledge-pack preparation", () => {
  it("builds the exact Task 5 manifest and adapts bounded selected evidence without dispatch", async () => {
    const state = setup(), source = receipt(state); state.receipts.set(RID, source);
    const ready = await state.prepare({ ...state.request, kind: "knowledge_pack", sourceReceiptRefs: [ref(source)] });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(state.deps.synthesizeKnowledge).not.toHaveBeenCalled();
    expect(Object.keys(ready.input).sort()).toEqual(["baseDraftHash", "baseDraftVersion", "kbId", "knowledgeSynthesisInput", "profileCopyHash", "schemaVersion", "sourceReceiptRefs"]);
    expect(ready.input.sourceReceiptRefs).toEqual([ref(source)]);
    const expectedManifest = buildGeoKnowledgeGenerationInputManifest({ ...ready.input as any, knowledgeSynthesisInput: ready.input.knowledgeSynthesisInput as any });
    expect(ready.input).toEqual(expectedManifest);
    expect(geoGenerationInputHash("knowledge_pack", ready.input)).toBe(geoKnowledgeGenerationInputHash(expectedManifest));

    expect(state.deps.collectKnowledgeEvidence).toHaveBeenCalledTimes(1);
    const collected = vi.mocked(state.deps.collectKnowledgeEvidence).mock.calls[0]![0];
    expect(collected).toMatchObject({ userId: USER, kbId: KB, targetUrl: "https://example.com/", payload: state.draft.payload,
      confirmedCompetitors: [{ key: "rival.example", name: "Rival", confirmed: true }] });
    expect(collected.reusedSources).toEqual([
      expect.objectContaining({ kind: "accepted_fact", label: "Seats", url: null, observedAt: null, bodyHash: null, excerpts: ["3"] }),
      expect.objectContaining({ kind: "gsc", url: null, observedAt: source.gsc.observedAt, bodyHash: null, excerpts: ["late invoice reminders"] }),
    ]);

    const invoked = await ready.invoke(ID); expect(invoked.ok).toBe(true); if (!invoked.ok) return;
    const result = parseGeoKnowledgeGenerationResultV1(invoked.value);
    expect(result).toMatchObject({ generationId: ID, kbId: KB, manifest: expectedManifest, synthesisInput: ready.input.knowledgeSynthesisInput, generatedAt: "2026-09-02T00:00:00.000Z" });
    expect(invoked.attempt).toMatchObject({ attemptedCalls: 1, delivery: "response_received", modelRequested: CONFIG.model, inputTokens: 12, outputTokens: 34, requestCount: 1 });
    expect(state.deps.synthesizeKnowledge).toHaveBeenCalledTimes(1);
  });

  it("uses the exact crawl excerpt and caps accepted facts/GSC excerpts deterministically", async () => {
    const state = setup(), original = receipt(state);
    if (original.gsc.status !== "available") throw new Error("Expected available GSC fixture");
    const queries = collectGeoQueryEvidenceV2(Array.from({ length: 10 }, (_, index) => `exact query ${String(index)}`));
    const source = receipt(state, { gsc: { ...original.gsc, status: "available", reason: null, queryCount: 10, truncated: false, queries: [...queries] } });
    state.receipts.set(RID, source);
    const supported = state.draft.payload.facts[0]!;
    state.draft.payload.facts = [
      { ...supported, supportRef: { receiptId: RID, evidenceId: "F1" } },
      ...Array.from({ length: 9 }, (_, index) => ({ ...supported, key: `Manual ${String(index)}`, value: `value-${String(index)}`, supportRef: null })),
    ];
    state.draft.contentHash = geoV2Digest(state.draft.payload);
    const ready = await state.prepare({ ...state.request, kind: "knowledge_pack", draftHash: state.draft.contentHash, sourceReceiptRefs: [ref(source)] });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const reused = vi.mocked(state.deps.collectKnowledgeEvidence).mock.calls[0]![0].reusedSources;
    const accepted = reused.filter(item => item.kind === "accepted_fact");
    const gsc = reused.filter(item => item.kind === "gsc");
    expect(accepted).toHaveLength(8);
    expect(accepted[0]).toMatchObject({ label: supported.key, url: null, observedAt: source.facts[0]!.observedAt,
      bodyHash: source.facts[0]!.bodyHash, excerpts: [source.facts[0]!.excerpt] });
    expect(accepted[1]).toMatchObject({ label: "Manual 0", excerpts: ["value-0"], url: null, observedAt: null, bodyHash: null });
    expect(gsc).toHaveLength(1);
    expect(gsc[0]).toMatchObject({ availability: "partial", reason: "partial_body" });
    expect(gsc[0]!.excerpts).toEqual(queries.slice(0, 8).map(query => query.text));
  });

  it("keeps same-page accepted facts without suppressing the independent homepage crawl", async () => {
    const state = setup(), original = state.draft.payload.facts[0]!;
    const first = { ...original, sourceUrl: "https://example.com/", supportRef: { receiptId: RID, evidenceId: "F1" } };
    const second = { ...original, key: "Users", value: "4", sourceUrl: "https://example.com/", supportRef: { receiptId: RID, evidenceId: "F2" } };
    state.draft.payload.facts = [first, second]; state.draft.contentHash = geoV2Digest(state.draft.payload);
    const page = { kind: "ok" as const, url: "https://example.com/", observedAt: original.observedAt, body: "<p>Seats: 3.</p><p>Users: 4.</p>" };
    const source = receipt(state, { facts: [inspectGeoFactSourceV2(first, page, "F1"), inspectGeoFactSourceV2(second, page, "F2")] });
    state.receipts.set(RID, source);
    const ready = await state.prepare({ ...state.request, kind: "knowledge_pack", draftHash: state.draft.contentHash, sourceReceiptRefs: [ref(source)] });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const reused = vi.mocked(state.deps.collectKnowledgeEvidence).mock.calls[0]![0].reusedSources.filter(item => item.kind === "accepted_fact");
    expect(reused).toHaveLength(2);
    expect(reused.every(item => item.url === null)).toBe(true);
    const synthesis = ready.input.knowledgeSynthesisInput as any;
    expect(synthesis.sourceCatalogue.filter((item: any) => item.kind === "accepted_fact")).toHaveLength(2);
    expect(synthesis.sourceCatalogue.some((item: any) => item.kind === "own_page" && item.url === "https://example.com/")).toBe(true);
  });

  it("binds the v1 knowledge prompt to the saved draft's own brand identity", async () => {
    // The seed is five fields the synthesis contract types as bounded text and
    // never cross-checks: `officialName`, `aliases`, `categoryTerms`, `market`
    // and `language`. A seed naming another brand, another market or no alias
    // at all is a perfectly valid synthesis input, so the only thing standing
    // between a swapped field and a billed prompt about the wrong product is an
    // assertion that the durable input carries the draft's values.
    const state = setup(), source = receipt(state); state.receipts.set(RID, source);
    const saved = state.draft.payload;
    // The fixture has to be able to tell a swap apart, or the pins below pass
    // for a preparer that reads the wrong field.
    expect(saved.market.country).not.toBe(saved.market.language);
    expect(saved.aliases.length).toBeGreaterThan(0);
    expect(saved.categoryTerms.length).toBeGreaterThan(0);
    const ready = await state.prepare({ ...state.request, kind: "knowledge_pack", sourceReceiptRefs: [ref(source)] });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const synthesis = ready.input.knowledgeSynthesisInput as GeoKnowledgeSynthesisInputV1;
    expect(synthesis.officialName).toBe(saved.officialName);
    expect(synthesis.aliases).toEqual(saved.aliases);
    expect(synthesis.categoryTerms).toEqual(saved.categoryTerms);
    expect(synthesis.market).toBe(saved.market.country);
    expect(synthesis.language).toBe(saved.market.language);
  });
  it("still folds collection wall-clock into the knowledge-pack input hash, so two identical requests never dedupe", async () => {
    // Characterization of a defect, not approval of it. Everything the caller
    // named is byte-identical across these two attempts -- same draft version
    // and hash, same profile copy, same receipts -- and only the moment of
    // collection moves, yet the durable input hash moves with it. Neither the
    // idempotency key's hash equality nor the store's content-addressed dedupe
    // can therefore ever match a second attempt.
    //
    // The volatile bytes are `knowledgeSynthesisInput.evidenceContentHash`
    // (a digest taken over `evidence.collectedAt`) and, on a real re-crawl,
    // every `sourceCatalogue[].observedAt`. They cannot simply be dropped from
    // the hash domain: the hash domain IS the durable input, and
    // `marketing_geo_knowledge_input_valid` (20260905155607:39,68) pins that
    // input at exactly 7 keys with a 12-key `knowledgeSynthesisInput` and
    // re-derives the same hash in SQL. Making this a function of the inputs
    // alone needs a manifest v3 plus a new branch in that CHECK; flip this to
    // `toBe`/`toEqual` when that lands.
    let collections = 0;
    const state = setup({ collectKnowledgeEvidence: vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) => {
      collections += 1;
      return await collectKnowledge(input, `2026-09-01T0${String(collections)}:00:00.000Z`);
    }) });
    const source = receipt(state); state.receipts.set(RID, source);
    const request = { ...state.request, kind: "knowledge_pack" as const, sourceReceiptRefs: [ref(source)] };
    const first = await state.prepare(request), second = await state.prepare(request);
    expect(first.kind).toBe("ready"); expect(second.kind).toBe("ready");
    if (first.kind !== "ready" || second.kind !== "ready") return;
    expect({ ...first.input, knowledgeSynthesisInput: null }).toEqual({ ...second.input, knowledgeSynthesisInput: null });
    expect(geoGenerationInputHash("knowledge_pack", first.input)).not.toBe(geoGenerationInputHash("knowledge_pack", second.input));
  });

  it("names the check that rejected the model output, and carries no parser dump out with it", async () => {
    // The token is now returned to the caller, so the two halves of its
    // promise have to hold together: a check that named itself is reported,
    // and a parser that only threw its own structural dump reports nothing.
    // A zod dump is where model-authored text would otherwise ride out.
    const unknownRoles = setup({ synthesizeRoles: vi.fn(async (input: GeoRoleSynthesisInput): Promise<GeoSynthesisResult<GeoRoleSynthesis>> => {
      const prepared = prepareGeoRoleSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline role fixture");
      const output = roleOutput(input);
      return { ok: true, value: { ...output, roles: output.roles.map(role => ({ ...role, evidenceRefs: ["source-that-was-never-offered"] })) }, provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    }) });
    const readyRoles = await unknownRoles.prepare(unknownRoles.request);
    expect(readyRoles.kind).toBe("ready"); if (readyRoles.kind !== "ready") return;
    const rejectedRoles = await readyRoles.invoke(ID);
    expect(rejectedRoles.ok).toBe(false); if (rejectedRoles.ok) return;
    expect(rejectedRoles.reason).toBe("invalid_output");
    // The VALUE, not the shape. What stood here was the capture class of
    // `NAMED_REJECTION` (preparer:77) copied character for character, so it
    // asserted only that the token had come out of that regex -- and this
    // test's own name promises more than that. It survived `named.slice(0,
    // 20)`, which reports this fixture as `schema_invalid:roles`: the same
    // prefix for every roles rejection, and the opposite of naming the check.
    // The wording is the role parser's own path (`invalid(path)` in
    // kb-synthesis-contract.ts), reached because the model cited a source that
    // was never offered, and it is pinned whole because the value is the whole
    // product: an owner reading it has to be able to tell WHICH check refused
    // the call they were billed for.
    expect(rejectedRoles.rejection).toBe("schema_invalid:roles.evidenceRefs");

    const dumped = setup({ synthesizeKnowledge: vi.fn(async (input: GeoKnowledgeSynthesisInputV1): Promise<GeoKnowledgeSynthesisResult> => {
      const prepared = prepareGeoKnowledgeSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline knowledge fixture");
      // An extra key on a `.strict()` narrative: the parser answers with its
      // own structural dump, which names the model's key verbatim.
      return { ok: true, value: { ...knowledgeOutput(input), modelInventedKeyName: "leaked" } as never, provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    }) });
    const dumpedSource = receipt(dumped); dumped.receipts.set(RID, dumpedSource);
    const readyKnowledge = await dumped.prepare({ ...dumped.request, kind: "knowledge_pack", sourceReceiptRefs: [ref(dumpedSource)] });
    expect(readyKnowledge.kind).toBe("ready"); if (readyKnowledge.kind !== "ready") return;
    const rejectedKnowledge = await readyKnowledge.invoke(ID);
    expect(rejectedKnowledge.ok).toBe(false); if (rejectedKnowledge.ok) return;
    expect(rejectedKnowledge.rejection).toBe("unknown");
    expect(rejectedKnowledge.rejection).not.toContain("modelInventedKeyName");
  });

  it("rejects strict collector output that changes scope or drops selected reusable evidence", async () => {
    for (const collectKnowledgeEvidence of [
      vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) => await collectKnowledge({ ...input, targetUrl: "https://foreign.example/" })),
      vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) => await collectKnowledge({ ...input, reusedSources: [] })),
    ]) {
      const state = setup({ collectKnowledgeEvidence });
      expect(await state.prepare({ ...state.request, kind: "knowledge_pack" })).toEqual({ kind: "invalid_input" });
      expect(state.deps.synthesizeKnowledge).not.toHaveBeenCalled();
    }
  });

  it("never invokes knowledge synthesis for config, language, evidence, or preflight refusal", async () => {
    const unconfigured = setup({ resolveConfig: () => null });
    expect(await unconfigured.prepare({ ...unconfigured.request, kind: "knowledge_pack" })).toEqual({ kind: "model_unavailable" });
    expect(unconfigured.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
    expect(unconfigured.deps.synthesizeKnowledge).not.toHaveBeenCalled();

    const unsupported = setup(); unsupported.draft.payload.market = { country: "US", language: "zh" }; unsupported.draft.contentHash = geoV2Digest(unsupported.draft.payload);
    expect(await unsupported.prepare({ ...unsupported.request, kind: "knowledge_pack", draftHash: unsupported.draft.contentHash })).toEqual({ kind: "unsupported_language" });
    expect(unsupported.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
    expect(unsupported.deps.synthesizeKnowledge).not.toHaveBeenCalled();

    const noEvidence = setup({ collectKnowledgeEvidence: vi.fn(async (input) => await collectGeoKnowledgeEvidenceV1({ targetUrl: input.targetUrl, competitors: input.confirmedCompetitors }, {
      now: () => new Date("2026-09-01T01:00:00.000Z"), readResource: async ({ url }) => ({ kind: "unavailable" as const, url, reason: "not_found" as const }),
    })) });
    expect(await noEvidence.prepare({ ...noEvidence.request, kind: "knowledge_pack" })).toEqual({ kind: "invalid_input" });
    expect(noEvidence.deps.synthesizeKnowledge).not.toHaveBeenCalled();
  });

  it("maps an uncertain knowledge call once without leaking or retrying", async () => {
    const synthesizeKnowledge = vi.fn(async (input: GeoKnowledgeSynthesisInputV1): Promise<GeoKnowledgeSynthesisResult> => {
      const prepared = prepareGeoKnowledgeSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid fixture");
      return { ok: false, reason: "timeout", provider: prepared.value.provider, usage: { inputTokens: null, outputTokens: null, requestCount: 0, retryCount: 0 }, attemptedCalls: 1, delivery: "outcome_unknown" };
    });
    const state = setup({ synthesizeKnowledge });
    const ready = await state.prepare({ ...state.request, kind: "knowledge_pack" }); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(await ready.invoke(ID)).toMatchObject({ ok: false, reason: "outcome_unknown", delivery: "outcome_unknown", attempt: { attemptedCalls: 1, delivery: "outcome_unknown", modelRequested: CONFIG.model } });
    expect(synthesizeKnowledge).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rate_limited", "rate_limited"],
    ["bad_request", "provider_rejected"],
    ["schema_invalid", "invalid_output"],
  ] as const)("maps received knowledge failure %s without a repair call", async (reason, expected) => {
    const synthesizeKnowledge = vi.fn(async (input: GeoKnowledgeSynthesisInputV1): Promise<GeoKnowledgeSynthesisResult> => {
      const prepared = prepareGeoKnowledgeSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid fixture");
      return { ok: false, reason, provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    });
    const state = setup({ synthesizeKnowledge }), ready = await state.prepare({ ...state.request, kind: "knowledge_pack" });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(await ready.invoke(ID)).toMatchObject({ ok: false, reason: expected, delivery: "response_received", attempt: { attemptedCalls: 1, inputTokens: 12, outputTokens: 34 } });
    expect(synthesizeKnowledge).toHaveBeenCalledTimes(1);
  });

  it("keeps a received response invalid when the injected result clock predates evidence", async () => {
    const state = setup({ now: () => new Date("2026-08-01T00:00:00.000Z") });
    const ready = await state.prepare({ ...state.request, kind: "knowledge_pack" }); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(await ready.invoke(ID)).toMatchObject({ ok: false, reason: "invalid_output", delivery: "response_received", attempt: { attemptedCalls: 1 } });
    expect(state.deps.synthesizeKnowledge).toHaveBeenCalledTimes(1);
  });
});

async function seedKnowledgeGeneration(state: ReturnType<typeof setup>) {
  const ready = await state.prepare({ ...state.request, kind: "knowledge_pack" });
  if (ready.kind !== "ready") throw new Error(`Knowledge fixture was ${ready.kind}`);
  const generated = await ready.invoke(ID);
  if (!generated.ok) throw new Error(`Knowledge fixture failed: ${generated.reason}`);
  const record: GeoKbGenerationRecord = { generationId: ID, userId: USER, kbId: KB, kind: "knowledge_pack", inputHash: geoGenerationInputHash("knowledge_pack", ready.input), state: "succeeded", result: generated.value, errorReason: null, attempt: generated.attempt ?? null };
  state.generations.set(ID, record);
  return { ready, result: parseGeoKnowledgeGenerationResultV1(generated.value), record };
}

describe("optional knowledge generation bound to question preparation", () => {
  it("keeps questions without a knowledge ID on the original V1 candidate path", async () => {
    const state = setup(), ready = await state.prepare({ ...state.request, kind: "questions" });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const generated = await ready.invoke(ID); expect(generated.ok).toBe(true); if (!generated.ok) return;
    expect(parseGeoPreparedCandidate(generated.value).schemaVersion).toBe("marketing-geo-prepared-candidate.v1");
    expect(() => parseGeoPreparedCandidateV2(generated.value)).toThrow();
    expect(state.deps.readGeneration).not.toHaveBeenCalled();
    const explicit = setup(), explicitReady = await explicit.prepare({ ...explicit.request, kind: "questions", knowledgeGenerationId: undefined });
    expect(explicitReady.kind).toBe("ready"); if (explicitReady.kind !== "ready") return;
    const explicitGenerated = await explicitReady.invoke(ID); expect(explicitGenerated.ok).toBe(true); if (!explicitGenerated.ok) return;
    expect(canonicalGeoV2Text(explicitGenerated.value)).toBe(canonicalGeoV2Text(generated.value));
  });

  it("assembles a V2 pack only from the exact owned succeeded knowledge result", async () => {
    const state = setup(), knowledge = await seedKnowledgeGeneration(state);
    vi.mocked(state.deps.now).mockReturnValue(new Date("2026-09-03T00:00:00.000Z"));
    vi.mocked(state.deps.synthesizeQuestions!).mockClear();
    const ready = await state.prepare({ ...state.request, kind: "questions", knowledgeGenerationId: ID });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(ready.input.knowledgeGeneration).toEqual({ generationId: ID, inputHash: knowledge.record.inputHash, resultHash: knowledge.result.contentHash });
    expect(state.deps.readGeneration).toHaveBeenCalledWith({ userId: USER, kbId: KB, generationId: ID });
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
    const candidateId = "55555555-5555-4555-8555-555555555555";
    const generated = await ready.invoke(candidateId); expect(generated.ok).toBe(true); if (!generated.ok) return;
    const candidate = parseGeoPreparedCandidateV2(generated.value);
    expect(candidate).toMatchObject({ candidateId, kbId: KB, schemaVersion: "marketing-geo-prepared-candidate.v2",
      knowledgeSynthesisInput: knowledge.result.synthesisInput,
      knowledgeGeneration: { generationId: ID, inputHash: knowledge.record.inputHash, promptVersion: "geo-kb-knowledge-pack.v1" } });
    expect(candidate.knowledgePack.sourceCatalogue).toEqual(knowledge.result.evidence.sourceCatalogue);
    expect(candidate.knowledgePack.meta.generatedAt).toBe(knowledge.result.generatedAt);
    expect(state.deps.synthesizeQuestions).toHaveBeenCalledTimes(1);
  });

  it("rejects a succeeded knowledge result whose receipt set differs from question preparation", async () => {
    const state = setup(), source = receipt(state);
    state.receipts.set(RID, source);
    const knowledgeReady = await state.prepare({ ...state.request, kind: "knowledge_pack", sourceReceiptRefs: [ref(source)] });
    expect(knowledgeReady.kind).toBe("ready");
    if (knowledgeReady.kind !== "ready") return;
    const generated = await knowledgeReady.invoke(ID);
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    state.generations.set(ID, {
      generationId: ID, userId: USER, kbId: KB, kind: "knowledge_pack",
      inputHash: geoGenerationInputHash("knowledge_pack", knowledgeReady.input), state: "succeeded",
      result: generated.value, errorReason: null, attempt: generated.attempt ?? null,
    });

    expect(await state.prepare({ ...state.request, kind: "questions", knowledgeGenerationId: ID, sourceReceiptRefs: [] })).toEqual({ kind: "invalid_input" });
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
  });

  it("rejects missing, foreign, failed, malformed, wrong-hash, and stale knowledge before question dispatch", async () => {
    const missing = setup();
    expect(await missing.prepare({ ...missing.request, kind: "questions", knowledgeGenerationId: ID })).toEqual({ kind: "invalid_input" });
    expect(missing.deps.synthesizeQuestions).not.toHaveBeenCalled();

    for (const variant of ["foreign", "failed", "malformed", "hash"] as const) {
      const state = setup(), seeded = await seedKnowledgeGeneration(state);
      const changed: GeoKbGenerationRecord = variant === "foreign" ? { ...seeded.record, userId: RID }
        : variant === "failed" ? { ...seeded.record, state: "failed", result: null, errorReason: "invalid_output", attempt: null }
        : variant === "malformed" ? { ...seeded.record, result: { ...seeded.result, contentHash: "f".repeat(64) } as any }
        : { ...seeded.record, inputHash: "f".repeat(64) };
      state.generations.set(ID, changed);
      vi.mocked(state.deps.synthesizeQuestions!).mockClear();
      expect(await state.prepare({ ...state.request, kind: "questions", knowledgeGenerationId: ID })).toEqual({ kind: "invalid_input" });
      expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
    }

    const stale = setup(), seeded = await seedKnowledgeGeneration(stale);
    const { contentHash: _contentHash, ...resultBody } = seeded.result;
    const staleResult = buildGeoKnowledgeGenerationResultV1({ ...resultBody, manifest: { ...resultBody.manifest, baseDraftVersion: "3" } });
    stale.generations.set(ID, { ...seeded.record, inputHash: geoGenerationInputHash("knowledge_pack", staleResult.manifest as any), result: staleResult as any });
    vi.mocked(stale.deps.synthesizeQuestions!).mockClear();
    expect(await stale.prepare({ ...stale.request, kind: "questions", knowledgeGenerationId: ID })).toEqual({ kind: "input_stale" });
    expect(stale.deps.synthesizeQuestions).not.toHaveBeenCalled();

    const mismatched = setup(), current = await seedKnowledgeGeneration(mismatched);
    const mismatchInput = buildGeoKnowledgeSynthesisInputV1({ officialName: "Other", aliases: current.result.synthesisInput.aliases,
      categoryTerms: current.result.synthesisInput.categoryTerms, market: current.result.synthesisInput.market, language: current.result.synthesisInput.language }, current.result.evidence);
    const { contentHash: _resultHash, ...currentBody } = current.result;
    const mismatchResult = buildGeoKnowledgeGenerationResultV1({ ...currentBody, manifest: { ...currentBody.manifest, knowledgeSynthesisInput: mismatchInput },
      synthesisInput: mismatchInput, narrative: knowledgeOutput(mismatchInput) });
    mismatched.generations.set(ID, { ...current.record, inputHash: geoGenerationInputHash("knowledge_pack", mismatchResult.manifest as any), result: mismatchResult as any });
    vi.mocked(mismatched.deps.synthesizeQuestions!).mockClear();
    expect(await mismatched.prepare({ ...mismatched.request, kind: "questions", knowledgeGenerationId: ID })).toEqual({ kind: "invalid_input" });
    expect(mismatched.deps.synthesizeQuestions).not.toHaveBeenCalled();
  });
});

describe("exact prepared question content", () => {
  it("keeps distinct Profile-imported brand-only competitors without inventing domain evidence", async () => {
    const state = setup();
    state.draft.payload.competitors = [{ domain: "", brandName: "Rival Alpha", aliases: [], confirmed: false }, { domain: "", brandName: "Rival Beta", aliases: [], confirmed: false }];
    state.draft.contentHash = geoV2Digest(state.draft.payload);
    const ready = await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    const candidate = parseGeoPreparedCandidate(result.value);
    expect(candidate.payload.competitors).toEqual(state.draft.payload.competitors);
    expect(candidate.context.competitorEvidence).toEqual([]);
  });
  it.each(["available", "conflict", "unavailable"] as const)("freezes the exact %s competitor capture without rereading sources during invocation", async (status) => {
    const state = setup();
    state.draft.payload.competitors = [{ domain: "rival.example", brandName: "", aliases: [], confirmed: false }];
    state.draft.contentHash = geoV2Digest(state.draft.payload);
    const capture = extractGeoCompetitorSourceV2("rival.example", status === "unavailable"
      ? { kind: "unavailable", reason: "fetch_failed", url: "https://rival.example" }
      : { kind: "ok", url: "https://rival.example", observedAt: "2026-08-31T00:00:00.000Z", body: status === "available"
        ? '<meta property="og:site_name" content="Rival">'
        : '<meta property="og:site_name" content="Rival Alpha"><script type="application/ld+json">{"@type":"WebSite","url":"https://rival.example","name":"Rival Beta"}</script>' }, "C1");
    expect(capture.status).toBe(status);
    const source = receipt(state, { competitors: [capture] }); state.receipts.set(RID, source);
    const ready = await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash, sourceReceiptRefs: [ref(source)] });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
    expect(ready.input.sourceReceiptRefs).toEqual([ref(source)]);
    state.receipts.clear();
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    const candidate = parseGeoPreparedCandidate(result.value);
    expect(candidate.context).toMatchObject({ competitorEvidence: [{ receiptId: RID, contentHash: source.contentHash, receiptCreatedAt: source.createdAt, capture }] });
    expect(candidate.payload.competitors).toEqual(state.draft.payload.competitors);
    expect(state.deps.readReceipt).toHaveBeenCalledTimes(1);
  });
  it("selects only the newest exact requested receipt per saved competitor, including a newer failure", async () => {
    const state = setup(), newerId = "55555555-5555-4555-8555-555555555555";
    state.draft.payload.competitors = [{ domain: "rival.example", brandName: "", aliases: [], confirmed: false }]; state.draft.contentHash = geoV2Digest(state.draft.payload);
    const older = receipt(state, { competitors: [extractGeoCompetitorSourceV2("rival.example", { kind: "ok", url: "https://rival.example", observedAt: "2026-08-31T00:00:00.000Z", body: '<meta property="og:site_name" content="Rival">' }, "C1")] });
    const capture = extractGeoCompetitorSourceV2("rival.example", { kind: "unavailable", reason: "fetch_failed", url: "https://rival.example" }, "C1");
    const newer = receipt(state, { receiptId: newerId, createdAt: "2026-08-31T01:00:00.000Z", competitors: [capture] });
    const unselected = receipt(state, { receiptId: "66666666-6666-4666-8666-666666666666", createdAt: "2026-08-31T02:00:00.000Z", competitors: older.competitors });
    for (const item of [older, newer, unselected]) state.receipts.set(item.receiptId, item);
    const ready = await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash, sourceReceiptRefs: [ref(newer), ref(older)] });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(parseGeoPreparedCandidate(result.value).context).toMatchObject({ competitorEvidence: [{ receiptId: newerId, contentHash: newer.contentHash, receiptCreatedAt: newer.createdAt, capture }] });
    expect(state.deps.readReceipt).toHaveBeenCalledTimes(2);
    expect(state.deps.readReceipt).not.toHaveBeenCalledWith({ userId: USER, kbId: KB, receiptId: unselected.receiptId });
  });
  it("rejects known competitor metadata over the frozen context cap before model invocation", async () => {
    const state = setup();
    state.draft.payload.competitors = Array.from({ length: 5 }, (_, index) => ({ domain: `rival-${index}.example`, brandName: "", aliases: [], confirmed: false }));
    state.draft.contentHash = geoV2Digest(state.draft.payload);
    const captures = state.draft.payload.competitors.map(({ domain }, index) => {
      const identities = Array.from({ length: 20 }, (_, signal) => ({ "@type": "WebSite", url: `https://${domain}`, name: `${signal}${"界".repeat(195)}`,
        alternateName: Array.from({ length: 10 }, (_, alias) => `${signal}-${alias}${"界".repeat(192)}`) }));
      return extractGeoCompetitorSourceV2(domain, { kind: "ok", url: `https://${domain}`, observedAt: "2026-08-31T00:00:00.000Z", body: `<script type="application/ld+json">${JSON.stringify(identities)}</script>` }, `C${index + 1}`);
    });
    expect(captures.every(capture => capture.status === "conflict")).toBe(true);
    const source = receipt(state, { competitors: captures }); state.receipts.set(RID, source);
    expect(await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash, sourceReceiptRefs: [ref(source)] })).toEqual({ kind: "invalid_input" });
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
  });
  it("prepares accepted manual role content with null GSC and forces semantic questions uncalibrated", async () => {
    const state = setup(), ready = await state.prepare({ ...state.request, kind: "questions" });
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    const candidate = parseGeoPreparedCandidate(result.value);
    expect(candidate.payload).toEqual(state.draft.payload);
    expect(candidate.context.sourceSummary.gsc).toBeNull();
    expect(candidate.context.roles[0]?.source.evidenceRefs).toEqual(["manual:r1"]);
    expect(candidate.context.facts[0]).toMatchObject({ value: "3", source: "user_confirmed" });
    const semantic = candidate.questionSet.questions.filter((question) => question.provenance.kind === "semantic");
    expect(semantic.length).toBeGreaterThan(0);
    expect(semantic.every((question) => question.mode === "demand" && !question.calibrated && question.templateId === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(CONFIG.apiKey);
  });
  it.each(["pending", "unknown"] as const)("does not put %s facts into the model fact catalogue", async (kind) => {
    const state = setup(); state.draft.payload.facts = state.draft.payload.facts.map((fact) => kind === "pending" ? { ...fact, review: "pending" as const } : { ...fact, value: "", reason: "notPublished" as const, sourceUrl: "", observedAt: "" }); state.draft.contentHash = geoV2Digest(state.draft.payload);
    const ready = await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash });
    if (kind === "pending") { expect(ready.kind).toBe("invalid_input"); expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled(); return; }
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(parseGeoPreparedCandidate(result.value).context.facts[0]).toMatchObject({ value: null, source: "none", review: "accepted", reason: "notPublished" });
    const input = vi.mocked(state.deps.synthesizeQuestions!).mock.calls[0]![0];
    expect(input.entities.some((entity) => entity.kind === "fact")).toBe(false);
  });
  it.each([false, true])("requires exact owned crawl support before admitting a fact (tampered=%s)", async (tampered) => {
    const state = setup(), source = receipt(state); state.receipts.set(RID, source);
    state.draft.payload.facts = state.draft.payload.facts.map((fact) => ({ ...fact, value: tampered ? "999" : fact.value, supportRef: { receiptId: RID, evidenceId: "F1" } })); state.draft.contentHash = geoV2Digest(state.draft.payload);
    const ready = await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash, sourceReceiptRefs: [ref(source)] });
    if (tampered) { expect(ready.kind).toBe("invalid_input"); expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled(); return; }
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(parseGeoPreparedCandidate(result.value).context.facts[0]).toMatchObject({ source: "crawl", value: "3", supportRef: { receiptId: RID, evidenceId: "F1" } });
  });
  it("loads an accepted fact's exact immutable receipt when the UI does not resubmit its hash", async () => {
    const state = setup(), source = receipt(state); state.receipts.set(RID, source);
    state.draft.payload.facts = state.draft.payload.facts.map((fact) => ({ ...fact, supportRef: { receiptId: RID, evidenceId: "F1" } })); state.draft.contentHash = geoV2Digest(state.draft.payload);
    const ready = await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash }); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const result = await ready.invoke(ID); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(parseGeoPreparedCandidate(result.value).sourceReceiptRefs).toEqual([ref(source)]);
  });
  it("rejects unknown manual/Profile refs instead of inventing a catalogue entry", async () => {
    for (const source of [{ kind: "manual" as const, generationId: null, itemId: null, evidenceRefs: ["manual:other-role"] }, { kind: "profile" as const, generationId: null, itemId: null, evidenceRefs: ["profile:foreign:field"] }]) {
      const state = setup(); state.draft.payload.roles = state.draft.payload.roles.map((role) => ({ ...role, source })); state.draft.contentHash = geoV2Digest(state.draft.payload);
      expect((await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash })).kind).toBe("invalid_input");
      expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
    }
  });
  it.each(["missing", "foreign", "failed"] as const)("refuses a %s model proposal without downgrading the role to manual", async (kind) => {
    const state = setup(); state.draft.payload.roles = state.draft.payload.roles.map((role) => ({ ...role, source: { kind: "model", generationId: ID, itemId: "finance", evidenceRefs: ["known"] } })); state.draft.contentHash = geoV2Digest(state.draft.payload);
    if (kind !== "missing") state.generations.set(ID, { generationId: ID, userId: kind === "foreign" ? RID : USER, kbId: KB, kind: "roles", state: kind === "failed" ? "failed" : "succeeded", result: null, inputHash: "a".repeat(64), attempt: null, errorReason: kind === "failed" ? "invalid_output" : null });
    expect((await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash })).kind).toBe("invalid_input");
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
  });
  it.each(["profile", "gsc"] as const)("preserves user-edited %s model role lineage and loads the proposal's exact receipt even if not resubmitted", async (basisKind) => {
    const state = setup({ synthesizeRoles: async (input) => {
      const prepared = prepareGeoRoleSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid fixture");
      const value = roleOutput(input), evidence = input.sources.find((source) => source.kind === basisKind)!;
      return { ok: true, value: { ...value, roles: value.roles.map((role) => ({ ...role, evidenceRefs: [evidence.id] })) }, provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    } }), source = receipt(state); state.receipts.set(RID, source);
    const roles = await state.prepare({ ...state.request, sourceReceiptRefs: [ref(source)] }); expect(roles.kind).toBe("ready"); if (roles.kind !== "ready") return;
    const generated = await roles.invoke(ID); expect(generated.ok).toBe(true); if (!generated.ok) return;
    const proposal = parseGeoRoleProposal(generated.value), original = proposal.output.roles[0]!;
    state.generations.set(ID, { generationId: ID, userId: USER, kbId: KB, kind: "roles", state: "succeeded", inputHash: geoGenerationInputHash("roles", roles.input), result: generated.value, errorReason: null, attempt: generated.attempt ?? null });
    const { evidenceRefs, ...wording } = original;
    state.draft.payload.roles = [{ ...wording, label: "Reviewed finance team", review: "accepted", source: { kind: "model", generationId: ID, itemId: original.id, evidenceRefs } }];
    state.draft.draftVersion = 5; state.draft.contentHash = geoV2Digest(state.draft.payload);
    vi.mocked(state.deps.readReceipt).mockClear();
    const ready = await state.prepare({ ...state.request, kind: "questions", baseVersion: 5, draftHash: state.draft.contentHash }); expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(state.deps.readGeneration).toHaveBeenCalledWith({ userId: USER, kbId: KB, generationId: ID });
    expect(state.deps.readReceipt).toHaveBeenCalledWith({ userId: USER, kbId: KB, receiptId: RID });
    const result = await ready.invoke("55555555-5555-4555-8555-555555555555"); expect(result.ok).toBe(true); if (!result.ok) return;
    const candidate = parseGeoPreparedCandidate(result.value);
    expect(candidate.context.roles[0]).toMatchObject({ userEdited: true, source: { kind: "model", generationId: ID, evidenceRefs } });
    expect(candidate.sourceReceiptRefs).toEqual([ref(source)]);
    if (basisKind === "gsc") expect(candidate.context.sourceSummary).toMatchObject({ gsc: { status: "available", queryCount: 1 }, selectedEvidenceCounts: { gsc: 1 } });
  });
});

function adoptNewCopy(state: ReturnType<typeof setup>) {
  const old = state.draft.payload;
  const profile = { ...old.profileCopy.profile, oneLinePositioning: "A newly confirmed position" };
  const copy = createGeoProfileCopy({ ...profileCopyReference(old.profileCopy), snapshotId: "66666666-6666-4666-8666-666666666666", snapshotRevision: 2, profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") }, profile);
  state.draft.payload = { ...old, profileCopy: copy }; state.draft.contentHash = geoV2Digest(state.draft.payload);
  return old;
}
async function modelState() {
  const state = setup(), source = receipt(state); state.receipts.set(RID, source);
  const ready = await state.prepare({ ...state.request, sourceReceiptRefs: [ref(source)] }); if (ready.kind !== "ready") throw new Error("Offline proposal basis unavailable");
  const result = await ready.invoke(ID); if (!result.ok) throw new Error("Offline proposal failed");
  const proposal = parseGeoRoleProposal(result.value), { evidenceRefs, ...wording } = proposal.output.roles[0]!;
  state.generations.set(ID, { generationId: ID, userId: USER, kbId: KB, kind: "roles", state: "succeeded", inputHash: geoGenerationInputHash("roles", ready.input), result: result.value, errorReason: null, attempt: result.attempt ?? null });
  state.draft.payload.roles = [{ ...wording, review: "accepted", source: { kind: "model", generationId: ID, itemId: wording.id, evidenceRefs } }]; state.draft.contentHash = geoV2Digest(state.draft.payload);
  vi.mocked(state.deps.resolveConfig).mockClear(); vi.mocked(state.deps.synthesizeRoles!).mockClear();
  return state;
}
describe("config-free draft lineage validation", () => {
  it("saves valid manual declarations without looking up LLM settings or invoking an adapter", async () => {
    const state = setup({ resolveConfig: vi.fn(() => null) });
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload }, state.deps)).toBe("valid");
    expect(state.deps.resolveConfig).not.toHaveBeenCalled(); expect(state.deps.synthesizeRoles).not.toHaveBeenCalled();
  });
  it.each(["pending", "excluded"] as const)("keeps authentic %s old-copy model lineage saveable without making it a current preparation source", async (review) => {
    const state = await modelState(), previousPayload = adoptNewCopy(state);
    state.draft.payload.roles = state.draft.payload.roles.map((role) => ({ ...role, review, label: "Human edited original role" })); state.draft.contentHash = geoV2Digest(state.draft.payload);
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload, previousPayload }, state.deps)).toBe("valid");
    expect(state.deps.resolveConfig).not.toHaveBeenCalled(); expect(state.draft.payload.roles[0]?.source.kind).toBe("model");
    expect((await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash })).kind).toBe(review === "pending" ? "invalid_input" : "input_stale");
  });
  it("refuses accepted old-copy model roles rather than silently treating them as current", async () => {
    const state = await modelState(); adoptNewCopy(state);
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload }, state.deps)).toBe("invalid");
    expect((await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash })).kind).toBe("input_stale");
  });
  it("retains a pending old-copy fact support pointer but does not accept it as current crawl support", async () => {
    const state = setup(), source = receipt(state); state.receipts.set(RID, source); adoptNewCopy(state);
    state.draft.payload.facts = state.draft.payload.facts.map((fact) => ({ ...fact, review: "pending", supportRef: { receiptId: RID, evidenceId: "F1" } }));
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload }, state.deps)).toBe("valid");
    state.draft.payload.facts = state.draft.payload.facts.map((fact) => ({ ...fact, review: "accepted" }));
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload }, state.deps)).toBe("invalid");
  });
  it("does not let pending review launder forged model evidence references", async () => {
    const state = await modelState(); adoptNewCopy(state);
    state.draft.payload.roles = state.draft.payload.roles.map((role) => ({ ...role, review: "pending", source: { ...role.source, evidenceRefs: ["foreign-evidence"] } }));
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload }, state.deps)).toBe("invalid");
  });
  it("retains pending Profile refs only when the previous owner-read draft proves the exact old role source", async () => {
    const state = setup();
    const evidenceRefs = [`profile:${state.draft.payload.profileCopy.snapshotId}:valueProposition`];
    state.draft.payload.roles = state.draft.payload.roles.map((role) => ({ ...role, source: { kind: "profile", generationId: null, itemId: null, evidenceRefs } }));
    const previousPayload = adoptNewCopy(state);
    state.draft.payload.roles = state.draft.payload.roles.map((role) => ({ ...role, review: "pending" }));
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload, previousPayload }, state.deps)).toBe("valid");
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload }, state.deps)).toBe("invalid");
    state.draft.payload.roles = state.draft.payload.roles.map((role) => ({ ...role, source: { ...role.source, evidenceRefs: ["profile:foreign:valueProposition"] } }));
    expect(await validateGeoKbDraftLineage({ userId: USER, kbId: KB, payload: state.draft.payload, previousPayload }, state.deps)).toBe("invalid");
  });
});

/**
 * The v3 branch.
 *
 * A v3 draft carries `profileRef` instead of `profileCopy`, so every one of
 * these went through `parseAnyGeoKbPayload` -- which knows only v1 and v2 -- and
 * came back `invalid_input`. Nothing below asserts the refusal is gone in
 * general; each case names the exact thing that has to hold instead, because
 * "it returns ready now" is satisfied by a branch that authorizes a call whose
 * result can never be stored.
 */
describe("GEO v3 generation preflight", () => {
  const V3_USER = USER;
  function narrativeV3(input: GeoKnowledgeSynthesisInputV2): GeoKnowledgeNarrativeV2 {
    const own = input.sourceCatalogue.find(source => source.kind === "own_page")!;
    return {
      schemaVersion: "marketing-geo-knowledge-narrative.v2",
      entity: {
        definitions: { w25: "Acme is a chart tool.", w55: "Acme is a chart tool for astrologers.", w120: "Acme is a chart tool for astrologers and the clients they read for." },
        audience: { who: "Astrologers", notFor: null },
        founded: { year: null, team: null, location: null },
        disambiguation: null,
        sourceRefs: [own.id],
      },
      facts: [], qa: [], comparisons: [],
      scope: { does: [{ id: "scope:charts", text: "Draws charts for astrologers.", sourceRefs: [own.id] }], doesNot: [], needsHuman: [], misconceptions: [] },
    };
  }
  async function collectV3(input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0], collectedAt = "2026-09-01T01:00:00.000Z") {
    const observedAt = "2026-09-01T00:00:00.000Z";
    return await collectGeoKnowledgeEvidenceV1({ targetUrl: input.targetUrl, competitors: [...input.confirmedCompetitors] }, {
      reusedSources: input.reusedSources,
      now: () => new Date(collectedAt),
      readResource: async ({ url }) => {
        if (url === input.targetUrl) return { kind: "ok", url, contentType: "text/html", observedAt, body: "<html lang=\"en\"><body><h1>Acme</h1><p>Acme is a chart tool for astrologers and the clients they read for.</p></body></html>" };
        if (new URL(url).host === "astro.example") return { kind: "ok", url, contentType: "text/html", observedAt, body: "<html><body><h1>Astro</h1><p>Astro draws charts for astrologers too.</p></body></html>" };
        if (url.endsWith("/robots.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "User-agent: *\nAllow: /" };
        if (url.endsWith("/sitemap.xml")) return { kind: "ok", url, contentType: "application/xml", observedAt, body: `<urlset><url><loc>${input.targetUrl}</loc></url></urlset>` };
        if (url.endsWith("/llms.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "# Acme\nA chart tool." };
        return { kind: "unavailable", url, reason: "not_found" };
      },
    });
  }
  function setupV3(overrides: Partial<GeoKbGenerationPreparerDependencies> = {}, payloadOverride?: GeoKbPayloadV3) {
    const value = payloadOverride ?? completePayloadV3();
    const draft = { payload: value, draftVersion: 4, contentHash: geoV2Digest(value), updatedAt: "2026-08-31T00:00:00.000Z" };
    const deps: GeoKbGenerationPreparerDependencies = {
      readDetails: vi.fn(async () => ({ kind: "ok" as const, value: { kbId: V3_KB_ID, origin: V3_TARGET_URL, draft } })),
      // A v3 draft has no Profile copy to validate. Answering `stale` here proves
      // the v3 branch never consults this reader: if it did, every case below
      // would come back `input_stale` instead of what it asserts.
      validateCurrentProfileCopy: vi.fn(async () => "stale" as const),
      readReceipt: vi.fn(async () => ({ kind: "missing" as const })),
      readGeneration: vi.fn(async () => ({ kind: "missing" as const })),
      resolveConfig: vi.fn(() => CONFIG),
      collectKnowledgeEvidence: vi.fn(collectV3),
      now: vi.fn(() => new Date("2026-09-02T00:00:00.000Z")),
      synthesizeKnowledgeV2: vi.fn(async (input: GeoKnowledgeSynthesisInputV2): Promise<GeoKnowledgeSynthesisV2Result> => {
        const prepared = prepareGeoKnowledgeSynthesisV2(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline v3 knowledge fixture");
        return { ok: true, value: narrativeV3(input), provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
      }),
      ...overrides,
    };
    const request = { userId: V3_USER, kind: "knowledge_pack" as const, kbId: V3_KB_ID, baseVersion: 4, draftHash: draft.contentHash,
      idempotencyKey: "offline-v3-prepare-1", displayLocale: "en" as const, sourceReceiptRefs: [] };
    return { deps, draft, request, prepare: createGeoKbGenerationPreparer(deps) };
  }

  it("builds the manifest v2 the v3 SQL gate accepts: generationInputHash re-derived, no profileCopyHash", async () => {
    const state = setupV3();
    const ready = await state.prepare(state.request);
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    expect(Object.keys(ready.input).sort()).toEqual(["baseDraftHash", "baseDraftVersion", "generationInputHash", "kbId", "knowledgeSynthesisInput", "schemaVersion", "sourceReceiptRefs"]);
    expect(ready.input.schemaVersion).toBe("marketing-geo-knowledge-generation-input.v2");
    expect(ready.input.profileCopyHash).toBeUndefined();
    // Re-derived from the payload, and equal to what the draft already recorded:
    // the claim compares the input's hash with `runRef.generationInputHash`.
    expect(ready.input.generationInputHash).toBe(geoGenerationInputHashV3(state.draft.payload));
    expect(ready.input.generationInputHash).toBe(state.draft.payload.runRef.generationInputHash);
    expect((ready.input.knowledgeSynthesisInput as GeoKnowledgeSynthesisInputV2).generationInputHash).toBe(state.draft.payload.runRef.generationInputHash);
    expect(state.deps.synthesizeKnowledgeV2).not.toHaveBeenCalled();
  });

  it("binds the paid prompt to the draft's locked brand identity, field by field", async () => {
    // Nothing downstream re-checks these. `seedSchema`
    // (kb-knowledge-synthesis-v2-contract.ts) types `market` and `language` as
    // bounded label text with no enum, puts no minimum on `aliases`, and
    // `assertInputIntegrity` reads only sources, competitors and URLs; the
    // adapter gates `language` alone. So a seed that names the wrong market, or
    // drops every alias, or renames the product, produces a synthesis input
    // that parses, hashes, stores and gets billed -- and this is the only place
    // that says it must be the draft's own identity.
    const state = setupV3();
    const identity = state.draft.payload.generationInput.identity;
    // The fixture has to be able to tell a swapped field apart, or the pins
    // below are decoration: a country equal to the language, or an empty alias
    // list, is satisfied by the very mutation it is supposed to catch.
    expect(identity.market.country).not.toBe(identity.market.language);
    expect(identity.aliases.length).toBeGreaterThan(0);
    const ready = await state.prepare(state.request);
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const synthesis = ready.input.knowledgeSynthesisInput as GeoKnowledgeSynthesisInputV2;
    expect(synthesis.officialName).toBe("Acme");
    expect(synthesis.aliases).toEqual(["Acme Inc"]);
    expect(synthesis.categoryTerms).toEqual(["astrology software"]);
    expect(synthesis.market).toBe("US");
    expect(synthesis.language).toBe("en");
    expect(synthesis.profileRef).toEqual(state.draft.payload.generationInput.profileRef);
  });

  it("follows the draft when the locked identity names another brand and another market", async () => {
    // The literals above would also be satisfied by a preparer that hard-coded
    // them. This is the same six assertions against a draft that agrees with
    // the fixture on nothing, so the branch has to be reading the payload.
    const base = completePayloadV3();
    const generationInput = { ...base.generationInput, identity: { ...base.generationInput.identity,
      officialName: "Zenith Charts", aliases: ["Zenith", "ZC"], categoryTerms: ["natal chart software", "astrology reports"],
      market: { country: "GB", language: "en-gb" } } };
    const payload = { ...base, generationInput, runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput) } } as GeoKbPayloadV3;
    const state = setupV3({}, payload);
    const ready = await state.prepare(state.request);
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const synthesis = ready.input.knowledgeSynthesisInput as GeoKnowledgeSynthesisInputV2;
    expect(synthesis.officialName).toBe("Zenith Charts");
    expect(synthesis.aliases).toEqual(["Zenith", "ZC"]);
    expect(synthesis.categoryTerms).toEqual(["natal chart software", "astrology reports"]);
    expect(synthesis.market).toBe("GB");
    expect(synthesis.language).toBe("en-gb");
    expect(synthesis.profileRef).toEqual(generationInput.profileRef);
  });

  it("carries a rejection this codebase wrote in full out whole, instead of degrading it to `unknown`", async () => {
    // The third arm of `rejectionOf` (preparer:96) had no fixture anywhere.
    // Its first arm -- a check that named itself in parentheses -- and its
    // fallback -- an unrecognised message, reported as `unknown` -- are both
    // covered by "names the check that rejected the model output" above. The
    // middle one, a sentence this codebase wrote itself, was asserted only by
    // that function's doc comment: collapsing it to `return "unknown"` passes
    // every other test in this suite, and an owner reading the diagnostic for a
    // call they were billed for is left with nothing.
    //
    // Reached the way the roles case is reached -- the model cites a source
    // that was never offered -- because the v2 narrative validator answers that
    // in prose rather than with a parser dump, which is the case this arm
    // exists for. The sentence is pinned rather than shape-matched: a shape
    // match here would be `FIXED_REJECTION` copied out a second time, which is
    // the defect the roles assertion above had. It is written by
    // `assertNarrativeIntegrity` in kb-knowledge-synthesis-v2-contract.ts, so
    // rewording it there is meant to land here.
    const state = setupV3({ synthesizeKnowledgeV2: vi.fn(async (input: GeoKnowledgeSynthesisInputV2): Promise<GeoKnowledgeSynthesisV2Result> => {
      const prepared = prepareGeoKnowledgeSynthesisV2(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline v3 knowledge fixture");
      const narrative = narrativeV3(input);
      return { ok: true, value: { ...narrative, entity: { ...narrative.entity, sourceRefs: ["source-that-was-never-offered"] } },
        provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    }) });
    const ready = await state.prepare(state.request);
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const rejected = await ready.invoke(ID);
    expect(rejected.ok).toBe(false); if (rejected.ok) return;
    expect(rejected.reason).toBe("invalid_output");
    expect(rejected.rejection).not.toBe("unknown");
    expect(rejected.rejection).toBe("Unknown or unavailable source reference");
    // The control: the same fixture citing a source the catalogue really holds
    // is bought. Without it this case could be any refusal that happens to sit
    // on the v3 narrative path rather than the one it names.
    const honest = setupV3();
    const honestReady = await honest.prepare(honest.request);
    expect(honestReady.kind).toBe("ready"); if (honestReady.kind !== "ready") return;
    expect((await honestReady.invoke(ID)).ok).toBe(true);
  });

  it("produces a result v2 bound to the same locked input, and spends exactly one call", async () => {
    const state = setupV3();
    const ready = await state.prepare(state.request);
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const invoked = await ready.invoke(ID); expect(invoked.ok).toBe(true); if (!invoked.ok) return;
    const result = parseGeoKnowledgeGenerationResultV2(invoked.value);
    expect(result.schemaVersion).toBe("marketing-geo-knowledge-generation-result.v2");
    expect(result.manifest).toEqual(ready.input);
    expect(result.manifest.generationInputHash).toBe(state.draft.payload.runRef.generationInputHash);
    expect(result.generatedAt).toBe("2026-09-02T00:00:00.000Z");
    expect(invoked.attempt).toMatchObject({ attemptedCalls: 1, delivery: "response_received", modelRequested: CONFIG.model, inputTokens: 12, outputTokens: 34, requestCount: 1 });
    expect(state.deps.synthesizeKnowledgeV2).toHaveBeenCalledTimes(1);
  });

  it("hands the collector the v3 draft, only confirmed competitors, and reuses nothing", async () => {
    // The unconfirmed competitor is the point: an unconfirmed identity has not
    // been agreed to be a competitor, so it must not be crawled and must not
    // reach a prompt that compares products.
    const base = completePayloadV3();
    const generationInput = { ...base.generationInput, competitors: [...base.generationInput.competitors, { domain: "guess.example", brandName: "Guess", confirmed: false }] };
    const payload = { ...base, generationInput, runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput) } } as GeoKbPayloadV3;
    const state = setupV3({}, payload);
    expect((await state.prepare(state.request)).kind).toBe("ready");
    const collected = vi.mocked(state.deps.collectKnowledgeEvidence).mock.calls[0]![0];
    expect(collected).toMatchObject({ userId: V3_USER, kbId: V3_KB_ID, targetUrl: V3_TARGET_URL, payload: state.draft.payload });
    expect(collected.confirmedCompetitors).toEqual([{ key: "astro.example", name: "Astro", confirmed: true }]);
    // Today's behaviour, pinned -- not a statement that nothing is reusable.
    // The comment that stood here said "this path refuses receipts, so there is
    // nothing to reuse", which is true of receipts and false of the run: by the
    // time this preparer is reached, `model:knowledge` is the LAST operation of
    // an update whose `fetch` operations have already read this exact target
    // and this exact competitor into the website evidence observation library
    // (kb-run-collect-executor.ts). The empty array is what makes the next case
    // possible, and the next case measures what it costs.
    expect(collected.reusedSources).toEqual([]);
  });

  it("re-crawls what the run's collect step already fetched, and crediting it back cannot stop the second apex admission", async () => {
    /**
     * Characterization of an open defect AND of why the obvious repair does not
     * close it. Neither half is approval.
     *
     * `model:knowledge` is a ledger row of kind `model`, and inside it this
     * preparer runs a whole site collection: the target's home page, the pages
     * that page links to, robots.txt, sitemap.xml, llms.txt, and each confirmed
     * competitor's home plus one pricing/product page. Every distinct apex among
     * those opens `openCrawlGate` (kb-enrichment-deps.ts:105-118) -- the same
     * gate the run's own `fetch` operations opened for the same target and the
     * same competitors minutes earlier. So one update admits the owner's apex
     * twice against a budget of four an hour that is shared with the Profile
     * scan, seo-audit and internal-link-audit, and none of the model step's
     * admissions has a ledger row, which kb-run-plan.ts:5-9 says every
     * allowance-spending operation must have.
     *
     * The repair that looks obvious -- hand the collector what the run already
     * observed, through `reusedSources` -- is measured here, and it does not do
     * it. Reuse is applied at full strength below (both observed pages, an hour
     * old against the library's 24-hour TTL, credited without question) and the
     * target apex is fetched anyway, because robots.txt,
     * sitemap.xml and llms.txt live on that apex and the collect step never
     * observes them: `planGeoRunCollection` (kb-run-collect.ts) plans the home
     * page only, and collapses every same-apex target into ONE operation, so
     * the run's ledger cannot even represent the other three fetches.
     *
     * What reuse does change is the own-site catalogue, and not for the better:
     * the collector follows internal links only from a page it fetched itself,
     * so crediting the home page turns this fixture's three own pages into one
     * -- the shipped ceiling is eight. The competitor apex is the only thing
     * reuse genuinely buys back.
     *
     * Both halves are asserted, so a later change that makes reuse stop the
     * second admission -- or that quietly loses the own-site pages -- says so
     * here instead of being discovered in a bill.
     */
    const OBSERVED_AT = "2026-09-01T00:00:00.000Z";
    const page = (heading: string, links: readonly string[]) =>
      `<html lang="en"><body><h1>${heading}</h1>${links.map(link => `<a href="${link}">${new URL(link).pathname.slice(1)}</a>`).join("")}` +
      `<p>${heading} draws natal charts for astrologers and the clients they read for.</p></body></html>`;
    // Exactly the two rows an update's collect step writes for this draft: the
    // owner's home page and the one confirmed competitor's home page.
    const observed: readonly GeoKnowledgeEvidenceSource[] = [
      { id: "own_page:example.com/", kind: "own_page", label: "Own site page", url: V3_TARGET_URL, competitor: null,
        availability: "available", reason: null, observedAt: OBSERVED_AT, bodyHash: "a".repeat(64), excerpts: ["Acme draws natal charts for astrologers."] },
      { id: "competitor_page:astro.example/", kind: "competitor_page", label: "Competitor page", url: "https://astro.example/",
        competitor: { key: "astro.example", name: "Astro", confirmed: true },
        availability: "available", reason: null, observedAt: OBSERVED_AT, bodyHash: "b".repeat(64), excerpts: ["Astro draws natal charts for astrologers too."] },
    ];
    const run = async (reusedSources: readonly GeoKnowledgeEvidenceSource[]) => {
      const fetched: string[] = [];
      const state = setupV3({ collectKnowledgeEvidence: vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) =>
        await collectGeoKnowledgeEvidenceV1({ targetUrl: input.targetUrl, competitors: [...input.confirmedCompetitors] }, {
          // What a wired reuse seam would supply. The preparer itself still
          // hands the collector `input.reusedSources`, which is always `[]` on
          // this path -- pinned by the case above.
          reusedSources,
          now: () => new Date("2026-09-01T01:00:00.000Z"),
          readResource: async ({ url }) => {
            fetched.push(url);
            const { host, pathname } = new URL(url);
            if (pathname === "/robots.txt") return { kind: "ok", url, contentType: "text/plain", observedAt: OBSERVED_AT, body: "User-agent: *\nAllow: /" };
            if (pathname === "/sitemap.xml") return { kind: "ok", url, contentType: "application/xml", observedAt: OBSERVED_AT, body: `<urlset><url><loc>${V3_TARGET_URL}</loc></url></urlset>` };
            if (pathname === "/llms.txt") return { kind: "ok", url, contentType: "text/plain", observedAt: OBSERVED_AT, body: "# Acme\nA chart tool." };
            if (host === "example.com") return { kind: "ok", url, contentType: "text/html", observedAt: OBSERVED_AT,
              body: page(`Acme ${pathname}`, pathname === "/" ? ["https://example.com/pricing", "https://example.com/about"] : []) };
            if (host === "astro.example") return { kind: "ok", url, contentType: "text/html", observedAt: OBSERVED_AT,
              body: page(`Astro ${pathname}`, pathname === "/" ? ["https://astro.example/pricing"] : []) };
            return { kind: "unavailable", url, reason: "not_found" };
          },
        })) });
      const ready = await state.prepare(state.request);
      expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") throw new Error("Offline v3 collection fixture is unusable");
      const catalogue = (ready.input.knowledgeSynthesisInput as GeoKnowledgeSynthesisInputV2).sourceCatalogue;
      return { fetched, apexes: [...new Set(fetched.map(url => new URL(url).host))].sort(),
        ownPages: catalogue.filter(source => source.kind === "own_page").length,
        competitorPages: catalogue.filter(source => source.kind === "competitor_page").length };
    };

    // What ships today: the model step opens both apexes a second time.
    const shipped = await run([]);
    expect(shipped.apexes).toEqual(["astro.example", "example.com"]);
    expect(shipped.ownPages).toBe(3);
    expect(shipped.competitorPages).toBe(2);

    // With the run's own observations credited at full strength.
    const credited = await run(observed);
    // The owner's apex is admitted anyway -- this is the half that matters, and
    // the half a reuse patch would be assumed to have fixed.
    expect(credited.apexes).toEqual(["example.com"]);
    expect(credited.fetched).toEqual(["https://example.com/robots.txt", "https://example.com/sitemap.xml", "https://example.com/llms.txt"]);
    // And the site's own evidence is a third of what it was, because internal
    // links are only followed out of a page this collection fetched itself.
    expect(credited.ownPages).toBe(1);
    expect(credited.competitorPages).toBe(1);
  });

  it("refuses evidence collected for another target or another competitor set", async () => {
    const honest = setupV3();
    const foreignTarget = setupV3({ collectKnowledgeEvidence: vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) =>
      await collectV3({ ...input, targetUrl: "https://elsewhere.example/" })) });
    expect((await foreignTarget.prepare(foreignTarget.request)).kind).toBe("invalid_input");
    const foreignCompetitors = setupV3({ collectKnowledgeEvidence: vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) =>
      await collectV3({ ...input, confirmedCompetitors: [] })) });
    expect((await foreignCompetitors.prepare(foreignCompetitors.request)).kind).toBe("invalid_input");
    // The same collector answering honestly is accepted, so the two refusals
    // above are about the mismatch and not about the fixture being unusable.
    expect((await honest.prepare(honest.request)).kind).toBe("ready");
  });

  it("refuses a draft whose recorded generation-input hash is not the input it carries, before any crawl", async () => {
    const drifted = completePayloadV3();
    const payload = { ...drifted, runRef: { ...drifted.runRef, generationInputHash: "b".repeat(64) } } as GeoKbPayloadV3;
    const state = setupV3({}, payload);
    expect((await state.prepare(state.request)).kind).toBe("input_stale");
    expect(state.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
  });

  it("refuses v2 receipt references and the v2 candidate binding rather than ignoring them", async () => {
    const state = setupV3();
    expect((await state.prepare({ ...state.request, sourceReceiptRefs: [{ receiptId: RID, contentHash: "c".repeat(64) }] })).kind).toBe("invalid_input");
    expect((await state.prepare({ ...state.request, kind: "questions", knowledgeGenerationId: ID })).kind).toBe("invalid_input");
    expect(state.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
  });

  it.each(["roles", "questions"] as const)("refuses %s as unsupported rather than authorizing a call whose result cannot be stored", async (kind) => {
    const state = setupV3();
    expect((await state.prepare({ ...state.request, kind })).kind).toBe("unsupported_draft");
    expect(state.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
    expect(state.deps.synthesizeKnowledgeV2).not.toHaveBeenCalled();
  });

  it("says the prompt is too large instead of calling a well-formed draft malformed", async () => {
    /**
     * The two refusals ask an owner for opposite things, and until now they
     * were the same word. `prepareGeoKnowledgeSynthesisV2` admits a synthesis
     * input of up to 163,840 JSONB bytes and refuses any prompt over 131,072
     * with `input_too_large`; the gap between those two numbers is the whole
     * failure this covers. The draft below sits inside it: the v3 contract
     * accepts the payload, `buildGeoKnowledgeSynthesisInputV2` accepts the
     * input, and the adapter still refuses -- before dispatch, so nothing is
     * bought. Reported as `invalid_input`, that told the owner to hunt for a
     * broken field in a draft with none.
     *
     * The only difference between the two drafts is how many Profile subset
     * entries the locked input carries, so the refusal can only be about size.
     */
    const inflate = (each: number) => {
      const base = completePayloadV3();
      const entry = (index: number) => `${String(index).padStart(4, "0")} ${"chart preference ".repeat(30)}`.slice(0, 500);
      const list = (offset: number) => Array.from({ length: each }, (_, index) => entry(offset + index));
      const subset = { ...base.generationInput.profileRef.subset,
        coreFeatures: list(0), categories: list(1_000), qualificationSignals: list(2_000), icpInterests: list(3_000), directCompetitors: list(4_000) };
      const generationInput = { ...base.generationInput, profileRef: { ...base.generationInput.profileRef, subset } };
      return { ...base, generationInput, runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput) } } as GeoKbPayloadV3;
    };
    const large = inflate(56), small = inflate(24);
    // The draft itself is inside its own contract, budgets included, so the
    // refusal below is not the parser turning it away.
    expect(() => parseGeoKbPayloadV3(large)).not.toThrow();
    const oversized = setupV3({}, large);
    expect((await oversized.prepare(oversized.request)).kind).toBe("input_too_large");
    // The control: the identical draft with fewer entries is bought. Without
    // it, `input_too_large` here could be any refusal that happens to sit on
    // this path.
    const modest = setupV3({}, small);
    expect((await modest.prepare(modest.request)).kind).toBe("ready");
  });

  it("keeps roles and questions unsupported because neither result could be stored yet", async () => {
    /**
     * The refusal above is not a preference, and this names what has to land
     * before it can be lifted. Both halves are pinned in both directions, so a
     * contract that grows the missing shape turns this red and sends whoever
     * lands it back to `prepareGeoKbV3Generation`.
     *
     *   roles     `createGeoRoleProposal` is the only writer of
     *             `marketing-geo-role-proposal.v1`, and its schema requires a
     *             `profileCopyHash`. The v3 roles branch of
     *             `marketing_geo_finish_generation`
     *             (20260907143000_geo_kb_v3.sql) requires the result's
     *             `profileCopyHash` to be exactly as absent as the input's, and
     *             a v3 input carries `generationInputHash` instead -- that
     *             migration's own integration test pins the refusal ("still
     *             rejects a roles result that invents a profileCopyHash the
     *             input never had"). So every proposal this builder can make is
     *             refused at finish, after the call has been paid for.
     *   questions `buildGeoPreparedKnowledgeBase` (kb-preparation.ts) is the
     *             only producer of a `marketing-geo-question-set.v2` -- the one
     *             shape the v3 questions finish branch and the publish path
     *             read -- and its first act is to parse its payload as v2.
     */
    const state = setup();
    const ready = await state.prepare(state.request);
    expect(ready.kind).toBe("ready"); if (ready.kind !== "ready") return;
    const invoked = await ready.invoke(ID);
    expect(invoked.ok).toBe(true); if (!invoked.ok) return;
    const { profileCopyHash, contentHash: _contentHash, promptVersion: _promptVersion, schemaVersion: _schemaVersion, ...body } =
      invoked.value as unknown as Record<string, unknown>;
    expect(typeof profileCopyHash).toBe("string");
    // One field, both directions: with it the builder accepts, without it the
    // builder names the field it is missing.
    expect(() => createGeoRoleProposal({ ...body, profileCopyHash } as unknown as GeoRoleProposalInput)).not.toThrow();
    expect(() => createGeoRoleProposal(body as unknown as GeoRoleProposalInput)).toThrow(/profileCopyHash/u);
    // The questions half, against the producer rather than against a v2
    // parser. `expect(() => parseGeoKbPayloadV2(completePayloadV3())).toThrow()`
    // stood here and could never have gone red: a v2 parser refusing a v3
    // payload is what a v2 parser IS, and it keeps refusing one after
    // `buildGeoPreparedKnowledgeBase` learns v3 -- which is the landing this
    // test claims to detect. (Its companion, re-parsing `completePayloadV2()`
    // -- a value `parseGeoKbPayloadV2` itself produced -- asserted nothing at
    // all.) The two calls below are the same builder with the same stub and
    // only the payload changed, so the messages have to differ for a reason
    // that is the payload gate: with a v2 payload execution reaches the NEXT
    // gate and says so. Teach the builder v3 and both calls report "Invalid
    // semantic input", turning the first assertion red.
    const stub = { candidateId: ID, kbId: KB, baseDraftVersion: 1, semanticInput: {}, semanticOutput: {},
      sourceReceiptRefs: [], evidenceCatalog: [], sourceSummary: {}, modelRoleEdits: [], verifiedFactSupport: [], competitorEvidence: [] };
    expect(() => buildGeoPreparedKnowledgeBase({ ...stub, payload: completePayloadV3() } as never)).toThrow(/Invalid Profile copy/u);
    expect(() => buildGeoPreparedKnowledgeBase({ ...stub, payload: completePayloadV2() } as never)).toThrow(/Invalid semantic input/u);
  });

  it("keeps the adapters' own not_configured refusal unreachable behind the preflight config gate", async () => {
    /**
     * `preparationRefusal("not_configured") -> model_unavailable`
     * (kb-generation-preparer.ts:366) has never executed in any suite, and
     * cannot: every call site has already refused an unusable config with the
     * same predicate the adapter uses, and every call passes the adapter's own
     * default timeout. An owner's `model_unavailable` therefore always comes
     * from the preflight gate (lines 437 and 514), never from this helper.
     *
     * That is only true while each adapter's default timeout stays inside the
     * window that adapter enforces, and nothing else would notice it moving.
     * An adapter whose default drifts out of range answers `not_configured`
     * for a config that is perfectly good, so every generation of that kind
     * would report `model_unavailable` while a model IS configured -- a lie
     * that costs an owner the feature and points them at the wrong fix.
     *
     * Each pair is: the default (must be accepted) and an explicit
     * out-of-window value (must be refused). The second half is what keeps the
     * first from being decoration -- without it, an adapter that had lost its
     * timeout check entirely would still pass.
     */
    const v2 = setup(); const knowledgeV1 = await v2.prepare({ ...v2.request, kind: "knowledge_pack" });
    expect(knowledgeV1.kind).toBe("ready"); if (knowledgeV1.kind !== "ready") return;
    const v3 = setupV3(); const knowledgeV2 = await v3.prepare(v3.request);
    expect(knowledgeV2.kind).toBe("ready"); if (knowledgeV2.kind !== "ready") return;
    const adapters = [
      ["roles", (timeoutMs?: number) => prepareGeoRoleSynthesis(ROLE_SYNTHESIS_INPUT, CONFIG, timeoutMs)],
      ["questions", (timeoutMs?: number) => prepareGeoQuestionSynthesis(QUESTION_SYNTHESIS_INPUT, CONFIG, timeoutMs)],
      ["knowledge v1", (timeoutMs?: number) => prepareGeoKnowledgeSynthesis(knowledgeV1.input.knowledgeSynthesisInput, CONFIG, timeoutMs)],
      ["knowledge v2", (timeoutMs?: number) => prepareGeoKnowledgeSynthesisV2(knowledgeV2.input.knowledgeSynthesisInput, CONFIG, timeoutMs)],
    ] as const;
    for (const [name, prepareWith] of adapters) {
      expect({ name, ...prepareWith() }).toMatchObject({ name, ok: true });
      expect({ name, ...prepareWith(130_000) }).toMatchObject({ name, ok: false, reason: "not_configured" });
    }
  });

  it("answers model_unavailable when the v3 config lookup itself throws, before the crawl", async () => {
    // The v3 twin of the v1/v2 case: `resolveConfig` throwing is neither a
    // store outage nor a malformed draft, and this arm (preparer:436) had
    // never run.
    const state = setupV3({ resolveConfig: vi.fn(() => { throw new Error("offline configuration lookup failed"); }) });
    expect(await state.prepare(state.request)).toEqual({ kind: "model_unavailable" });
    expect(state.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
    expect(state.deps.synthesizeKnowledgeV2).not.toHaveBeenCalled();
  });

  it("refuses before spending the shared crawl budget when no model is configured", async () => {
    const state = setupV3({ resolveConfig: vi.fn(() => null) });
    expect((await state.prepare(state.request)).kind).toBe("model_unavailable");
    expect(state.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
  });

  it("refuses a language the generation contract does not support, before the crawl", async () => {
    const base = completePayloadV3();
    const generationInput = { ...base.generationInput, identity: { ...base.generationInput.identity, market: { country: "US", language: "xx" } } };
    const payload = { ...base, generationInput, runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput) } } as GeoKbPayloadV3;
    const state = setupV3({}, payload);
    expect((await state.prepare(state.request)).kind).toBe("unsupported_language");
    expect(state.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
  });

  it("refuses a draft whose target host is not the knowledge base's own site", async () => {
    const state = setupV3();
    const foreign = createGeoKbGenerationPreparer({ ...state.deps,
      readDetails: vi.fn(async () => ({ kind: "ok" as const, value: { kbId: V3_KB_ID, origin: "https://other.example", draft: state.draft } })) });
    expect((await foreign(state.request)).kind).toBe("unavailable");
  });

  it("still folds collection wall-clock into the v3 knowledge input hash, exactly as the v1 path does", async () => {
    // The twin of the v1 characterization above, and for the same reason: it
    // records a defect rather than approving it. `knowledgeSynthesisInput`
    // carries `evidenceContentHash` (a digest over `evidence.collectedAt`) and
    // every `sourceCatalogue[].observedAt`, so two attempts that name the same
    // draft, the same locked generation input and the same Profile snapshot
    // still mint different input hashes and are billed twice.
    //
    // It cannot be closed by normalising the clocks: `assertEvidenceIntegrity`
    // requires `observedAt <= collectedAt` and a v2 result requires
    // `generatedAt >= collectedAt`, so flattening them would make the evidence
    // claim observation times nothing observed. Closing it needs a manifest v3
    // and a new branch in `marketing_geo_knowledge_input_valid`; flip this to
    // `toBe` when that lands.
    let collections = 0;
    const state = setupV3({ collectKnowledgeEvidence: vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) => {
      collections += 1;
      return await collectV3(input, `2026-09-01T0${String(collections)}:00:00.000Z`);
    }) });
    const first = await state.prepare(state.request), second = await state.prepare(state.request);
    expect(first.kind).toBe("ready"); expect(second.kind).toBe("ready");
    if (first.kind !== "ready" || second.kind !== "ready") return;
    expect({ ...first.input, knowledgeSynthesisInput: null }).toEqual({ ...second.input, knowledgeSynthesisInput: null });
    expect(geoGenerationInputHash("knowledge_pack", first.input)).not.toBe(geoGenerationInputHash("knowledge_pack", second.input));
  });
});

/**
 * Which refusal `preparationRefusal` (kb-generation-preparer.ts:365) can be
 * asked for, at each of its four call sites.
 *
 * Measured over the whole reachable suite, the helper ran exactly twice: the
 * roles call site once with `unsupported_language`, the v3 knowledge call site
 * once with `input_too_large`. Two of its four arms and two of its four call
 * sites had never executed, so nothing said whether the two named reasons had
 * started shadowing the fallback they were carved out of.
 *
 * The reason space is narrower than the helper's signature suggests. Two of its
 * arms are unreachable through the preparer, and they are named here rather
 * than given coverage that could only be manufactured:
 *
 *   `not_configured` -- every call site has already refused an unusable config
 *   with the SAME predicate the adapter uses (`isUsableGeoSynthesisConfig`, at
 *   preparer lines 437 and 514), and every call passes the adapter's own
 *   default timeout, which is inside the window that adapter enforces. So an
 *   owner's `model_unavailable` comes from the preflight gate, never from here.
 *   This is a guarded branch, not an impossible one: give any call site an
 *   out-of-window timeout and it fires immediately, which is why the timeouts
 *   are pinned by "keeps the adapters' own not_configured refusal unreachable
 *   behind the preflight config gate" in the v3 block above.
 *
 *   the `invalid_input` fallback -- each adapter's input parse has already been
 *   performed by the builder that produced its argument:
 *   `buildGeoRoleSynthesisBasis` and `buildGeoQuestionSynthesisBasis` call
 *   `parseGeoRoleSynthesisInput`/`parseGeoQuestionSynthesisInput` on what they
 *   return, and `buildGeoKnowledgeSynthesisInputV1`/`V2` run every check their
 *   own parser runs. A builder that refuses THROWS, and the preparer's catch
 *   answers `invalid_input` without consulting this helper. Nothing here can
 *   pin that; it is a claim about four other modules, recorded so the next
 *   reader does not mistake the zero for a missing test.
 *
 * What is left is `unsupported_language` and `input_too_large`, and both are
 * covered below at a call site that had never run.
 */
describe("preflight refusal reasons at each call site", () => {
  it("names an unsupported language at the question call site, which no test had reached", async () => {
    // The knowledge path is refused at preparer:510 before its adapter is
    // built, and the roles path is already covered. Questions is the one call
    // site where the language reaches the adapter, and its refusal had never
    // been executed.
    const state = setup();
    state.draft.payload.market = { country: "US", language: "zh" };
    state.draft.contentHash = geoV2Digest(state.draft.payload);
    expect(await state.prepare({ ...state.request, kind: "questions", draftHash: state.draft.contentHash })).toEqual({ kind: "unsupported_language" });
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
    // The control: the same draft in a supported language is bought. Without
    // it, `unsupported_language` here could be any refusal that happens to sit
    // on the question path -- and this fixture edits the draft, which is
    // exactly how a case dies at an earlier gate and still reads as a pass.
    const supported = setup();
    expect((await supported.prepare({ ...supported.request, kind: "questions" })).kind).toBe("ready");
  });

  /**
   * The v1 knowledge call site, and the v1 twin of the v3 case above.
   *
   * `parseGeoKnowledgeSynthesisInputV1` admits a synthesis input of up to
   * 163,840 JSONB bytes; `prepareGeoKnowledgeSynthesis` refuses any prompt over
   * 131,072 with `input_too_large`. Every draft below sits inside that gap:
   * the payload parses, the collector's evidence parses,
   * `buildGeoKnowledgeSynthesisInputV1` accepts the input, and the adapter
   * still refuses -- before dispatch, so no model call is bought.
   *
   * The only difference between the two runs is how many own-site pages the
   * home page links to, so the refusal can only be about size.
   */
  const OWN_INTENTS = ["about", "pricing", "product", "integrations"] as const;
  const RIVALS = ["rival.example", "beta.example", "gamma.example", "delta.example", "omega.example"] as const;
  function wideEvidenceState(ownPages: number) {
    const body = (seed: string, links: readonly string[]) => {
      const paragraphs = Array.from({ length: 10 }, (_, index) =>
        `<p>${seed} paragraph ${String(index)} ${`${seed} detailed analytics reporting workflow narrative sentence `.repeat(24)}</p>`).join("");
      return `<html lang="en"><body><h1>${seed} analytics</h1>${links.map(link => `<a href="https://${link}">${link.split("/")[1] ?? ""}</a>`).join("")}${paragraphs}</body></html>`;
    };
    const base = completePayloadV2();
    const value = parseGeoKbPayloadV2({ ...base, competitors: RIVALS.map((domain, index) => ({ domain, brandName: `Rival${String(index)}`, aliases: [], confirmed: true })) });
    const draft = { payload: value, draftVersion: 4, contentHash: geoV2Digest(value), updatedAt: "2026-08-31T00:00:00.000Z" };
    const state = setup({
      readDetails: vi.fn(async () => ({ kind: "ok" as const, value: { kbId: KB, origin: "https://example.com", draft } })),
      collectKnowledgeEvidence: vi.fn(async (input: Parameters<GeoKbGenerationPreparerDependencies["collectKnowledgeEvidence"]>[0]) =>
        await collectGeoKnowledgeEvidenceV1({ targetUrl: input.targetUrl, competitors: [...input.confirmedCompetitors] }, {
          reusedSources: input.reusedSources,
          now: () => new Date("2026-09-01T01:00:00.000Z"),
          readResource: async ({ url }) => {
            const observedAt = "2026-09-01T00:00:00.000Z";
            const host = new URL(url).host, path = new URL(url).pathname;
            if (url === input.targetUrl) return { kind: "ok", url, contentType: "text/html", observedAt, body: body("Acme", OWN_INTENTS.slice(0, ownPages).map(intent => `example.com/${intent}`)) };
            if (host === "example.com") return { kind: "ok", url, contentType: "text/html", observedAt, body: body(`Acme ${path}`, []) };
            if (RIVALS.includes(host as typeof RIVALS[number])) return { kind: "ok", url, contentType: "text/html", observedAt, body: body(`${host}${path}`, [`${host}/pricing`]) };
            if (url.endsWith("/robots.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "User-agent: *\nAllow: /" };
            if (url.endsWith("/sitemap.xml")) return { kind: "ok", url, contentType: "application/xml", observedAt, body: `<urlset><url><loc>${input.targetUrl}</loc></url></urlset>` };
            if (url.endsWith("/llms.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "# Acme\nAnalytics software." };
            return { kind: "unavailable", url, reason: "not_found" };
          },
        })),
    });
    return { state, draft, request: { ...state.request, kind: "knowledge_pack" as const, draftHash: draft.contentHash } };
  }

  it("says the v1 knowledge prompt is too large instead of calling a well-formed draft malformed", async () => {
    const oversized = wideEvidenceState(4);
    expect((await oversized.state.prepare(oversized.request)).kind).toBe("input_too_large");
    // The draft is inside its own contract, so the refusal is not the payload
    // parser turning it away.
    expect(() => parseGeoKbPayloadV2(oversized.draft.payload)).not.toThrow();
    // The refusal is downstream of collection -- the shared crawl budget is
    // spent and only then is the prompt refused -- and upstream of the model,
    // so nothing is bought. Both halves matter: an `input_too_large` decided
    // before the crawl would be a different (cheaper) product, and one decided
    // after the call would be a lie about spending.
    expect(oversized.state.deps.collectKnowledgeEvidence).toHaveBeenCalledTimes(1);
    expect(oversized.state.deps.synthesizeKnowledge).not.toHaveBeenCalled();
    // The control: the identical fixture whose home page links fewer own pages
    // is bought. Without it, `input_too_large` above could be any refusal that
    // happens to sit on this path. The crossing is between two and three linked
    // pages; one and four are used so neither side sits on the boundary, and the
    // measured margins are about 12 KB under and 14 KB over the 131,072-byte
    // prompt ceiling.
    const modest = wideEvidenceState(1);
    expect((await modest.state.prepare(modest.request)).kind).toBe("ready");
  });

  it("answers model_unavailable when the config lookup itself throws, without reaching an adapter", async () => {
    // `resolveConfig` reads deployment configuration. A lookup that throws is
    // not a store outage and not a malformed draft, and neither of the two
    // `catch` arms that decide this (preparer lines 436 and 513) had ever run.
    const state = setup({ resolveConfig: vi.fn(() => { throw new Error("offline configuration lookup failed"); }) });
    for (const kind of ["roles", "questions", "knowledge_pack"] as const) {
      expect(await state.prepare({ ...state.request, kind })).toEqual({ kind: "model_unavailable" });
    }
    expect(state.deps.collectKnowledgeEvidence).not.toHaveBeenCalled();
    expect(state.deps.synthesizeRoles).not.toHaveBeenCalled();
    expect(state.deps.synthesizeQuestions).not.toHaveBeenCalled();
    expect(state.deps.synthesizeKnowledge).not.toHaveBeenCalled();
    // A non-null config the preflight predicate rejects is the same answer, and
    // it is the OTHER arm of the same gate: `resolveConfig: () => null` (the
    // case already covered elsewhere) never exercises the predicate on a real
    // object.
    const unusable = setup({ resolveConfig: vi.fn(() => ({ ...CONFIG, url: "http://provider.example/complete" })) });
    expect(await unusable.prepare(unusable.request)).toEqual({ kind: "model_unavailable" });
    expect(unusable.deps.synthesizeRoles).not.toHaveBeenCalled();
  });
});

/**
 * Turning an observation the update already filed into evidence the collector
 * will take instead of fetching.
 *
 * The rule these hold is one-directional: this may refuse an observation the
 * collector would have accepted (that costs one fetch), and it may NEVER hand
 * over a source the collector refuses -- `validateReusedSources` throws on a
 * malformed one, the collection throws with it, and the preparer reports an
 * outage that never settles. So every case below that expects `reuse` also puts
 * the source through the real collector.
 */
describe("crediting a stored observation instead of re-reading the page", () => {
  const HOME = "https://example.com/", RIVAL = "https://astro.example/";
  const NOW = new Date("2026-09-02T00:00:00.000Z");
  const BODY_HASH = "d".repeat(64);
  const ASTRO = { key: "astro.example", name: "Astro", confirmed: true } as const;

  const observation = (overrides: Partial<GeoEvidenceObservation> = {}): GeoEvidenceObservation => ({
    schemaVersion: GEO_EVIDENCE_OBSERVATION_SCHEMA_VERSION, observationId: ID, websiteId: V3_KB_ID,
    kind: "own_page", url: HOME, observedAt: "2026-09-01T23:00:00.000Z", independence: null,
    status: { kind: "ok", bodyHash: BODY_HASH, excerpts: ["Acme sells analytics software"], structured: {} },
    ...overrides,
  });

  const page = (host: string) => `<html><head><title>${host}</title></head><body><h1>Analytics software</h1><a href="https://${host}/pricing">Pricing</a></body></html>`;
  function siteReader() {
    return vi.fn<GeoKnowledgeEvidenceReadResource>(async ({ url }) => {
      const observedAt = NOW.toISOString();
      if (url.endsWith("/robots.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "User-agent: *\nAllow: /" };
      if (url.endsWith("/sitemap.xml")) return { kind: "ok", url, contentType: "application/xml", observedAt, body: "<urlset><url><loc>https://example.com/</loc></url></urlset>" };
      if (url.endsWith("/llms.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "# Acme" };
      return { kind: "ok", url, contentType: "text/html", observedAt, body: page(new URL(url).host) };
    });
  }
  const collect = async (readResource: GeoKnowledgeEvidenceReadResource, reusedSources: readonly GeoKnowledgeEvidenceSource[] = []) =>
    await collectGeoKnowledgeEvidenceV1({ targetUrl: HOME, competitors: [{ ...ASTRO }] }, { readResource, reusedSources, now: () => NOW });

  it("mints the same source identity the collector itself would mint for that page", async () => {
    // Compared with what the REAL collector produced for the same page, not
    // with a constant written here: `sourceId` is private to that module, and
    // a plausible-looking id would put two entries for one page into a
    // catalogue that dedupes on id before it dedupes on URL.
    const collected = await collect(siteReader());
    const credit = creditGeoKnowledgeObservation({ kind: "own_page", url: HOME, competitor: null, observation: observation(), now: NOW });
    expect(credit.kind).toBe("reuse");
    if (credit.kind !== "reuse") return;
    expect(credit.source.id).toBe(collected.sourceCatalogue.find(source => source.url === HOME)!.id);
  });

  it("builds a source the real collector accepts in place of the fetch", async () => {
    const credit = creditGeoKnowledgeObservation({ kind: "own_page", url: HOME, competitor: null, observation: observation(), now: NOW });
    if (credit.kind !== "reuse") throw new Error("Expected a reusable source");
    const reader = siteReader();
    const evidence = await collect(reader, [credit.source]);

    expect(reader.mock.calls.map(([request]) => request.url)).not.toContain(HOME);
    expect(evidence.sourceCatalogue).toContainEqual(credit.source);
    // The competitor was not credited, so it is still read: reuse is decided
    // per target and never per collection.
    expect(reader.mock.calls.map(([request]) => request.url)).toContain(RIVAL);
  });

  it("keeps the observation's instant, and normalises the form Postgres hands back", async () => {
    // `timestamptz` comes back as `+00:00` where the producer wrote `Z`, and
    // the evidence contract compares the exact string. Left alone, every
    // reused source read back from the database would be refused -- and a
    // refused reused source is a thrown collection, not a missed reuse.
    const credit = creditGeoKnowledgeObservation({ kind: "own_page", url: HOME, competitor: null,
      observation: observation({ observedAt: "2026-09-01 23:00:00+00" }), now: NOW });
    if (credit.kind !== "reuse") throw new Error("Expected a reusable source");
    expect(credit.source.observedAt).toBe("2026-09-01T23:00:00.000Z");
    const evidence = await collect(siteReader(), [credit.source]);
    expect(evidence.sourceCatalogue).toContainEqual(credit.source);
  });

  it("credits a competitor page only under the identity the draft confirmed", async () => {
    const rival = observation({ kind: "competitor_page", url: RIVAL });
    const credit = creditGeoKnowledgeObservation({ kind: "competitor_page", url: RIVAL, competitor: { ...ASTRO }, observation: rival, now: NOW });
    if (credit.kind !== "reuse") throw new Error("Expected a reusable source");
    expect(credit.source).toMatchObject({ kind: "competitor_page", competitor: { ...ASTRO } });
    const reader = siteReader();
    await collect(reader, [credit.source]);
    expect(reader.mock.calls.map(([request]) => request.url)).not.toContain(RIVAL);
    // A page on a host the confirmed competitor does not own is not that
    // competitor's evidence, and the collector throws on one.
    expect(creditGeoKnowledgeObservation({ kind: "competitor_page", url: "https://other.example/",
      competitor: { ...ASTRO }, observation: observation({ kind: "competitor_page", url: "https://other.example/" }), now: NOW }))
      .toEqual({ kind: "fetch" });
    // A competitor page with no competitor, and an own page carrying one, are
    // both scope errors the source schema refuses.
    expect(creditGeoKnowledgeObservation({ kind: "competitor_page", url: RIVAL, competitor: null, observation: rival, now: NOW })).toEqual({ kind: "fetch" });
    expect(creditGeoKnowledgeObservation({ kind: "own_page", url: HOME, competitor: { ...ASTRO }, observation: observation(), now: NOW })).toEqual({ kind: "fetch" });
  });

  it("reports a stored failure without dressing it as a measurement", async () => {
    const credit = creditGeoKnowledgeObservation({ kind: "own_page", url: HOME, competitor: null,
      observation: observation({ status: { kind: "unavailable", reason: "not_found" } }), now: NOW });
    expect(credit).toEqual({ kind: "observed_unavailable", reason: "not_found" });
  });

  it.each([
    ["nothing was ever observed", null],
    ["the observation is exactly at its TTL", observation({ observedAt: "2026-09-01T00:00:00.000Z" })],
    ["the observation is older than its TTL", observation({ observedAt: "2026-08-30T00:00:00.000Z" })],
    ["the observation is dated in the future", observation({ observedAt: "2026-09-03T00:00:00.000Z" })],
    ["the observation is not datable at all", observation({ observedAt: "the day before yesterday" })],
    ["the row answers a different page", observation({ url: "https://example.com/pricing" })],
    ["the row answers a different kind", observation({ kind: "competitor_page" })],
    ["the body hash is not a hash", observation({ status: { kind: "ok", bodyHash: "not-a-hash", excerpts: ["Acme"], structured: {} } })],
    ["there is nothing quotable to cite", observation({ status: { kind: "ok", bodyHash: "d".repeat(64), excerpts: [], structured: {} } })],
    ["every excerpt is blank", observation({ status: { kind: "ok", bodyHash: "d".repeat(64), excerpts: ["   "], structured: {} } })],
    ["an excerpt carries a control character", observation({ status: { kind: "ok", bodyHash: "d".repeat(64), excerpts: ["Acme\u0001sells"], structured: {} } })],
  ])("reads the page again when %s", (_case, stored) => {
    expect(creditGeoKnowledgeObservation({ kind: "own_page", url: HOME, competitor: null, observation: stored, now: NOW })).toEqual({ kind: "fetch" });
  });

  it("reads the page again rather than credit an address the evidence contract cannot carry", () => {
    for (const url of ["http://example.com/", "https://example.com:8443/", "https://example.com/#top", "https://user:pw@example.com/"]) {
      expect(creditGeoKnowledgeObservation({ kind: "own_page", url, competitor: null,
        observation: observation({ url }), now: NOW })).toEqual({ kind: "fetch" });
    }
  });

  it("drops the excerpts a source cannot carry rather than the whole observation", async () => {
    // Nine usable lines, one blank. The cap is the contract's own, so a source
    // built here can never be refused for carrying too many.
    const excerpts = [...Array.from({ length: 9 }, (_value, index) => `Fact ${index}`), " "];
    const credit = creditGeoKnowledgeObservation({ kind: "own_page", url: HOME, competitor: null,
      observation: observation({ status: { kind: "ok", bodyHash: BODY_HASH, excerpts, structured: {} } }), now: NOW });
    if (credit.kind !== "reuse") throw new Error("Expected a reusable source");
    expect(credit.source.excerpts).toEqual(["Fact 0", "Fact 1", "Fact 2", "Fact 3", "Fact 4", "Fact 5", "Fact 6", "Fact 7"]);
    const evidence = await collect(siteReader(), [credit.source]);
    expect(evidence.sourceCatalogue).toContainEqual(credit.source);
  });
});
