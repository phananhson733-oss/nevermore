import { describe, expect, it, vi } from "vitest";
import { GEO_CONTENT_BRIEF_SCHEMA, type GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { handleBriefRun, type BriefHandlerDependencies } from "./brief-handler.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import type { SharedBriefHandlerDependencies } from "./brief-shared-handler.ts";
const selection = { schema: GEO_CONTENT_BRIEF_SCHEMA, kbId: SHARED_FROZEN.kbId, snapshotId: SHARED_FROZEN.snapshotId, questionId: "q1", manualQuestion: null, runId: null, gapId: null };
function post(body: unknown): Request { return new Request("https://gengrowth.ai/api/tools/geo-brief/run", { method: "POST", headers: { "content-type": "application/json", origin: "https://gengrowth.ai" }, body: JSON.stringify(body) }); }
function dependencies(changes: Partial<SharedBriefHandlerDependencies> = {}) {
  const consume = vi.fn(async () => true); const sample = vi.fn();
  const deps: BriefHandlerDependencies = {
    authenticate: async () => ({ ok: true, userId: "fixture-owner" }), listFrozen: vi.fn(), readFrozen: vi.fn(), consumeDailyRun: consume, providerConfigured: () => false, sample, assemble: vi.fn(), reportAssemblyFailure: vi.fn(), now: () => Date.parse("2026-08-31T00:00:01Z"),
    shared: { readFrozen: async () => ({ kind: "ok", value: SHARED_FROZEN }), readContext: async () => ({ kind: "ok", value: null }), readRunEvidence: async () => ({ kind: "not_eligible" }), configured: () => true, runId: () => "fixture-brief", assemble: async brief => ({ ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: brief.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb"] } }] }), ...changes },
  };
  return { deps, consume, sample };
}
describe("shared GEO HTTP branch", () => {
  it("rejects a defective historical frozen question before quota and assembly", async () => {
    const frozen = { ...SHARED_FROZEN, payload: { ...SHARED_FROZEN.payload, categoryTerms: ["占星工具", "CBT 日记"] },
      questionSet: { ...SHARED_FROZEN.questionSet, questions: [{ ...SHARED_FROZEN.questionSet.questions[0]!,
        text: "What are the top 占星工具 tools right now?", requiredEntities: ["占星工具", "CBT 日记"] }] } };
    const assemble = vi.fn(async (brief: GeoContentBrief) => ({ ok: true as const, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: brief.must_answer.items.map(item => item.id), provenance: { method: "model" as const, derived_from: ["kb" as const] } }] }));
    const { deps, consume, sample } = dependencies({ readFrozen: async () => ({ kind: "ok", value: frozen }), assemble });
    const response = await handleBriefRun(post(selection), deps);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("question_needs_review");
    expect(consume).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled(); expect(sample).not.toHaveBeenCalled();
  });
  it("rejects mixed-language typed wording but permits an explicitly known Unicode brand", async () => {
    const frozen = { ...SHARED_FROZEN, payload: { ...SHARED_FROZEN.payload, officialName: "星图", aliases: ["星图"] } };
    const { deps, consume } = dependencies({ readFrozen: async () => ({ kind: "ok", value: frozen }) });
    const bad = await handleBriefRun(post({ ...selection, questionId: null, manualQuestion: "What are 占星工具 tools?" }), deps);
    expect(bad.status).toBe(422); expect(consume).not.toHaveBeenCalled();
    const good = await handleBriefRun(post({ ...selection, questionId: null, manualQuestion: "What does 星图 do?" }), deps);
    expect(good.status).toBe(200); expect(consume).toHaveBeenCalledOnce();
  });
  it.each(["es", "zh"])("refuses selected and typed questions against frozen %s before a Brief debit or assembly", async language => {
    const assemble = vi.fn();
    const frozen = { ...SHARED_FROZEN, payload: { ...SHARED_FROZEN.payload, market: { country: "US", language } }, questionSet: { ...SHARED_FROZEN.questionSet, language } };
    const { deps, consume } = dependencies({ readFrozen: async () => ({ kind: "ok", value: frozen }), assemble });
    expect((await handleBriefRun(post(selection), deps)).status).toBe(422); expect(consume).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled();
    expect((await handleBriefRun(post({ ...selection, questionId: null, manualQuestion: "A typed question?" }), deps)).status).toBe(422); expect(consume).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled();
  });
  it.each(["en-US", "en-GB"])("admits frozen %s and preserves its original metadata", async language => {
    const frozen = { ...SHARED_FROZEN, payload: { ...SHARED_FROZEN.payload, market: { country: "US", language } }, questionSet: { ...SHARED_FROZEN.questionSet, language } };
    const { deps, consume } = dependencies({ readFrozen: async () => ({ kind: "ok", value: frozen }) });
    const response = await handleBriefRun(post(selection), deps);
    expect(response.status).toBe(200); expect(consume).toHaveBeenCalledOnce();
    expect((await response.json()).data.brief.keyword.language).toBe(language);
  });
  it("uses owned A/D run evidence without performing another visibility sample", async () => {
    const readRunEvidence = vi.fn(async () => ({ kind: "ok" as const, value: { runId: "run-1", fingerprint: "e".repeat(64), gap: "D" as const, siteIndex: [{ id: "page-1", url: "https://fixture.example/tool", title: "Relevant tool", observed_at: "2026-08-31T00:00:00Z" }], samples: [1, 2].map(index => ({ id: `sample-${index}`, run_id: "run-1", question_id: "q1", engine: index === 1 ? "chatgpt" : "perplexity", collected_at: "2026-08-31T00:00:00Z", status: "answered" as const, search_enabled: true, excerpt: "Observed fixture answer.", topics: ["Pricing"] })) } }));
    const { deps, sample } = dependencies({ readRunEvidence });
    const response = await handleBriefRun(post({ ...selection, runId: "run-1", gapId: "gap-q1" }), deps);
    expect(response.status).toBe(200);
    const brief = (await response.json()).data.brief;
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
    expect(brief.geo_origin).toMatchObject({ kind: "visibility", gap: "D", run_ref: { id: "run-1" } });
    expect(brief.must_answer.items.find((item: { source: string }) => item.source === "ai_sample")).toMatchObject({ covered_by: 2, sample_total: 2 });
    expect(brief.format).toMatchObject({ value: "comparison", reason: "gap_d_comparison" });
    expect(brief.internal_links.items).toHaveLength(1);
    expect(readRunEvidence).toHaveBeenCalledOnce(); expect(sample).not.toHaveBeenCalled();
  });
  it("uses the same route but never samples a no-run question", async () => {
    const { deps, consume, sample } = dependencies();
    const response = await handleBriefRun(post(selection), deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect((await parseGeoContentBrief(body.data.brief)).ok).toBe(true);
    expect(body.data.brief.geo_origin.question.text).toBe(SHARED_FROZEN.questionSet.questions[0]!.text);
    expect(consume).toHaveBeenCalledOnce(); expect(sample).not.toHaveBeenCalled();
  });
  it("refuses client text for a selected question before any debit", async () => {
    const { deps, consume } = dependencies();
    expect((await handleBriefRun(post({ ...selection, manualQuestion: "client replacement" }), deps)).status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
  });
  it.each(["missing", "context", "gap"])("refuses %s evidence before debit", async failure => {
    const { deps, consume } = dependencies(failure === "missing" ? { readFrozen: async () => ({ kind: "not_found" }) } : failure === "context" ? { readContext: async () => ({ kind: "unavailable", reason: "unavailable" }) } : {});
    const response = await handleBriefRun(post(failure === "gap" ? { ...selection, runId: "run-1", gapId: "C-gap" } : selection), deps);
    expect(response.status).toBe(failure === "missing" ? 404 : failure === "context" ? 503 : 422);
    expect(consume).not.toHaveBeenCalled();
  });
});
