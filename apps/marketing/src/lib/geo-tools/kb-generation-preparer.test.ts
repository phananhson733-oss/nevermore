import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalProfileJson } from "../account-websites/contracts.ts";
import type { KeywordLlmConfig } from "../tools/keyword-llm-client.ts";
import { createGeoKbGenerationPreparer, validateGeoKbDraftLineage, type GeoKbGenerationPreparerDependencies } from "./kb-generation-preparer.ts";
import { completePayloadV2, V2_KB_ID as KB, V2_CANDIDATE_ID as ID } from "./kb-v2.test-fixtures.ts";
import { createGeoProfileCopy, profileCopyReference } from "./kb-profile-copy.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoRoleProposal } from "./kb-role-proposal.ts";
import { prepareGeoRoleSynthesis, prepareGeoQuestionSynthesis, type GeoSynthesisResult } from "./kb-synthesis.ts";
import { ROLE_SYNTHESIS_INPUT, QUESTION_SYNTHESIS_INPUT } from "./kb-synthesis-fixtures.ts";
import type { GeoRoleSynthesisInput, GeoRoleSynthesis, GeoQuestionSynthesisInput, GeoQuestionSynthesis } from "./kb-synthesis-contract.ts";
import { geoGenerationInputHash, type GeoKbGenerationRecord } from "./kb-generation.ts";
import { parseGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import { finalizeGeoKbSourceReportV2, collectGeoQueryEvidenceV2, inspectGeoFactSourceV2, extractGeoCompetitorSourceV2 } from "./kb-sources.ts";
import { GEO_KB_SOURCE_SCHEMA, type GeoKbSourceReportV2 } from "./kb-source-contract.ts";

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
function setup(overrides: Partial<GeoKbGenerationPreparerDependencies> = {}) {
  const value = payload(), draft = { payload: value, draftVersion: 4, contentHash: geoV2Digest(value), updatedAt: "2026-08-31T00:00:00.000Z" };
  const receipts = new Map<string, GeoKbSourceReportV2>(), generations = new Map<string, GeoKbGenerationRecord>();
  const deps: GeoKbGenerationPreparerDependencies = {
    readDetails: vi.fn(async () => ({ kind: "ok" as const, value: { kbId: KB, origin: "https://example.com", draft } })),
    validateCurrentProfileCopy: vi.fn(async () => "current" as const),
    readReceipt: vi.fn(async ({ receiptId }) => receipts.has(receiptId) ? { kind: "ok" as const, value: receipts.get(receiptId)! } : { kind: "missing" as const }),
    readGeneration: vi.fn(async ({ generationId }) => generations.has(generationId) ? { kind: "ok" as const, generation: generations.get(generationId)! } : { kind: "missing" as const }),
    resolveConfig: vi.fn(() => CONFIG),
    synthesizeRoles: vi.fn(async (input: GeoRoleSynthesisInput): Promise<GeoSynthesisResult<GeoRoleSynthesis>> => {
      const prepared = prepareGeoRoleSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline role fixture");
      return { ok: true, value: roleOutput(input), provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
    }),
    synthesizeQuestions: vi.fn(async (input: GeoQuestionSynthesisInput): Promise<GeoSynthesisResult<GeoQuestionSynthesis>> => {
      const prepared = prepareGeoQuestionSynthesis(input, CONFIG); if (!prepared.ok) throw new Error("Invalid offline question fixture");
      return { ok: true, value: questionOutput(input), provider: prepared.value.provider, usage, attemptedCalls: 1, delivery: "response_received" };
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
