import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalProfileJson } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "./kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { readVersionedFrozenGeoKb } from "./kb-versioned-read.ts";
import { readGeoSnapshotContext, readVersionedGeoSnapshotContext, type GeoContextStoreDependencies } from "./asset-context-store.ts";
import { readCompleteGeoKnowledgeBase } from "./kb-complete-read.ts";
import { DEFAULT_GEO_KB_STORE_DEPENDENCIES } from "./kb-store.ts";
import { buildGeoQuestionSet } from "./kb-questions.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";
import { parseGeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { projectFrozenGeoQuestions, countGeoCitationQuestions } from "./kb-consumer-projection.ts";
import { sharedGeoBriefBasis, assembleSharedGeoBrief } from "./brief-shared.ts";
import { verifyOwnedGeoBrief } from "./brief-reference.ts";
import { geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { geoDraftFacts } from "@sf/public-tools/content-brief/geo-draft";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { buildVisibilityPlan } from "./visibility-v2.ts";
import { exportVisibilityJson, parseVisibilityImport } from "./visibility-export.ts";
import { resolveSharedBriefRunEvidence } from "./brief-shared-deps.ts";
import type { OwnedGeoGapResult } from "./owned-gap.ts";
import { CONTENT_DRAFT_HANDLER_DEPENDENCIES, handleContentDraftRunRequest } from "../tools/content-draft-handler.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "44444444-4444-4444-8444-444444444444";
const RECEIPT = "33333333-3333-4333-8333-333333333333";
const TIME = "2026-08-31T00:00:00.000Z";
const selection = { userId: USER, kbId: V2_KB_ID, snapshotId: SNAPSHOT };
const noCurrentProfile = vi.hoisted(() => vi.fn(() => { throw new Error("A frozen consumer must never read current Profile"); }));
vi.mock("../account-websites/store.ts", () => ({ findAccountWebsiteByUrl: noCurrentProfile, resolveWebsiteProfileReference: noCurrentProfile }));

function fixture() {
  const base = completePayloadV2();
  const profile = { ...base.profileCopy.profile, oneLinePositioning: "Profile prose must not become a verified V2 fact", coreFeatures: ["Unadmitted Profile feature"],
    fieldProvenance: (["productName", "oneLinePositioning", "coreFeatures"] as const).map(field => ({ path: `/${field}` as const, derivation: "declared" as const, confidence: "high" as const, source: "user_edit" as const, limitation: null, observedAt: null, evidenceUrls: [] })) };
  const profileCopy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: base.profileCopy.websiteId, snapshotId: base.profileCopy.snapshotId, snapshotRevision: Number(base.profileCopy.snapshotRevision), profileSchemaVersion: "marketing-website-profile.v1", profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") }, profile);
  const payload = { ...base, profileCopy, facts: [base.facts[0]!,
    { ...base.facts[0]!, key: "Pending claim", value: "999", review: "pending" as const },
    { ...base.facts[0]!, key: "Conflicting claim", value: "Free forever", review: "excluded" as const, reason: "conflicting" as const },
    { ...base.facts[0]!, key: "Crawl claim", value: "5", supportRef: { receiptId: RECEIPT, evidenceId: "F1" } }] };
  const semantic = questionSetV2();
  const registry = buildGeoQuestionSet(contextPayload());
  const probe = registry.questions.find(q => q.calibrated && q.mode === "retrieval")!;
  const probeEntities = probe.requiredEntities.map((text, index) => ({ id: `registry-${index}`, text, kind: "category" as const, roleId: null, evidenceRefs: ["manual:r1"] }));
  const questionSet = parseGeoQuestionSetV2({ ...semantic, registryVersion: registry.registryVersion, entityCatalog: [...semantic.entityCatalog, ...probeEntities], questions: [
    { ...semantic.questions[0]!, id: "semantic:finance/invoices" },
    { ...probe, provenance: { kind: "registry", generatorVersion: registry.registryVersion, evidenceRefs: ["manual:r1"], entityRefs: probeEntities.map(row => row.id) } },
  ] });
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet,
    sourceReceiptRefs: [{ receiptId: RECEIPT, contentHash: "b".repeat(64) }], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams research analytics and late invoices" }],
    sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } },
    verifiedFactSupport: [{ receiptId: RECEIPT, evidenceId: "F1", key: "Crawl claim", value: "5", sourceUrl: base.facts[0]!.sourceUrl, observedAt: base.facts[0]!.observedAt }] });
  const frozen = { kbId: V2_KB_ID, snapshotId: SNAPSHOT, revision: 2, frozenAt: TIME, contentHash: geoV2Digest(payload), questionSetHash: geoV2Digest(questionSet), questionCount: questionSet.questions.length, payload, questionSet };
  const row = { id: SNAPSHOT, kb_id: V2_KB_ID, user_id: USER, revision: 2, schema_version: payload.schemaVersion, payload, content_hash: frozen.contentHash, question_set: questionSet, question_set_hash: frozen.questionSetHash, context_hash: context.contentHash, frozen_at: TIME };
  const store = { ...DEFAULT_GEO_KB_STORE_DEPENDENCIES, readSnapshot: vi.fn(async () => ({ kind: "ok" as const, data: row })) };
  const contextStore: GeoContextStoreDependencies = { readSnapshot: vi.fn(async () => ({ data: row, error: null })), readContext: vi.fn(async () => ({ data: { snapshot_id: SNAPSHOT, user_id: USER, kb_id: V2_KB_ID, content_hash: context.contentHash, context }, error: null })),
    readReceipt: noCurrentProfile, callRpc: noCurrentProfile };
  const dependencies = { readFrozen: (input: typeof selection | { userId: string; kbId: string; revision: number }) => readVersionedFrozenGeoKb(input, store), readContext: (input: typeof selection) => readVersionedGeoSnapshotContext(input, contextStore) };
  const basis = () => sharedGeoBriefBasis({ frozen, context, questionId: questionSet.questions[0]!.id, questionText: "ignored browser words", runEvidence: null, runId: "offline-v2-brief", now: TIME });
  return { frozen, context, row, store, contextStore, dependencies, basis };
}

