import { describe, expect, it, vi } from "vitest";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { parseSharedGeoOutline, runSharedGeoBriefLlm } from "./brief-shared-llm.ts";
import type { KeywordLlmRequest } from "../tools/keyword-llm-client.ts";
describe("shared GEO outline boundary", () => {
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
