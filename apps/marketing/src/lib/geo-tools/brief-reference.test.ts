import { describe, expect, it, vi } from "vitest";
import { geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { assembleSharedGeoBrief, sharedGeoBriefBasis } from "./brief-shared.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import { verifyOwnedGeoBrief, type GeoBriefReferenceDependencies } from "./brief-reference.ts";
import { CONTENT_DRAFT_HANDLER_DEPENDENCIES } from "../tools/content-draft-handler.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoQuestionSetDigest } from "./kb-questions.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import { emptyMarketingWebsiteProfile, profileSha256 } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { CONTEXT_KB_ID, CONTEXT_PROFILE } from "./snapshot-context.test-fixtures.ts";
import { buildGeoSnapshotContext, geoSnapshotContextHash } from "./snapshot-context.ts";
import { inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";

async function fixture(complete = false) {
  const profile = { ...emptyMarketingWebsiteProfile(), productName: "Fixture", country: "US", locale: "en" };
  const copy = createGeoProfileCopy({ ...CONTEXT_PROFILE.reference, profileHash: await profileSha256(profile) }, profile);
  const payload = { ...SHARED_FROZEN.payload, ...(complete ? { profileCopy: copy } : {}) };
  const frozen = { ...structuredClone(SHARED_FROZEN), ...(complete ? { kbId: CONTEXT_KB_ID, snapshotId: "11111111-1111-4111-8111-111111111119" } : {}), payload, contentHash: geoKbDigest(payload as unknown as GeoKbValue), questionSetHash: geoQuestionSetDigest(SHARED_FROZEN.questionSet) };
  const basis = sharedGeoBriefBasis({ frozen, context: null, questionId: "q1", questionText: "", runEvidence: null, runId: "offline-brief", now: "2026-08-31T00:00:00.000Z" });
  const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map((q) => q.id), provenance: { method: "model", derived_from: ["kb"] } }] });
  const dependencies: GeoBriefReferenceDependencies = {
    readFrozen: vi.fn(async () => ({ kind: "ok" as const, value: frozen })),
    readContext: vi.fn(async () => ({ kind: "ok" as const, value: null })),
    readRun: vi.fn(async () => ({ kind: "missing" as const })),
    readRunEvidence: vi.fn(async () => ({ kind: "not_found" as const })),
  };
  return { brief, dependencies, frozen };
}
async function rehash(brief: GeoContentBrief) { brief.run.fingerprint = await geoFingerprint(brief); return brief; }