function criterionFixture(texts: readonly string[]) {
  const f = fixture();
  const payload = { ...f.frozen.payload, roles: [{ ...f.frozen.payload.roles[0]!, decisionCriteria: Array.from({ length: 8 }, (_, index) => `原始标准 ${index + 1}`) }] };
  const entities = texts.map((text, index) => ({ id: `criterion-${index + 1}`, text, kind: "role_criterion" as const, roleId: "r1", evidenceRefs: ["manual:r1"] }));
  const selected = { ...f.frozen.questionSet.questions[0]!, layer: "evaluation" as const, text: "How should finance teams evaluate setup effort?", requiredEntities: [...texts], provenance: { ...f.frozen.questionSet.questions[0]!.provenance, entityRefs: entities.map(entity => entity.id) } };
  const questionSet = parseGeoQuestionSetV2({ ...f.frozen.questionSet, entityCatalog: [...f.frozen.questionSet.entityCatalog, ...entities], questions: [selected] });
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet,
    sourceReceiptRefs: f.context.sourceReceiptRefs, evidenceCatalog: f.context.evidenceCatalog, sourceSummary: f.context.sourceSummary,
    verifiedFactSupport: [{ receiptId: RECEIPT, evidenceId: "F1", key: "Crawl claim", value: "5", sourceUrl: payload.facts[0]!.sourceUrl, observedAt: payload.facts[0]!.observedAt }] });
  Object.assign(f.frozen, { payload, questionSet, questionCount: 1, contentHash: geoV2Digest(payload), questionSetHash: geoV2Digest(questionSet) });
  Object.assign(f.context, context);
  Object.assign(f.row, { payload, question_set: questionSet, content_hash: f.frozen.contentHash, question_set_hash: f.frozen.questionSetHash, context_hash: context.contentHash });
  return f;
}

