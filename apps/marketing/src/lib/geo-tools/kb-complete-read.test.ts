import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalProfileJson, emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { readCompleteGeoKnowledgeBase } from "./kb-complete-read.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { contextPayload, CONTEXT_KB_ID, CONTEXT_PROFILE } from "./snapshot-context.test-fixtures.ts";
import { buildGeoSnapshotContext, geoSnapshotContextHash, type GeoSnapshotContext } from "./snapshot-context.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoQuestionSetDigest } from "./kb-questions.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import type { GeoKbFrozenSnapshot } from "./kb-store.ts";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "./kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { createGeoPreparedCandidate, createGeoPreparedCandidateV2, geoKnowledgeGenerationInputHash, GEO_PREPARED_CANDIDATE_SCHEMA, GEO_PREPARED_CANDIDATE_V2_SCHEMA } from "./kb-prepared-contract.ts";
import { buildGeoKnowledgePackV1 } from "./kb-knowledge-pack-contract.ts";
import { geoKnowledgeSynthesisInputDigest, geoKnowledgeSynthesisSourceCatalogueDigest } from "./kb-knowledge-synthesis-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { parseGeoQuestionSetV2 } from "./kb-question-set-v2.ts";

const profileStore = vi.hoisted(() => ({ read: vi.fn(() => { throw new Error("Profile store must not be read by GEO consumers"); }) }));
const preparedFallback = vi.hoisted(() => ({ read: vi.fn(async () => ({ kind: "ok" as const, value: null })) }));
vi.mock("../account-websites/store.ts", () => ({ findAccountWebsiteByUrl: profileStore.read, resolveWebsiteProfileReference: profileStore.read }));
vi.mock("./kb-prepared-store.ts", () => ({ DEFAULT_GEO_KB_PREPARED_STORE: preparedFallback }));
const USER = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "11111111-1111-4111-8111-111111111119";
const input = { userId: USER, kbId: CONTEXT_KB_ID, snapshotId: SNAPSHOT };

function fixture(complete = true) {
  const sourceProfile = {
    ...emptyMarketingWebsiteProfile(), productName: "Acme", oneLinePositioning: "Analytics for teams",
    valueProposition: "All original Profile content remains available.", coreFeatures: ["Reporting"],
    buyer: "Finance manager", indirectAlternatives: ["Spreadsheets"], country: "US", locale: "en",
    fieldProvenance: [{ path: "/productName" as const, derivation: "declared" as const, confidence: "high" as const, source: "user_edit" as const, limitation: null, observedAt: null, evidenceUrls: [] }],
  };
  const reference = { ...CONTEXT_PROFILE.reference, profileHash: createHash("sha256").update(canonicalProfileJson(sourceProfile)).digest("hex") };
  const profileCopy = createGeoProfileCopy(reference, sourceProfile);
  const profile = { ...CONTEXT_PROFILE, reference, fieldProvenance: sourceProfile.fieldProvenance };
  const payload = { ...contextPayload(), ...(complete ? { profileCopy } : {}) };
  const { context, questionSet } = buildGeoSnapshotContext({ kbId: CONTEXT_KB_ID, targetHost: "example.com", payload, profile, receipt: null });
  const snapshot: GeoKbFrozenSnapshot = { kbId: CONTEXT_KB_ID, snapshotId: SNAPSHOT, revision: 3, contentHash: geoKbDigest(payload as unknown as GeoKbValue), questionSetHash: geoQuestionSetDigest(questionSet), frozenAt: "2026-08-31T00:00:00.000Z", questionCount: questionSet.questions.length, payload, questionSet };
  const dependencies = {
    readFrozen: vi.fn(async () => ({ kind: "ok" as const, value: snapshot })),
    readContext: vi.fn(async (): Promise<{ kind: "ok"; value: GeoSnapshotContext | null } | { kind: "missing" | "unavailable" }> => ({ kind: "ok", value: context })),
    readPrepared: vi.fn(async () => { throw new Error("Legacy V1 must not read prepared candidates"); }),
  };
  return { sourceProfile, profileCopy, snapshot, context, dependencies };
}

