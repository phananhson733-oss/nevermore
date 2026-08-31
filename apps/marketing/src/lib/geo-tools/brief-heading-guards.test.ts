import { describe, expect, it, vi } from "vitest";
import { geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { aggregateSectionLlm, assembleDraftResult } from "@sf/public-tools/content-brief/draft-assemble";
import { parseDraftResult, sectionEvidenceFor } from "@sf/public-tools/content-brief/parse-draft";
import { validateSectionOutput } from "@sf/public-tools/content-brief/validate-section";
import { DRAFT_TOTAL_BUDGET_MS } from "@sf/public-tools/content-brief/constants";
import { assembleSharedGeoBrief, sharedGeoBriefBasis } from "./brief-shared.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import { parseSharedGeoOutline } from "./brief-shared-llm.ts";
import { verifyOwnedGeoBrief, type GeoBriefReferenceDependencies } from "./brief-reference.ts";

async function fixture() {
  const basis = sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context: null, questionId: "q1", questionText: "", runEvidence: null, runId: "fixture-brief", now: "2026-08-31T00:00:01Z" });
  const item = { id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map(q => q.id), provenance: { method: "model" as const, derived_from: ["kb" as const] } };
  const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [item] });
  const dependencies: GeoBriefReferenceDependencies = { readFrozen: vi.fn(async () => ({ kind: "ok" as const, value: SHARED_FROZEN })), readContext: vi.fn(async () => ({ kind: "ok" as const, value: null })), readRun: vi.fn(async () => ({ kind: "missing" as const })), readRunEvidence: vi.fn(async () => ({ kind: "not_found" as const })) };
  return { basis, brief, item, dependencies };
}
describe("GEO headline evidence guards", () => {
  it.each(["h2", "h3"] as const)("rejects unsupported numerical %s in model reply, assembler, owner verification and Draft reparse", async field => {
    const { basis, brief, item, dependencies } = await fixture();
    const unsafe = field === "h2" ? { ...item, h2: "Price is USD 999 per month" } : { ...item, h3: ["Includes 900 seats"] };
    expect(parseSharedGeoOutline({ outline: [{ h2: unsafe.h2, h3: unsafe.h3, answers: unsafe.answers }] }, basis).ok).toBe(false);
    await expect(assembleSharedGeoBrief(basis, { ok: true, outline: [unsafe] })).rejects.toThrow("shared_brief_invalid");
    brief.outline = { status: "available", items: [unsafe] }; brief.run.fingerprint = await geoFingerprint(brief);
    expect((await parseGeoContentBrief(brief)).ok).toBe(false);
    expect(await verifyOwnedGeoBrief(brief, "owner", dependencies)).toBe(false);
    const settings = { tone: "explanatory", person: "second", product_mention: "throughout" } as const;
    const checked = validateSectionOutput({ paragraphs: [{ sentences: [{ text: "Three seats.", claim: "bound", evidence_refs: ["K1"] }] }] }, sectionEvidenceFor(brief, "O1", settings));
    if (!checked.ok) throw new Error(checked.rule);
    const draft = await assembleDraftResult({ brief, settings, run: { run_id: "fixture-draft", reran_from: null, collected_at: "2026-08-31T00:00:02Z", elapsed_ms: 0, budget_ms: DRAFT_TOTAL_BUDGET_MS }, sections: [{ id: "O1", h2: unsafe.h2, answers: unsafe.answers, status: "ok", body: { word_count: checked.word_count, paragraphs: checked.paragraphs }, llm: { attempts: 1, input_tokens: 10, output_tokens: 10 } }], coverage: { status: "available", items: unsafe.answers.map(question_id => ({ question_id, status: "covered", covered_in: "O1", gap: null, method: "model", cause: null })), total: unsafe.answers.length, covered: unsafe.answers.length, partial: 0, none: 0, provenance: { method: "model", derived_from: [] } }, llmSections: aggregateSectionLlm([{ status: "ok", attempts: 1, fail_reason: null, model_id: "fixture", temperature_requested: 0.4, temperature_effective: null, input_tokens: 10, output_tokens: 10 }], 0.4), llmCoverage: { status: "complete", calls: 1, model_id: "fixture", temperature_requested: 0, temperature_effective: null, input_tokens: 10, output_tokens: 10 } });
    expect(draft.verify_before_publish).toEqual([]);
    expect((await parseDraftResult(draft, brief)).ok).toBe(false);
  });
  it.each(["Pricing", "Pricing options", "Three seats", "Seats: Three seats"])("preserves neutral or exact supported headline %s", async h2 => {
    const { basis, item } = await fixture();
    expect(parseSharedGeoOutline({ outline: [{ h2, h3: [], answers: item.answers }] }, basis).ok).toBe(true);
  });
  it.each(["Pricing is free", "Three unsupported editorial steps"])("refuses unsupported headline %s", async h2 => {
    const { basis, item } = await fixture();
    expect(parseSharedGeoOutline({ outline: [{ h2, h3: [], answers: item.answers }] }, basis).ok).toBe(false);
  });
});
