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

const profileStore = vi.hoisted(() => ({ read: vi.fn(() => { throw new Error("Profile store must not be read by GEO consumers"); }) }));
vi.mock("../account-websites/store.ts", () => ({ findAccountWebsiteByUrl: profileStore.read, resolveWebsiteProfileReference: profileStore.read }));
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
  };
  return { sourceProfile, profileCopy, snapshot, context, dependencies };
}

function rehashContext(context: GeoSnapshotContext): void {
  const { contentHash: _old, ...body } = context;
  Object.assign(context, { contentHash: geoSnapshotContextHash(body) });
}

describe("complete immutable GEO knowledge-base reads", () => {
  it("returns all persisted Profile fields while the Profile store is unavailable", async () => {
    const value = fixture();
    const result = await readCompleteGeoKnowledgeBase(input, value.dependencies);
    expect(result).toEqual({ kind: "ok", value: { snapshot: value.snapshot, context: value.context, completeness: "complete" } });
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
  });

  it.each(["payload", "questions", "selector", "revision"])("rejects a mismatched frozen %s", async (part) => {
    const value = fixture();
    if (part === "payload") Object.assign(value.snapshot.payload, { officialName: "Tampered" });
    if (part === "questions") Object.assign(value.snapshot.questionSet.questions[0]!, { text: "Tampered question" });
    if (part === "selector") Object.assign(value.snapshot, { snapshotId: CONTEXT_PROFILE.reference.snapshotId });
    if (part === "revision") Object.assign(value.snapshot, { revision: 4 });
    const selector = part === "revision" ? { userId: USER, kbId: CONTEXT_KB_ID, revision: 3 } : input;
    expect((await readCompleteGeoKnowledgeBase(selector, value.dependencies)).kind).toBe("unavailable");
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
