import { describe, expect, it, vi } from "vitest";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { parseSharedGeoOutline, runSharedGeoBriefLlm } from "./brief-shared-llm.ts";
import type { KeywordLlmRequest } from "../tools/keyword-llm-client.ts";
import { runSharedBrief, type SharedBriefHandlerDependencies } from "./brief-shared-handler.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import { GEO_CONTENT_BRIEF_SCHEMA } from "@sf/public-tools/content-brief/geo-contract";
import { geoQuestionProperNames } from "./question-quality.ts";
describe("shared GEO outline boundary", () => {
  it.each(["en", "en-US", "en-GB"])("rejects non-English natural-language H2/H3 for %s", async language => {
    const brief = await geoBriefFixture();
    brief.keyword.language = language;
    const answers = brief.must_answer.items.map(item => item.id);
    for (const row of [
      { h2: "合盘使用说明", h3: [], answers },
      { h2: "Astrology overview", h3: ["心理占星 and self-exploration"], answers },
    ]) {
      expect(parseSharedGeoOutline({ outline: [row] }, brief)).toEqual({ ok: false, reason: "validation_failed" });
    }
  });

  it("only exempts exact server-provided Unicode proper names, not neighboring non-English wording", async () => {
    const brief = await geoBriefFixture();
    const answers = brief.must_answer.items.map(item => item.id);
    expect(parseSharedGeoOutline({ outline: [{ h2: "Using 星图", h3: ["星图 and 小米"], answers }] }, brief, ["星图", "小米"]).ok).toBe(true);
    expect(parseSharedGeoOutline({ outline: [{ h2: "Using 星图", h3: ["星图的功能说明"], answers }] }, brief, ["星图", "小米"]).ok).toBe(false);
    expect(parseSharedGeoOutline({ outline: [{ h2: "Using 陌生品牌", h3: [], answers }] }, brief, ["星图"]).ok).toBe(false);
  });

  it("checks new model output with ephemeral proper names and instructs against entity-list H3 expansion", async () => {
    const brief = await geoBriefFixture();
    const original = JSON.stringify(brief);
    const complete = vi.fn(async (_request: KeywordLlmRequest) => ({ content: JSON.stringify({ outline: [{ h2: "Using 星图", h3: ["星图 overview"], answers: brief.must_answer.items.map(item => item.id) }] }), usage: { inputTokens: 10, outputTokens: 10, requestCount: 1, retryCount: 0 }, modelId: "offline" }));
    const reply = await runSharedGeoBriefLlm(brief, { properNames: ["星图"], config: { apiKey: "offline", model: "offline", url: "https://fixture.example/completions", authScheme: "bearer", temperature: null }, client: { complete } });
    expect(reply.ok).toBe(true);
    expect(complete.mock.calls[0]?.[0].system).toContain("Every heading must address the selected question or a supplied Q requirement.");
    expect(complete.mock.calls[0]?.[0].system).toContain("Required entities are not automatically separate H3 topics.");
    expect(JSON.stringify(brief)).toBe(original);
  });

  it("passes owned frozen names only as assembly options, never into the output Brief", async () => {
    const frozen = structuredClone(SHARED_FROZEN);
    Object.assign(frozen.payload, { officialName: "星图", aliases: ["StarMap"], competitors: [{ domain: "rival.test", brandName: "小米", aliases: ["Xiaomi"], confirmed: true }] });
    Object.assign(frozen.questionSet.questions[0]!, { text: "What is 星图?", requiredEntities: ["星图"] });
    const assemble = vi.fn<SharedBriefHandlerDependencies["assemble"]>(async brief => ({ ok: true, outline: [{ id: "O1", h2: "Overview", h3: [], answers: brief.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb"] } }] }));
    const deps: SharedBriefHandlerDependencies = { readFrozen: async () => ({ kind: "ok", value: frozen }), readContext: async () => ({ kind: "ok", value: null }), readRunEvidence: async () => ({ kind: "not_eligible" }), configured: () => true, assemble, runId: () => "offline-run" };
    const response = await runSharedBrief("owner", { schema: GEO_CONTENT_BRIEF_SCHEMA, kbId: frozen.kbId, snapshotId: frozen.snapshotId, questionId: "q1", manualQuestion: null, runId: null, gapId: null }, deps, async () => true, () => Date.parse("2026-08-31T00:00:00Z"));
    expect(response.status).toBe(200);
    expect(assemble.mock.calls[0]?.[1]).toEqual({ properNames: geoQuestionProperNames(frozen.payload) });
    const body = await response.json();
    expect(body.data.brief).not.toHaveProperty("properNames");
    expect(JSON.stringify(body.data.brief)).not.toContain('"Xiaomi"');
  });

  it.each(["es", "zh"])("refuses %s in the direct assembly helper before config or provider work", async language => {
    const brief = await geoBriefFixture(); brief.keyword.language = language; const complete = vi.fn();
    expect(await runSharedGeoBriefLlm(brief, { config: null, client: { complete } })).toEqual({ ok: false, reason: "unsupported_language" });
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(["en-US", "en-GB"])("uses English primary for %s without changing the stored locale", async language => {
    const brief = await geoBriefFixture(); brief.keyword.language = language;
    const complete = vi.fn(async (_request: KeywordLlmRequest) => ({ content: JSON.stringify({ outline: [{ h2: "Direct answer", h3: [], answers: brief.must_answer.items.map(item => item.id) }] }), usage: { inputTokens: 10, outputTokens: 10, requestCount: 1, retryCount: 0 }, modelId: "offline" }));
    const reply = await runSharedGeoBriefLlm(brief, { config: { apiKey: "offline", model: "offline", url: "https://fixture.example/completions", authScheme: "bearer", temperature: null }, client: { complete } });
    expect(reply.ok).toBe(true); expect(complete.mock.calls[0]?.[0].user).toContain('"language":"en"'); expect(brief.keyword.language).toBe(language);
  });
  it("accepts repeated cross-section coverage and supplemental sections, without changing requirements", async () => {
    const brief = await geoBriefFixture();
    expect(parseSharedGeoOutline({ outline: [{ h2: "Direct answer", h3: [], answers: ["Q1"] }, { h2: "Details", h3: [], answers: ["Q1", "Q2"] }, { h2: "Further reading", h3: [], answers: [] }] }, brief)).toMatchObject({ ok: true });
  });
  it.each(["dropped", "invented", "duplicates", "extra_key"])("rejects %s requirement edits", async problem => {
    const brief = await geoBriefFixture();
    const value = { outline: [{ h2: "Answer", h3: [], answers: problem === "dropped" ? ["Q1"] : problem === "invented" ? ["Q1", "M1"] : problem === "duplicates" ? ["Q1", "Q1", "Q2"] : ["Q1", "Q2"] }] };
    if (problem === "extra_key") Object.assign(value, { must_answer: [] });
    expect(parseSharedGeoOutline(value, brief).ok).toBe(false);
  });
});