function rehashContext(context: GeoSnapshotContext): void {
  const { contentHash: _old, ...body } = context;
  Object.assign(context, { contentHash: geoSnapshotContextHash(body) });
}

const KNOWLEDGE_GENERATION_ID = "55555555-5555-4555-8555-555555555555";
const FOREIGN_ID = "66666666-6666-4666-8666-666666666666";
function preparedCandidateFixture(options: {
  candidateId?: string;
  kbId?: string;
  payload?: ReturnType<typeof completePayloadV2>;
  questionSet?: ReturnType<typeof questionSetV2>;
  contextText?: string;
} = {}) {
  const candidateId = options.candidateId ?? V2_CANDIDATE_ID;
  const kbId = options.kbId ?? V2_KB_ID;
  const payload = options.payload ?? completePayloadV2();
  const questionSet = options.questionSet ?? questionSetV2();
  const context = buildGeoSnapshotContextV2({ candidateId, kbId, payload, questionSet, sourceReceiptRefs: [],
    evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: options.contextText ?? "Finance teams struggle with late invoices" }],
    sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
  const v1 = createGeoPreparedCandidate({ schemaVersion: GEO_PREPARED_CANDIDATE_SCHEMA, candidateId, kbId, baseDraftVersion: "1",
    baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), sourceReceiptRefs: [],
    generatorVersion: questionSet.methodVersion, payload, questionSet, context });
  const targetUrl = new URL(payload.targetUrl).toString();
  const sourceCatalogue = [{ id: "source:home", kind: "own_page" as const, label: "Home", url: targetUrl, competitor: null,
    availability: "available" as const, reason: null, observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "a".repeat(64), excerpts: ["Acme public evidence."] }];
  const knowledgePack = buildGeoKnowledgePackV1({ schemaVersion: "marketing-geo-knowledge-pack.v1",
    meta: { generatedAt: "2026-08-31T00:00:00.000Z", lastScanAt: "2026-08-31T00:00:00.000Z", market: payload.market.country, language: payload.market.language, counts: { facts: 0, qa: 0, comparisons: 0 } },
    entity: { status: "unavailable", reason: "generation_unavailable" }, facts: { status: "unavailable", reason: "generation_unavailable" },
    qa: { status: "unavailable", reason: "generation_unavailable" }, comparisons: { status: "unavailable", reason: "insufficient_evidence" },
    scope: { status: "unavailable", reason: "generation_unavailable" }, evidence: { status: "unavailable", reason: "insufficient_evidence" },
    machine: { status: "unavailable", reason: "not_collected" }, coverage: { status: "unavailable", reason: "insufficient_evidence" }, sourceCatalogue });
  const synthesisBody = { schemaVersion: "marketing-geo-knowledge-synthesis-input.v1" as const, officialName: payload.officialName, aliases: [...payload.aliases],
    categoryTerms: [...payload.categoryTerms], market: payload.market.country, language: payload.market.language, targetUrl,
    confirmedCompetitors: payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const })),
    evidenceContentHash: "d".repeat(64), sourceCatalogueHash: geoKnowledgeSynthesisSourceCatalogueDigest(sourceCatalogue), sourceCatalogue };
  const knowledgeSynthesisInput = { ...synthesisBody, contentHash: geoKnowledgeSynthesisInputDigest(synthesisBody) };
  const { candidateHash: _candidateHash, schemaVersion: _schemaVersion, ...common } = v1;
  const base = { ...common, schemaVersion: GEO_PREPARED_CANDIDATE_V2_SCHEMA, knowledgePack, knowledgeSynthesisInput };
  const inputHash = geoKnowledgeGenerationInputHash(base);
  const v2 = createGeoPreparedCandidateV2({ ...base, knowledgeGeneration: { generationId: KNOWLEDGE_GENERATION_ID, inputHash,
    synthesisInputHash: knowledgeSynthesisInput.contentHash, evidenceContentHash: knowledgeSynthesisInput.evidenceContentHash,
    payloadHash: v1.baseDraftHash, questionSetHash: context.questionSetHash, packHash: knowledgePack.contentHash,
    sourceCatalogueHash: geoV2Digest(knowledgePack.sourceCatalogue), promptVersion: "geo-kb-knowledge-pack.v1" } });
  return { payload, questionSet, context, v1, v2, knowledgePack };
}

