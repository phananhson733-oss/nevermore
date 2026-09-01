import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { parseGeoKbPreparedWire, parseGeoKbRoleProposalWire, parseGeoKbGenerationWire, parseGeoKbFrozenV2Wire, parseGeoKbEditorViewV2, parseGeoKbDraftSaveV2, parseGeoKbFreezeV2Response } from "./geo-kb-v2-wire.ts";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2 } from "../../lib/geo-tools/snapshot-context-v2.ts";
import { createGeoPreparedCandidate } from "../../lib/geo-tools/kb-prepared-contract.ts";
import { createGeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
import { ROLE_SYNTHESIS_INPUT, ROLE_SYNTHESIS_OUTPUT } from "../../lib/geo-tools/kb-synthesis-fixtures.ts";

const OTHER = "33333333-3333-4333-8333-333333333333";
const ATTEMPT = { attemptedCalls: 1 as const, delivery: "response_received" as const, modelRequested: "fixture-model", inputTokens: 10, outputTokens: 20, requestCount: 1 };
function prepared() {
  const payload = completePayloadV2(), questionSet = questionSetV2();
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet, sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
  return createGeoPreparedCandidate({ schemaVersion: "marketing-geo-prepared-candidate.v1", candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, baseDraftVersion: "1", baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), sourceReceiptRefs: [], generatorVersion: questionSet.methodVersion, payload, questionSet, context });
}
function proposal() {
  return createGeoRoleProposal({ generationId: V2_CANDIDATE_ID, kbId: V2_KB_ID, baseDraftVersion: "0", baseDraftHash: "a".repeat(64), profileCopyHash: "b".repeat(64), input: ROLE_SYNTHESIS_INPUT, output: ROLE_SYNTHESIS_OUTPUT, sourceReceiptRefs: [], selectedEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 } });
}
function generation(kind: "roles" | "questions" = "questions") {
  return { generationId: V2_CANDIDATE_ID, kbId: V2_KB_ID, kind, inputHash: "c".repeat(64), state: "succeeded" as const, result: kind === "questions" ? prepared() : proposal(), errorReason: null, attempt: ATTEMPT };
}
function frozen() {
  const value = prepared();
  return { kbId: value.kbId, snapshotId: OTHER, revision: 2, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: value.baseDraftHash, questionSetHash: value.context.questionSetHash, questionCount: value.questionSet.questions.length, payload: value.payload, questionSet: value.questionSet, context: value.context };
}
function editor() {
  const candidate = prepared();
  return { schemaVersion: "marketing-geo-kb-editor.v2" as const, kbId: V2_KB_ID, origin: "https://example.com", host: "example.com", draftVersion: 1, draftHash: candidate.baseDraftHash, profileCopyHash: candidate.profileCopyHash, payload: candidate.payload, requiresSave: false,
    profile: { ...candidate.context.profile, fullProfile: candidate.payload.profileCopy.profile }, frozen: frozen(), sourceReceipt: null, prepared: candidate, generations: { roles: generation("roles"), questions: generation("questions") } };
}