describe("server-owned GEO Brief verification", () => {
  it("is wired into the real shared Draft runtime", () => {
    expect(CONTENT_DRAFT_HANDLER_DEPENDENCIES.verifyGeoBrief).toBe(verifyOwnedGeoBrief);
  });
  it("rebuilds manual selected-question authority from the exact owned snapshot", async () => {
    const { brief, dependencies } = await fixture();
    expect(await verifyOwnedGeoBrief(brief, "account-a", dependencies)).toBe(true);
    expect(dependencies.readFrozen).toHaveBeenCalledWith({ userId: "account-a", kbId: SHARED_FROZEN.kbId, snapshotId: SHARED_FROZEN.snapshotId });
    expect(dependencies.readRun).not.toHaveBeenCalled();
  });
  it("rejects forged facts even when the attacker recomputes a valid public fingerprint", async () => {
    const { brief, dependencies } = await fixture();
    const forged = structuredClone(brief);
    forged.evidence.facts[0]!.text = "Nine hundred seats";
    forged.fact_table[0]!.value = "Nine hundred seats";
    await rehash(forged);
    expect((await parseGeoContentBrief(forged)).ok).toBe(true);
    expect(await verifyOwnedGeoBrief(forged, "account-a", dependencies)).toBe(false);
  });
  it("refuses mismatched snapshot revisions without substituting the latest version", async () => {
    const { brief, dependencies } = await fixture();
    const forged = structuredClone(brief);
    forged.geo_origin.kb_ref.revision = 7;
    await rehash(forged);
    expect(await verifyOwnedGeoBrief(forged, "account-a", dependencies)).toBe(false);
    expect(dependencies.readFrozen).toHaveBeenCalledTimes(1);
  });
  it("allows model-owned outline text without allowing it to rewrite immutable facts", async () => {
    const { brief, dependencies } = await fixture();
    if (brief.outline.status !== "available") throw new Error("fixture");
    brief.outline.items[0].h2 = "Another editorial heading";
    await rehash(brief);
    expect(await verifyOwnedGeoBrief(brief, "account-a", dependencies)).toBe(true);
  });
  it("treats a missing owned snapshot as invalid and a source-store outage as unavailable", async () => {
    const { brief, dependencies, frozen } = await fixture();
    vi.mocked(dependencies.readFrozen).mockResolvedValue({ kind: "missing" });
    expect(await verifyOwnedGeoBrief(brief, "another-account", dependencies)).toBe(false);
    expect(dependencies.readContext).not.toHaveBeenCalled();
    vi.mocked(dependencies.readFrozen).mockResolvedValue({ kind: "ok", value: frozen });
    vi.mocked(dependencies.readContext).mockResolvedValue({ kind: "unavailable" });
    await expect(verifyOwnedGeoBrief(brief, "account-a", dependencies)).rejects.toThrow("GEO reference store unavailable");
  });
  it("does not accept an imported visibility origin without a server-owned run", async () => {
    const { dependencies, frozen } = await fixture();
    const runEvidence = { runId: "unowned-run", fingerprint: "c".repeat(64), gap: "D" as const, samples: [{ id: "slot-1", run_id: "unowned-run", question_id: "q1", engine: "chatgpt", collected_at: "2026-08-31T00:00:00.000Z", status: "answered" as const, search_enabled: true, excerpt: "Observed offline answer", topics: ["Setup"] }], siteIndex: [] };
    const basis = sharedGeoBriefBasis({ frozen, context: null, questionId: "q1", questionText: "", runEvidence, runId: "brief-run", now: "2026-08-31T00:00:00.000Z" });
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Compare", h3: [], answers: basis.must_answer.items.map((q) => q.id), provenance: { method: "model", derived_from: ["kb", "ai_sample"] } }] });
    expect(await verifyOwnedGeoBrief(brief, "account-a", dependencies)).toBe(false);
    expect(dependencies.readRun).toHaveBeenCalledWith({ userId: "account-a", runId: "unowned-run" });
    expect(dependencies.readRunEvidence).not.toHaveBeenCalled();
  });
  it("requires the complete GEO context before accepting a copied Profile for Draft", async () => {
    const { brief, dependencies } = await fixture(true);
    await expect(verifyOwnedGeoBrief(brief, "account-a", dependencies)).rejects.toThrow("GEO reference store unavailable");
    expect(dependencies.readRun).not.toHaveBeenCalled();
    expect(dependencies.readRunEvidence).not.toHaveBeenCalled();
  });
  it("accepts complete frozen Profile evidence through the actual Draft verifier", async () => {
    const { dependencies, frozen } = await fixture(true);
    const profile = inheritedProfileFromCopy(frozen.payload.profileCopy!);
    const prepared = buildGeoSnapshotContext({ kbId: frozen.kbId, targetHost: "fixture.example", payload: frozen.payload, profile, receipt: null });
    const { contentHash: _old, ...preparedBody } = prepared.context;
    const body = { ...preparedBody, questionSetHash: frozen.questionSetHash };
    const context = { ...body, contentHash: geoSnapshotContextHash(body) };
    vi.mocked(dependencies.readContext).mockResolvedValue({ kind: "ok", value: context });
    const basis = sharedGeoBriefBasis({ frozen, context, questionId: "q1", questionText: "", runEvidence: null, runId: "complete-brief", now: "2026-08-31T00:00:00.000Z" });
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map(q => q.id), provenance: { method: "model", derived_from: ["kb"] } }] });
    expect(await verifyOwnedGeoBrief(brief, "account-a", dependencies)).toBe(true);
    expect(brief.geo_origin.profile_ref?.profile_hash).toBe(frozen.payload.profileCopy?.profileHash);
  });
});