function completeV2Fixture() {
  const prepared = preparedCandidateFixture();
  const snapshot = { kbId: V2_KB_ID, snapshotId: SNAPSHOT, revision: 4, contentHash: geoV2Digest(prepared.payload),
    questionSetHash: geoV2Digest(prepared.questionSet), frozenAt: "2026-08-31T00:00:00.000Z", questionCount: prepared.questionSet.questions.length,
    preparedId: V2_CANDIDATE_ID, payload: prepared.payload, questionSet: prepared.questionSet };
  const readPrepared = vi.fn(async () => ({ kind: "ok" as const, value: prepared.v1 as typeof prepared.v1 | typeof prepared.v2 | null }));
  const dependencies = { readFrozen: vi.fn(async () => ({ kind: "ok" as const, value: snapshot })),
    readContext: vi.fn(async () => ({ kind: "ok" as const, value: prepared.context })), readPrepared };
  const selection = { userId: USER, kbId: V2_KB_ID, snapshotId: SNAPSHOT };
  return { ...prepared, snapshot, dependencies, selection };
}

describe("complete immutable GEO knowledge-base reads", () => {
  it("returns all persisted Profile fields while the Profile store is unavailable", async () => {
    const value = fixture();
    const result = await readCompleteGeoKnowledgeBase(input, value.dependencies);
    expect(result).toEqual({ kind: "ok", value: { snapshot: value.snapshot, context: value.context, completeness: "complete", knowledgePack: null } });
    if (result.kind !== "ok") throw new Error("Expected complete GEO read");
    expect(result.value.snapshot.payload.profileCopy?.profile.buyer).toBe("Finance manager");
    expect(result.value.snapshot.payload.profileCopy?.profile.indirectAlternatives).toEqual(["Spreadsheets"]);
    expect(profileStore.read).not.toHaveBeenCalled();
  });

  it("does not update frozen content when the original Profile changes", async () => {
    const value = fixture();
    value.sourceProfile.productName = "Current Profile renamed";
    value.sourceProfile.indirectAlternatives.push("Current alternative");
    const result = await readCompleteGeoKnowledgeBase({ userId: USER, kbId: CONTEXT_KB_ID, revision: 3 }, value.dependencies);
    expect(result).toMatchObject({ kind: "ok", value: { completeness: "complete", snapshot: { payload: { profileCopy: { profile: { productName: "Acme", indirectAlternatives: ["Spreadsheets"] } } } } } });
    expect(value.dependencies.readFrozen).toHaveBeenCalledWith({ userId: USER, kbId: CONTEXT_KB_ID, revision: 3 });
    expect(value.dependencies.readContext).toHaveBeenCalledWith(input);
    expect(profileStore.read).not.toHaveBeenCalled();
  });

  it.each([false, true])("labels old snapshots legacy_partial without backfilling Profile (context=%s)", async (withContext) => {
    const value = fixture(false);
    if (!withContext) value.dependencies.readContext.mockResolvedValue({ kind: "ok", value: null });
    const before = JSON.stringify(value.snapshot);
    const result = await readCompleteGeoKnowledgeBase(input, value.dependencies);
    expect(result).toMatchObject({ kind: "ok", value: { completeness: "legacy_partial" } });
    expect(JSON.stringify(value.snapshot)).toBe(before);
    expect(Object.hasOwn(value.snapshot.payload, "profileCopy")).toBe(false);
    expect(profileStore.read).not.toHaveBeenCalled();
    expect(value.dependencies.readPrepared).not.toHaveBeenCalled();
  });

  it.each(["payload", "questions"])("rejects a mismatched frozen %s as unavailable integrity state", async (part) => {
    const value = fixture();
    if (part === "payload") Object.assign(value.snapshot.payload, { officialName: "Tampered" });
    if (part === "questions") Object.assign(value.snapshot.questionSet.questions[0]!, { text: "Tampered question" });
    expect((await readCompleteGeoKnowledgeBase(input, value.dependencies)).kind).toBe("unavailable");
    expect(value.dependencies.readContext).not.toHaveBeenCalled();
  });

  it.each([
    ["knowledge base", { kbId: SNAPSHOT }, input],
    ["snapshot", { snapshotId: CONTEXT_PROFILE.reference.snapshotId }, input],
    ["revision", { revision: 4 }, { userId: USER, kbId: CONTEXT_KB_ID, revision: 3 }],
  ] as const)("treats a mismatched frozen %s selector as missing ownership", async (_part, mismatch, selector) => {
    const value = fixture();
    Object.assign(value.snapshot, mismatch);
    expect(await readCompleteGeoKnowledgeBase(selector, value.dependencies)).toEqual({ kind: "missing" });
    expect(value.dependencies.readContext).not.toHaveBeenCalled();
  });

  it("rejects tampered Profile content even with a recomputed outer payload digest", async () => {
    const value = fixture();
    Object.assign(value.profileCopy.profile, { valueProposition: "Forged claim" });
    Object.assign(value.snapshot, { contentHash: geoKbDigest(value.snapshot.payload as unknown as GeoKbValue) });
    Object.assign(value.context, { payloadHash: value.snapshot.contentHash });
    rehashContext(value.context);
    expect((await readCompleteGeoKnowledgeBase(input, value.dependencies)).kind).toBe("unavailable");
  });

  it.each(["missing", "unavailable", "null"])("never downgrades complete content when its GEO context is %s", async (kind) => {
    const value = fixture();
    value.dependencies.readContext.mockResolvedValue(kind === "null" ? { kind: "ok", value: null } : { kind: kind as "missing" | "unavailable" });
    expect((await readCompleteGeoKnowledgeBase(input, value.dependencies)).kind).toBe("unavailable");
    expect(profileStore.read).not.toHaveBeenCalled();
  });

  it.each(["hash", "kb", "payload", "questions", "host", "profile_reference", "profile_projection"])("rejects invalid GEO context %s instead of joining current Profile", async (part) => {
    const value = fixture();
    if (part === "hash") Object.assign(value.context, { contentHash: "a".repeat(64) });
    if (part === "kb") Object.assign(value.context, { kbId: SNAPSHOT });
    if (part === "payload") Object.assign(value.context, { payloadHash: "b".repeat(64) });
    if (part === "questions") Object.assign(value.context, { questionSetHash: "b".repeat(64) });
    if (part === "host") Object.assign(value.context, { targetHost: "other.example.com" });
    if (part === "profile_reference") Object.assign(value.context.profile!.reference, { snapshotRevision: 4 });
    if (part === "profile_projection") Object.assign(value.context.profile!, { productName: "Other Profile" });
    if (part !== "hash") rehashContext(value.context);
    expect((await readCompleteGeoKnowledgeBase(input, value.dependencies)).kind).toBe("unavailable");
  });

  it("preserves missing frozen state and fails closed on rejected store reads", async () => {
    const value = fixture();
    const missing = { ...value.dependencies, readFrozen: vi.fn(async () => ({ kind: "missing" as const })) };
    expect(await readCompleteGeoKnowledgeBase(input, missing)).toEqual({ kind: "missing" });
    expect(missing.readContext).not.toHaveBeenCalled();
    const broken = { ...value.dependencies, readFrozen: vi.fn(async () => { throw new Error("GEO store unavailable"); }) };
    expect((await readCompleteGeoKnowledgeBase(input, broken)).kind).toBe("unavailable");
  });
  it.each([{}, { snapshotId: SNAPSHOT, revision: 3 }])("rejects an absent or ambiguous immutable selector: %j", async (selector) => {
    const value = fixture();
    const result = await readCompleteGeoKnowledgeBase({ userId: USER, kbId: CONTEXT_KB_ID, ...selector } as never, value.dependencies);
    expect(result).toEqual({ kind: "invalid", code: "invalid_revision" });
    expect(value.dependencies.readFrozen).not.toHaveBeenCalled();
  });
});