describe("browser-safe prepared knowledge wire", () => {
  it("requires the server-computed current copy identity for reusable proposal review", () => {
    const { profileCopyHash: _missing, ...without } = editor();
    expect(parseGeoKbEditorViewV2(without)).toBeNull();
  });
  it("preserves complete v2 review, source, entity and question metadata", () => {
    const value = prepared();
    expect(parseGeoKbPreparedWire(value)).toEqual(value);
    expect(parseGeoKbPreparedWire(value)?.payload.roles[0]?.alternatives).toEqual(["spreadsheets"]);
    expect(parseGeoKbPreparedWire(value)?.context.sourceSummary).toEqual(value.context.sourceSummary);
  });
  it.each(["kb", "candidate", "payload_hash", "locale", "profile_value", "profile_ref", "role_review", "fact_review", "competitors", "question_source", "foreign_entity_role", "method", "receipt", "missing_array", "unknown_key"])("refuses broken %s linkage instead of discarding fields", (kind) => {
    const value = structuredClone(prepared());
    if (kind === "kb") Object.assign(value.context, { kbId: OTHER });
    if (kind === "candidate") Object.assign(value.context, { candidateId: OTHER });
    if (kind === "payload_hash") Object.assign(value.context, { payloadHash: "d".repeat(64) });
    if (kind === "locale") Object.assign(value.questionSet, { country: "GB" });
    if (kind === "profile_value") Object.assign(value.context.profile, { productName: "Other product" });
    if (kind === "profile_ref") Object.assign(value.context.profile.reference, { snapshotId: OTHER });
    if (kind === "role_review") Object.assign(value.payload.roles[0]!, { review: "excluded" });
    if (kind === "fact_review") Object.assign(value.payload.facts[0]!, { review: "pending" });
    if (kind === "competitors") Object.assign(value.context, { competitors: [] });
    if (kind === "question_source") Object.assign(value.questionSet, { evidenceRefs: ["manual:r1", "foreign"] });
    if (kind === "foreign_entity_role") Object.assign(value.questionSet.entityCatalog[0]!, { roleId: "foreign" });
    if (kind === "method") Object.assign(value, { generatorVersion: "other-version" });
    if (kind === "receipt") Object.assign(value, { sourceReceiptRefs: [{ receiptId: OTHER, contentHash: "d".repeat(64) }] });
    if (kind === "missing_array") Object.assign(value.payload, { facts: undefined });
    if (kind === "unknown_key") Object.assign(value.payload, { secret: "unexpected" });
    expect(parseGeoKbPreparedWire(value)).toBeNull();
  });
  it("checks hash formats and links but does not claim cryptographic verification in the browser", () => {
    const value = prepared();
    expect(parseGeoKbPreparedWire({ ...value, candidateHash: "d".repeat(64) })).not.toBeNull();
    expect(parseGeoKbPreparedWire({ ...value, candidateHash: "not-a-hash" })).toBeNull();
  });
});

describe("browser-safe role proposals", () => {
  it("keeps the exact model input/output, source counts and source receipt identities", () => {
    const value = proposal();
    expect(parseGeoKbRoleProposalWire(value)).toEqual(value);
  });
  it.each(["foreign_ref", "missing_roles", "bad_counts", "duplicate_receipt", "unknown_flag", "missing_hash"])("rejects %s", (kind) => {
    const value = structuredClone(proposal());
    if (kind === "foreign_ref") Object.assign(value.output.roles[0]!, { evidenceRefs: ["unknown-model-ref"] });
    if (kind === "missing_roles") Object.assign(value.output, { roles: undefined });
    if (kind === "bad_counts") Object.assign(value.selectedEvidenceCounts, { gsc: 0 });
    if (kind === "duplicate_receipt") Object.assign(value, { sourceReceiptRefs: [{ receiptId: OTHER, contentHash: "a".repeat(64) }, { receiptId: OTHER, contentHash: "a".repeat(64) }] });
    if (kind === "unknown_flag") Object.assign(value.output.roles[0]!, { approved: true });
    if (kind === "missing_hash") Object.assign(value, { profileCopyHash: undefined });
    expect(parseGeoKbRoleProposalWire(value)).toBeNull();
  });
});

