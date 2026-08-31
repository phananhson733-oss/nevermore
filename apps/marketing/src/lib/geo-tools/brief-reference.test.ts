import { describe, expect, it, vi } from "vitest";
import { geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { assembleSharedGeoBrief, sharedGeoBriefBasis } from "./brief-shared.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import { verifyOwnedGeoBrief, type GeoBriefReferenceDependencies } from "./brief-reference.ts";
import { CONTENT_DRAFT_HANDLER_DEPENDENCIES } from "../tools/content-draft-handler.ts";
import type { GeoKbFrozenSnapshot } from "./kb-store.ts";

async function fixture(frozen: GeoKbFrozenSnapshot = SHARED_FROZEN, questionId: string | null = "q1", questionText = "") {
  const basis = sharedGeoBriefBasis({ frozen, context: null, questionId, questionText, runEvidence: null, runId: "offline-brief", now: "2026-08-31T00:00:00.000Z" });
  const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map((q) => q.id), provenance: { method: "model", derived_from: ["kb"] } }] });
  const dependencies: GeoBriefReferenceDependencies = {
    readFrozen: vi.fn(async () => ({ kind: "ok" as const, value: frozen })),
    readContext: vi.fn(async () => ({ kind: "ok" as const, value: null })),
    readRun: vi.fn(async () => ({ kind: "missing" as const })),
    readRunEvidence: vi.fn(async () => ({ kind: "not_found" as const })),
  };
  return { brief, dependencies };
}
async function rehash(brief: GeoContentBrief) { brief.run.fingerprint = await geoFingerprint(brief); return brief; }

describe("server-owned GEO Brief verification", () => {
  it("keeps a historic mixed-language Brief parseable but refuses Draft with an expected quality error", async () => {
    const frozen = structuredClone(SHARED_FROZEN);
    Object.assign(frozen.payload, { categoryTerms: ["占星工具", "心理占星"] });
    Object.assign(frozen.questionSet, { registryVersion: "2026-08-17/13" });
    Object.assign(frozen.questionSet.questions[0]!, { text: "What are the top 占星工具 tools right now?", requiredEntities: ["占星工具", "心理占星"] });
    const { brief, dependencies } = await fixture(frozen);
    const original = JSON.stringify(brief);
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
    await expect(verifyOwnedGeoBrief(brief, "account-a", dependencies)).rejects.toMatchObject({ name: "GeoBriefQuestionNeedsReview" });
    expect(JSON.stringify(brief)).toBe(original);
  });

  it("does not disclose a quality diagnosis before ownership and protected equality succeed", async () => {
    const frozen = structuredClone(SHARED_FROZEN);
    Object.assign(frozen.payload, { categoryTerms: ["占星工具"] });
    Object.assign(frozen.questionSet.questions[0]!, { text: "What are the top 占星工具 tools right now?", requiredEntities: ["占星工具"] });
    const { brief, dependencies } = await fixture(frozen);
    vi.mocked(dependencies.readFrozen).mockResolvedValueOnce({ kind: "missing" });
    expect(await verifyOwnedGeoBrief(brief, "another-account", dependencies)).toBe(false);
    vi.mocked(dependencies.readFrozen).mockResolvedValueOnce({ kind: "ok", value: { ...frozen, snapshotId: "foreign-snapshot" } });
    expect(await verifyOwnedGeoBrief(brief, "another-account", dependencies)).toBe(false);
    expect(dependencies.readContext).not.toHaveBeenCalled();
    const forged = structuredClone(brief);
    forged.evidence.facts[0]!.text = "Nine hundred seats";
    forged.fact_table[0]!.value = "Nine hundred seats";
    await rehash(forged);
    expect((await parseGeoContentBrief(forged)).ok).toBe(true);
    expect(await verifyOwnedGeoBrief(forged, "account-a", dependencies)).toBe(false);
  });

  it("checks typed-question wording without banning owned Unicode brand names", async () => {
    const frozen = structuredClone(SHARED_FROZEN);
    Object.assign(frozen.payload, { officialName: "星图", aliases: ["星图"], categoryTerms: ["astrology"] });
    const valid = await fixture(frozen, null, "What is 星图 and who is it for?");
    expect(await verifyOwnedGeoBrief(valid.brief, "account-a", valid.dependencies)).toBe(true);
    const invalid = await fixture(frozen, null, "What are the top 占星工具 tools right now?");
    await expect(verifyOwnedGeoBrief(invalid.brief, "account-a", invalid.dependencies)).rejects.toMatchObject({ name: "GeoBriefQuestionNeedsReview" });
    Object.assign(frozen.questionSet.questions[0]!, { text: "What is 星图 and who is it for?", requiredEntities: ["星图"] });
    const selected = await fixture(frozen);
    expect(await verifyOwnedGeoBrief(selected.brief, "account-a", selected.dependencies)).toBe(true);
  });

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
    const { brief, dependencies } = await fixture();
    vi.mocked(dependencies.readFrozen).mockResolvedValue({ kind: "missing" });
    expect(await verifyOwnedGeoBrief(brief, "another-account", dependencies)).toBe(false);
    expect(dependencies.readContext).not.toHaveBeenCalled();
    vi.mocked(dependencies.readFrozen).mockResolvedValue({ kind: "ok", value: SHARED_FROZEN });
    vi.mocked(dependencies.readContext).mockResolvedValue({ kind: "unavailable" });
    await expect(verifyOwnedGeoBrief(brief, "account-a", dependencies)).rejects.toThrow("GEO reference store unavailable");
  });
  it("does not accept an imported visibility origin without a server-owned run", async () => {
    const { dependencies } = await fixture();
    const runEvidence = { runId: "unowned-run", fingerprint: "c".repeat(64), gap: "D" as const, samples: [{ id: "slot-1", run_id: "unowned-run", question_id: "q1", engine: "chatgpt", collected_at: "2026-08-31T00:00:00.000Z", status: "answered" as const, search_enabled: true, excerpt: "Observed offline answer", topics: ["Setup"] }], siteIndex: [] };
    const basis = sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context: null, questionId: "q1", questionText: "", runEvidence, runId: "brief-run", now: "2026-08-31T00:00:00.000Z" });
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Compare", h3: [], answers: basis.must_answer.items.map((q) => q.id), provenance: { method: "model", derived_from: ["kb", "ai_sample"] } }] });
    expect(await verifyOwnedGeoBrief(brief, "account-a", dependencies)).toBe(false);
    expect(dependencies.readRun).toHaveBeenCalledWith({ userId: "account-a", runId: "unowned-run" });
    expect(dependencies.readRunEvidence).not.toHaveBeenCalled();
  });
});