describe("prepared knowledge on complete V2 reads", () => {
  it("returns null for an exact V1 prepared candidate and the exact pack for V2", async () => {
    const v1 = completeV2Fixture();
    expect(await readCompleteGeoKnowledgeBase(v1.selection, v1.dependencies)).toEqual({ kind: "ok", value: {
      snapshot: v1.snapshot, context: v1.context, completeness: "complete", knowledgePack: null,
    } });
    expect(v1.dependencies.readPrepared).toHaveBeenCalledWith({ userId: USER, kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID });

    const v2 = completeV2Fixture(); v2.dependencies.readPrepared.mockResolvedValue({ kind: "ok", value: v2.v2 });
    expect(await readCompleteGeoKnowledgeBase(v2.selection, v2.dependencies)).toEqual({ kind: "ok", value: {
      snapshot: v2.snapshot, context: v2.context, completeness: "complete", knowledgePack: v2.knowledgePack,
    } });
  });

  it.each(["missing", "null", "unavailable"] as const)("fails closed when the prepared candidate read is %s", async state => {
    const value = completeV2Fixture();
    value.dependencies.readPrepared.mockResolvedValue(state === "null" ? { kind: "ok", value: null }
      : { kind: state, ...(state === "unavailable" ? { reason: "offline" } : {}) } as never);
    expect((await readCompleteGeoKnowledgeBase(value.selection, value.dependencies)).kind).toBe("unavailable");
  });

  it("never falls back to the real prepared store when an injected dependency bundle omits its reader", async () => {
    const value = completeV2Fixture();
    const { readPrepared: _readPrepared, ...incomplete } = value.dependencies;
    expect((await readCompleteGeoKnowledgeBase(value.selection, incomplete as never)).kind).toBe("unavailable");
    expect(preparedFallback.read).not.toHaveBeenCalled();
  });

  it.each(["candidate", "kb"] as const)("rejects a valid prepared candidate from a foreign %s scope", async scope => {
    const value = completeV2Fixture();
    const foreign = preparedCandidateFixture(scope === "candidate" ? { candidateId: FOREIGN_ID } : { kbId: FOREIGN_ID });
    value.dependencies.readPrepared.mockResolvedValue({ kind: "ok", value: foreign.v1 });
    expect((await readCompleteGeoKnowledgeBase(value.selection, value.dependencies)).kind).toBe("unavailable");
  });

  it.each(["payload", "questions", "context", "tampered"] as const)("rejects an internally mismatched or %s prepared candidate", async part => {
    const value = completeV2Fixture();
    let candidate: unknown;
    if (part === "payload") candidate = preparedCandidateFixture({ payload: parseGeoKbPayloadV2({ ...value.payload, officialName: "Other" }) }).v1;
    else if (part === "questions") candidate = preparedCandidateFixture({ questionSet: parseGeoQuestionSetV2({ ...value.questionSet,
      questions: value.questionSet.questions.map((question, index) => index === 0 ? { ...question, text: "A different valid question?" } : question) }) }).v1;
    else if (part === "context") candidate = preparedCandidateFixture({ contextText: "Different but internally valid evidence" }).v1;
    else candidate = { ...value.v2, candidateHash: "f".repeat(64) };
    value.dependencies.readPrepared.mockResolvedValue({ kind: "ok", value: candidate as typeof value.v1 });
    expect((await readCompleteGeoKnowledgeBase(value.selection, value.dependencies)).kind).toBe("unavailable");
  });
});