describe("public generation wire", () => {
  it.each(["roles", "questions"] as const)("parses the exact %s result instead of a truthy success marker", (kind) => {
    const value = generation(kind);
    expect(parseGeoKbGenerationWire(value)).toEqual(value);
  });
  it.each(["userId", "claimToken", "secret", "input"])("refuses internal capability field %s", (key) => {
    expect(parseGeoKbGenerationWire({ ...generation(), [key]: "must-not-be-public" })).toBeNull();
  });
  it.each(["wrong_kind", "foreign_kb", "foreign_generation", "empty_success", "absent_attempt", "attempt_unknown_key", "bad_attempt", "negative_tokens", "success_with_error"])("rejects %s", (kind) => {
    const value = structuredClone(generation());
    if (kind === "wrong_kind") Object.assign(value, { kind: "roles" });
    if (kind === "foreign_kb") Object.assign(value, { kbId: OTHER });
    if (kind === "foreign_generation") Object.assign(value, { generationId: OTHER });
    if (kind === "empty_success") Object.assign(value, { result: null });
    if (kind === "absent_attempt") Object.assign(value, { attempt: null });
    if (kind === "attempt_unknown_key") Object.assign(value.attempt, { apiKey: "unexpected" });
    if (kind === "bad_attempt") Object.assign(value.attempt, { attemptedCalls: 0 });
    if (kind === "negative_tokens") Object.assign(value.attempt, { inputTokens: -1 });
    if (kind === "success_with_error") Object.assign(value, { errorReason: "invalid_output" });
    expect(parseGeoKbGenerationWire(value)).toBeNull();
  });
  it("preserves claimed, dispatched, quota-failed and uncertain states without implying a result", () => {
    const base = generation();
    for (const state of ["claimed", "dispatched"] as const) {
      const value = { ...base, state, result: null, attempt: null };
      expect(parseGeoKbGenerationWire(value)).toEqual(value);
    }
    const quota = { ...base, state: "failed", result: null, errorReason: "quota_unavailable", attempt: null };
    expect(parseGeoKbGenerationWire(quota)).toEqual(quota);
    const uncertain = { ...base, state: "uncertain", result: null, errorReason: "outcome_unknown", attempt: { ...ATTEMPT, delivery: "outcome_unknown", requestCount: 0, inputTokens: null, outputTokens: null } };
    expect(parseGeoKbGenerationWire(uncertain)).toEqual(uncertain);
    expect(parseGeoKbGenerationWire({ ...uncertain, attempt: null })).toBeNull();
    expect(parseGeoKbGenerationWire({ ...uncertain, errorReason: "invalid_output" })).toBeNull();
  });
});

describe("exact frozen v2 wire", () => {
  it("accepts a separate frozen snapshot ID while preserving its prepared source context", () => {
    const value = frozen();
    expect(value.snapshotId).not.toBe(value.context.candidateId);
    expect(parseGeoKbFrozenV2Wire(value)).toEqual(value);
  });
  it.each(["count", "hash", "kb", "legacy", "missing_questions", "missing_context", "extra_field"])("refuses %s", (kind) => {
    const value = structuredClone(frozen());
    if (kind === "count") value.questionCount += 1;
    if (kind === "hash") value.questionSetHash = "d".repeat(64);
    if (kind === "kb") value.kbId = OTHER;
    if (kind === "legacy") Object.assign(value.payload, { schemaVersion: "marketing-geo-kb.v1" });
    if (kind === "missing_questions") Object.assign(value.questionSet, { questions: undefined });
    if (kind === "missing_context") Object.assign(value, { context: null });
    if (kind === "extra_field") Object.assign(value, { userId: OTHER });
    expect(parseGeoKbFrozenV2Wire(value)).toBeNull();
  });
});