describe("actual frozen V2 consumers", () => {
  it("uses only this question's frozen English criterion, not all eight original role criteria", async () => {
    const f = criterionFixture(["setup effort"]), before = JSON.stringify(f.frozen);
    const basis = f.basis();
    expect(basis.evidence.kb_requirements.map(requirement => requirement.text)).toEqual(["setup effort"]);
    expect(basis.must_answer.items).toHaveLength(2);
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Evaluation", h3: [], answers: basis.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb", "crawl"] } }] });
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
    expect(await verifyOwnedGeoBrief(brief, USER, { ...f.dependencies, readRun: async () => ({ kind: "missing" }), readRunEvidence: async () => ({ kind: "not_found" }) })).toBe(true);
    expect(JSON.stringify(f.frozen)).toBe(before);
  });
  it("deduplicates identical required text in the Brief only while retaining every frozen source entity ID", async () => {
    const f = criterionFixture(["setup effort", "setup effort"]), before = JSON.stringify(f.frozen);
    const basis = f.basis();
    expect(basis.lead_answer.required_entities).toEqual(["setup effort"]);
    expect(basis.evidence.kb_requirements.map(requirement => requirement.text)).toEqual(["setup effort"]);
    expect(f.frozen.questionSet.questions[0]!.provenance.entityRefs).toEqual(["criterion-1", "criterion-2"]);
    expect(f.frozen.questionSet.questions[0]!.requiredEntities).toEqual(["setup effort", "setup effort"]);
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Evaluation", h3: [], answers: basis.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb", "crawl"] } }] });
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
    expect(await verifyOwnedGeoBrief(brief, USER, { ...f.dependencies, readRun: async () => ({ kind: "missing" }), readRunEvidence: async () => ({ kind: "not_found" }) })).toBe(true);
    expect(JSON.stringify(f.frozen)).toBe(before);
  });
  it("matches the Brief parser's exact-string equality rather than folding case or whitespace", () => {
    const values = ["setup effort", "Setup effort", " setup effort ", "setup effort"];
    const basis = criterionFixture(values).basis();
    expect(basis.lead_answer.required_entities).toEqual(values.slice(0, 3));
  });
  it.each([7, 8])("keeps the actual selected-criterion budget explicit (%s)", count => {
    const f = criterionFixture(Array.from({ length: count }, (_, index) => `English criterion ${index + 1}`));
    if (count === 8) expect(() => f.basis()).toThrow("required_anchor_budget_exceeded");
    else {
      const basis = f.basis(); expect(basis.evidence.kb_requirements).toHaveLength(7); expect(basis.must_answer.items).toHaveLength(8);
    }
  });
  it("does not reinterpret V1 all-role criteria or duplicate entity behavior", () => {
    const frozen = structuredClone(SHARED_FROZEN);
    const input = { frozen, context: null, questionId: "q1", questionText: "", runEvidence: null, runId: "legacy", now: TIME };
    Object.assign(frozen.payload, { roles: [{ ...frozen.payload.roles[0]!, decisionCriteria: Array.from({ length: 8 }, (_, index) => `Criterion ${index + 1}`) }] });
    expect(() => sharedGeoBriefBasis(input)).toThrow("required_anchor_budget_exceeded");
    Object.assign(frozen.payload, { roles: [] }); Object.assign(frozen.questionSet.questions[0]!, { requiredEntities: ["Fixture", "Fixture"] });
    expect(sharedGeoBriefBasis(input).lead_answer.required_entities).toEqual(["Fixture", "Fixture"]);
  });
  it("reads exact full V2 payload/questions/context while every current Profile path throws", async () => {
    const f = fixture();
    expect(await readCompleteGeoKnowledgeBase(selection, f.dependencies)).toEqual({ kind: "ok", value: { snapshot: f.frozen, context: f.context, completeness: "complete" } });
    expect(f.frozen.questionSet.questions[0]?.provenance.kind).toBe("semantic"); expect(noCurrentProfile).not.toHaveBeenCalled();
  });
  it("adds a versioned context reader without widening the legacy context reader", async () => {
    const f = fixture();
    expect(await readVersionedGeoSnapshotContext(selection, f.contextStore)).toEqual({ kind: "ok", value: f.context });
    expect(await readGeoSnapshotContext(selection, f.contextStore)).toEqual({ kind: "unavailable" });
  });
  it.each(["null", "wrong_owner", "wrong_hash", "v1_context"])("fails closed for complete V2 with %s", async kind => {
    const f = fixture();
    if (kind === "null") f.row.context_hash = null as never;
    if (kind === "wrong_owner") f.row.user_id = RECEIPT;
    if (kind === "wrong_hash") f.row.context_hash = "c".repeat(64);
    if (kind === "v1_context") Object.assign(f.context, { schemaVersion: "marketing-geo-snapshot-context.v1" });
    expect((await readCompleteGeoKnowledgeBase(selection, f.dependencies)).kind).toBe("unavailable");
  });
  it("does not omit V2 provenance before validating the stored question digest", async () => {
    const f = fixture(); Object.assign(f.frozen.questionSet.questions[0]!.provenance, { generatorVersion: "forged-generator" });
    expect((await readCompleteGeoKnowledgeBase(selection, f.dependencies)).kind).toBe("unavailable");
  });
  it("admits only V2 context facts and never auto-appends Profile prose", () => {
    const brief = fixture().basis();
    expect(brief.evidence.facts.map(fact => [fact.source, fact.text])).toEqual([["kb", "3"], ["crawl", "5"]]);
    expect(brief.fact_table.find(fact => fact.label === "Pending claim")).toMatchObject({ value: null, evidence_refs: [] });
    expect(brief.fact_table.find(fact => fact.label === "Conflicting claim")).toMatchObject({ value: null, reason: "conflicting", evidence_refs: [] });
    expect(brief.evidence.facts.some(fact => fact.id.startsWith("P"))).toBe(false);
    expect(JSON.stringify(brief.evidence)).not.toContain("Profile prose"); expect(JSON.stringify(brief.evidence)).not.toContain("999");
  });
  it("uses the actual Brief parser and Draft verifier, denying a self-rehashed invented fact", async () => {
    const f = fixture(), basis = f.basis();
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb", "crawl"] } }] });
    const deps = { ...f.dependencies, readRun: vi.fn(async () => ({ kind: "missing" as const })), readRunEvidence: vi.fn(async () => ({ kind: "not_found" as const })) };
    expect(await verifyOwnedGeoBrief(brief, USER, deps)).toBe(true);
    expect(geoDraftFacts(brief, "O1", { tone: "explanatory", person: "second", product_mention: "gap_only" }).map(fact => fact.text)).toEqual(["3", "5"]);
    const forged = structuredClone(brief); forged.evidence.facts[0]!.text = "999"; forged.fact_table[0]!.value = "999"; forged.run.fingerprint = await geoFingerprint(forged);
    expect((await parseGeoContentBrief(forged)).ok).toBe(true);
    expect(await verifyOwnedGeoBrief(forged, USER, deps)).toBe(false);
    let charged = 0, generated = 0;
    const release = vi.fn();
    const denied = await handleContentDraftRunRequest(new Request("https://gengrowth.test/api/tools/content-draft/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: forged, settings: { tone: "explanatory", person: "second", product_mention: "gap_only" }, section_ids: ["O1"] }) }), {
      ...CONTENT_DRAFT_HANDLER_DEPENDENCIES,
      getServerAuthenticatedUser: async () => ({ status: "authenticated", userId: USER, email: null, avatarUrl: null }),
      readJson: async request => ({ ok: true, value: await request.json() }), extractClientIp: () => "203.0.113.8",
      acquireSlot: () => ({ acquired: true, release }), consumeQuota: async () => { charged += 1; return { kind: "allowed", hits: 1 }; },
      verifyGeoBrief: (candidate, userId) => verifyOwnedGeoBrief(candidate, userId, deps),
      generateSection: async () => { generated += 1; throw new Error("Refused V2 evidence reached model"); },
      runCoverage: async () => { throw new Error("Refused V2 evidence reached coverage"); }, emit: () => undefined,
    });
    expect(denied.status).toBe(422); expect(await denied.json()).toMatchObject({ error: { code: "brief_reference_invalid" } });
    expect({ charged, generated }).toEqual({ charged: 0, generated: 0 }); expect(release).toHaveBeenCalledTimes(1);
  });
  it("projects exactly eight common question fields while retaining the complete frozen identity", () => {
    const f = fixture(), before = JSON.stringify(f.frozen), projected = projectFrozenGeoQuestions(f.frozen.questionSet);
    expect(Object.keys(projected[0]!).sort()).toEqual(["id", "text", "layer", "mode", "roleId", "requiredEntities", "templateId", "calibrated"].sort());
    expect(projected[0]!.id).toBe("semantic:finance/invoices"); expect(JSON.stringify(f.frozen)).toBe(before);
    expect(countGeoCitationQuestions(f.frozen.questionSet)).toBe(1);
  });
  it("rejects an uncalibrated V2 retrieval definition without changing V1 semantics", () => {
    const f = fixture();
    const invalid = { ...f.frozen.questionSet, questions: [{ ...f.frozen.questionSet.questions[0]!, mode: "retrieval" as const }] };
    expect(() => projectFrozenGeoQuestions(invalid)).toThrow();
    const legacy = buildGeoQuestionSet(contextPayload());
    const uncalibrated = { ...legacy, questions: [{ ...legacy.questions[0]!, mode: "retrieval" as const, calibrated: false }] };
    expect(countGeoCitationQuestions(uncalibrated)).toBe(1);
  });
  it("keeps all real sample slots but excludes semantic demand from citation denominators, through export/import", () => {
    const f = fixture(), questions = projectFrozenGeoQuestions(f.frozen.questionSet);
    const template = visibilityReportFixtureV2().questions[0]!.samples[0]!;
    const samples = questions.map(question => ({ ...template, questionId: question.id, slotId: `chatgpt:${question.id}:1`, providerTaskId: `offline-${question.id}` }));
    const report = visibilityReportFixtureV2({ snapshotId: SNAPSHOT, kbId: V2_KB_ID, snapshotRevision: 2, questionSetHash: f.frozen.questionSetHash, questions, samples,
      context: { officialName: "Acme", aliases: ["Acme"], competitors: [], targetHost: "example.com", marketCode: "US", language: "en" } });
    expect(buildVisibilityPlan(questions, ["chatgpt"], 1)).toHaveLength(2);
    expect(report.manifest.calls).toBe(2); expect(report.manifest.costUsd).toBe(0.02);
    expect(report.metrics.citation.trials).toBe(1); expect(report.metrics.questionsCited.trials).toBe(1);
    const imported = parseVisibilityImport(exportVisibilityJson(report)); expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.report.manifest.questionSetHash).toBe(f.frozen.questionSetHash);
  });
  it("compares the report's common fields while still requiring the full frozen V2 hash", async () => {
    const f = fixture(), questions = projectFrozenGeoQuestions(f.frozen.questionSet);
    const template = visibilityReportFixtureV2().questions[0]!.samples[0]!;
    const samples = questions.map(question => ({ ...template, questionId: question.id, slotId: `chatgpt:${question.id}:1`, providerTaskId: `offline-${question.id}` }));
    const report = visibilityReportFixtureV2({ snapshotId: SNAPSHOT, kbId: V2_KB_ID, snapshotRevision: 2, questionSetHash: f.frozen.questionSetHash, questions, samples,
      context: { officialName: "Acme", aliases: ["Acme"], competitors: [], targetHost: "example.com", marketCode: "US", language: "en" } });
    const questionId = questions[0]!.id;
    const resolveGap = vi.fn(async (): Promise<OwnedGeoGapResult> => ({ kind: "ok", value: { report,
      gap: { id: "gap-semantic", questionId, kind: "A", reason: "no_matching_page_in_audited_inventory", evidenceIds: [], pageUrl: null, sourceUrls: [], action: "brief" },
      siteEvidence: { schemaVersion: "marketing-geo-site-evidence.v1", collectedAt: TIME, index: { scope: "declared_and_reachable_inventory", status: "partial", targetHost: "example.com", discoveredCount: 0, inventorySources: [], pages: [], sitemapUrls: [], limits: [] }, references: [], referenceOmittedCount: 0, citability: [], citabilityOmittedCount: 0 } } }));
    const input = { userId: USER, runId: report.manifest.runId, gapId: "gap-semantic", questionId, frozen: f.frozen };
    expect((await resolveSharedBriefRunEvidence(input, { resolveGap })).kind).toBe("ok");
    Object.assign(report.manifest, { questionSetHash: geoV2Digest(projectFrozenGeoQuestions(f.frozen.questionSet)) });
    expect((await resolveSharedBriefRunEvidence(input, { resolveGap })).kind).toBe("unavailable");
  });
  it("retains a 128-character semantic identity and more than eight entities through the existing report wire", () => {
    const f = fixture(), semantic = f.frozen.questionSet.questions[0]!;
    const id = `semantic:${"a".repeat(119)}`, requiredEntities = Array.from({ length: 12 }, (_, index) => `Concept ${index + 1}`);
    const question = { ...semantic, id, requiredEntities };
    const set = { ...f.frozen.questionSet, questions: [question] };
    const questions = projectFrozenGeoQuestions(set), sample = visibilityReportFixtureV2().questions[0]!.samples[0]!;
    const report = visibilityReportFixtureV2({ questions, samples: [{ ...sample, questionId: id, slotId: `chatgpt:${id}:1` }] });
    expect(questions[0]?.id).toBe(id); expect(questions[0]?.requiredEntities).toEqual(requiredEntities);
    const imported = parseVisibilityImport(exportVisibilityJson(report)); expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.report.questions[0]?.definition.requiredEntities).toEqual(requiredEntities);
  });
});