describe("complete editor v2 DTO", () => {
  it("preserves the full editor view including source proposals, both generations and frozen content", () => {
    const value = editor();
    expect(parseGeoKbEditorViewV2(value)).toEqual(value);
  });
  it("allows stale candidates and newer Profile proposals without replacing the saved copy", () => {
    const value = editor();
    value.draftVersion = 3; value.draftHash = "e".repeat(64);
    value.profile = { ...value.profile, productName: "New Profile name", reference: { ...value.profile.reference, snapshotId: OTHER, snapshotRevision: 9, profileHash: "f".repeat(64) }, fullProfile: { ...value.profile.fullProfile, productName: "New Profile name" } };
    const parsed = parseGeoKbEditorViewV2(value);
    expect(parsed).toEqual(value);
    expect(parsed?.payload.profileCopy.profile.productName).toBe("Acme");
    expect(parsed?.prepared?.baseDraftVersion).toBe("1");
  });
  it("allows preview-only v1-to-v2 conversion with the original stored v1 hash", () => {
    const value = { ...editor(), requiresSave: true, draftHash: "d".repeat(64) };
    expect(parseGeoKbEditorViewV2(value)).toEqual(value);
    const first = { ...value, draftVersion: 0, draftHash: null };
    expect(parseGeoKbEditorViewV2(first)).toEqual(first);
    expect(parseGeoKbEditorViewV2({ ...first, requiresSave: false })).toBeNull();
  });
  it("renders an unfinished requires-save draft without inventing missing categories or market values", () => {
    const original = editor();
    const payload = { ...original.payload, officialName: "", aliases: [], categoryTerms: [], market: { country: "", language: "zh-Hant" } };
    const value = { ...original, payload, draftVersion: 0, draftHash: null, requiresSave: true, frozen: null, prepared: null, generations: { roles: null, questions: null } };
    expect(parseGeoKbEditorViewV2(value)).toEqual(value);
    expect(parseGeoKbEditorViewV2({ ...value, draftVersion: 1, draftHash: "d".repeat(64), requiresSave: false })).toBeNull();
  });
  it("keeps stored v1 metadata while rendering an incomplete v2 preview", () => {
    const value = editor();
    const preview = { ...value, requiresSave: true, draftHash: "e".repeat(64), payload: { ...value.payload, categoryTerms: [] } };
    expect(parseGeoKbEditorViewV2(preview)).toEqual(preview);
  });
  it.each(["fact_time", "missing_array", "unsafe_payload", "unsafe_role", "overlong_category"])("does not weaken pending draft %s safety", (kind) => {
    const value = editor(); value.requiresSave = true;
    if (kind === "fact_time") Object.assign(value.payload.facts[0]!, { observedAt: "" });
    if (kind === "missing_array") Object.assign(value.payload, { roles: null });
    if (kind === "unsafe_payload") Object.assign(value.payload, { claimToken: OTHER });
    if (kind === "unsafe_role") Object.assign(value.payload.roles[0]!, { roleInstructions: "unexpected" });
    if (kind === "overlong_category") Object.assign(value.payload, { categoryTerms: ["x".repeat(81)] });
    expect(parseGeoKbEditorViewV2(value)).toBeNull();
  });
  it("keeps a valid historical v1 summary without fabricating a v2 frozen context", () => {
    const old = { snapshotId: OTHER, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: "a".repeat(64), questionCount: 1, retrievalCount: 1 };
    const value = { ...editor(), frozen: old };
    expect(parseGeoKbEditorViewV2(value)).toEqual(value);
  });
  it("rejects malformed legacy payload arrays inside an otherwise valid old frozen summary", () => {
    const old = { snapshotId: OTHER, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: "a".repeat(64), questionCount: 1, retrievalCount: 1,
      payload: { schemaVersion: "marketing-geo-kb.v1", targetUrl: "https://example.com", facts: null } };
    expect(parseGeoKbEditorViewV2({ ...editor(), frozen: old })).toBeNull();
  });
  it("rejects invalid legacy frozen identity and content hashes", () => {
    const old = { snapshotId: "not-a-snapshot", revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: "not-a-hash", questionCount: 1, retrievalCount: 1 };
    expect(parseGeoKbEditorViewV2({ ...editor(), frozen: old })).toBeNull();
  });
  it("rejects current Profile summary fields that contradict its own full Profile", () => {
    const value = editor(); value.profile.productName = "Unrelated summary";
    expect(parseGeoKbEditorViewV2(value)).toBeNull();
  });
  it.each(["host", "payload_host", "foreign_prepared", "foreign_frozen", "wrong_generation_kind", "foreign_generation", "missing_generations", "missing_roles", "unsafe_profile", "unsafe_top"])("rejects %s without turning it into an empty state", (kind) => {
    const value = structuredClone(editor());
    if (kind === "host") value.host = "other.example";
    if (kind === "payload_host") Object.assign(value.payload, { targetUrl: "https://other.example" });
    if (kind === "foreign_prepared") Object.assign(value.prepared, { kbId: OTHER });
    if (kind === "foreign_frozen") Object.assign(value.frozen, { kbId: OTHER });
    if (kind === "wrong_generation_kind") value.generations.roles = value.generations.questions;
    if (kind === "foreign_generation") value.generations.roles.kbId = OTHER;
    if (kind === "missing_generations") Object.assign(value, { generations: undefined });
    if (kind === "missing_roles") Object.assign(value.payload, { roles: undefined });
    if (kind === "unsafe_profile") Object.assign(value.profile, { claimToken: "forbidden" });
    if (kind === "unsafe_top") Object.assign(value, { userId: OTHER });
    expect(parseGeoKbEditorViewV2(value)).toBeNull();
  });
  it("allows a stale same-site source receipt but rejects a foreign source host", () => {
    const sourceReceipt = { schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: OTHER, kbId: V2_KB_ID, targetHost: "example.com", draftVersion: 0, draftHash: "c".repeat(64), profileReference: null, createdAt: "2026-08-31T00:00:00.000Z", contentHash: "d".repeat(64), competitors: [], facts: [], gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } };
    const value = { ...editor(), sourceReceipt };
    expect(parseGeoKbEditorViewV2(value)).toEqual(value);
    expect(parseGeoKbEditorViewV2({ ...value, sourceReceipt: { ...sourceReceipt, targetHost: "other.example" } })).toBeNull();
  });
});

describe("browser dependency boundary", () => {
  it("parses without Node Buffer or crypto globals", () => {
    const candidate = prepared(), roles = proposal(), snapshot = frozen();
    try {
      vi.stubGlobal("Buffer", undefined); vi.stubGlobal("crypto", undefined);
      expect(parseGeoKbPreparedWire(candidate)).toEqual(candidate);
      expect(parseGeoKbRoleProposalWire(roles)).toEqual(roles);
      expect(parseGeoKbFrozenV2Wire(snapshot)).toEqual(snapshot);
    } finally { vi.unstubAllGlobals(); }
  });
  it("has no Node, stores, digest or server-only role/candidate runtime imports", () => {
    const root = fileURLToPath(new URL("./geo-kb-v2-wire.ts", import.meta.url)), seen = new Set<string>();
    const visit = (path: string): void => {
      if (seen.has(path)) return; seen.add(path);
      const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText;
      const file = ts.createSourceFile(path, compiled, ts.ScriptTarget.ES2022, true);
      for (const node of file.statements) {
        if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        const specifier = node.moduleSpecifier.text;
        expect(specifier).not.toMatch(/^(?:node:|fs$|crypto$)|(?:digest|store|server|kb-role-proposal|kb-prepared-contract|kb-synthesis\.ts)/u);
        if (specifier.startsWith(".")) visit(resolve(dirname(path), specifier));
        else expect(["zod", "@sf/public-tools/content-brief/text"]).toContain(specifier);
      }
    };
    visit(root);
  });
});

describe("v2 mutation response DTOs", () => {
  const saved = { draftVersion: 2, contentHash: "a".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: ["roles_pending"] };
  const frozen = { snapshotId: OTHER, revision: 3, frozenAt: saved.updatedAt, contentHash: saved.contentHash, questionSetHash: "b".repeat(64), questionCount: 10, reusedExisting: false };
  it("accepts exact save and freeze data without requiring legacy retrievalCount", () => {
    expect(parseGeoKbDraftSaveV2(saved)).toEqual(saved);
    expect(parseGeoKbFreezeV2Response(frozen)).toEqual(frozen);
  });
  it.each(["hash", "version", "time", "array", "extra"])("rejects malformed save %s", (kind) => {
    const value = { ...saved };
    if (kind === "hash") value.contentHash = "broken";
    if (kind === "version") value.draftVersion = 0;
    if (kind === "time") value.updatedAt = "not-a-date";
    if (kind === "array") Object.assign(value, { blockers: null });
    if (kind === "extra") Object.assign(value, { claimToken: OTHER });
    expect(parseGeoKbDraftSaveV2(value)).toBeNull();
  });
  it.each(["id", "question_hash", "count", "extra"])("rejects malformed freeze %s", (kind) => {
    const value = { ...frozen };
    if (kind === "id") value.snapshotId = "broken";
    if (kind === "question_hash") value.questionSetHash = "broken";
    if (kind === "count") value.questionCount = -1;
    if (kind === "extra") Object.assign(value, { claimToken: OTHER });
    expect(parseGeoKbFreezeV2Response(value)).toBeNull();
  });
});
