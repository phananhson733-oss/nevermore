import { describe, expect, it, vi } from "vitest";
import { generateDraftSection, runDraftCoverage, type DraftSectionInput } from "./content-draft-llm.ts";
import type { KeywordLlmConfig, KeywordLlmRequest } from "./keyword-llm-client.ts";
const NOW = 1800000000000;
const config: KeywordLlmConfig = { apiKey: "offline-test", model: "offline", url: "https://fixture.example/completions", authScheme: "bearer", temperature: null };
const usage = { inputTokens: 10, outputTokens: 10, requestCount: 1, retryCount: 0 };
function input(language: string): DraftSectionInput { return { section: { id: "O1", h2: "Workflow", h3: [], answers: ["Q1"] }, questions: [{ id: "Q1", q: "Explain the workflow", members: [] }], pages: [], facts: [], gapAngle: null, geo: { facts: [], missingFacts: [], requiredEntities: [] }, settings: { tone: "explanatory", person: "second", product_mention: "none" }, language, primary: "workflow", deadlineAt: NOW + 120000 }; }
describe("GEO generation language boundary", () => {
  it.each(["es", "zh", "fr"])("refuses %s before a section or coverage provider call", async language => {
    const complete = vi.fn(async (_request: KeywordLlmRequest) => ({ content: JSON.stringify({ paragraphs: [{ sentences: [{ text: "Review the workflow.", claim: "no_claim", evidence_refs: [] }] }] }), usage, modelId: "offline" }));
    await expect(generateDraftSection(input(language), { config, client: { complete }, now: () => NOW })).rejects.toThrow("GEO");
    const coverage = { source: "geo" as const, primary: "workflow", language, questions: [{ id: "Q1", q: "Explain workflow" }], sections: [{ id: "O1", h2: "Workflow", text: "Review the workflow." }], deadlineAt: NOW + 120000 };
    await expect(runDraftCoverage(coverage, { config, client: { complete }, now: () => NOW })).rejects.toThrow("GEO");
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(["en-US", "en-GB"])("generates %s via English primary without rewriting the input locale", async language => {
    const section = input(language);
    const complete = vi.fn(async (_request: KeywordLlmRequest) => ({ content: JSON.stringify({ paragraphs: [{ sentences: [{ text: "Review the workflow.", claim: "no_claim", evidence_refs: [] }] }] }), usage, modelId: "offline" }));
    expect((await generateDraftSection(section, { config, client: { complete }, now: () => NOW })).status).toBe("ok");
    expect(complete.mock.calls[0]?.[0].user).toContain("English");
    expect(section.language).toBe(language);
    const coverageCall = vi.fn(async (_request: KeywordLlmRequest) => ({ content: JSON.stringify({ items: [{ question_id: "Q1", status: "covered", covered_in: "O1", gap: null }] }), usage, modelId: "offline" }));
    const coverage = { source: "geo" as const, primary: "workflow", language, questions: [{ id: "Q1", q: "Explain workflow" }], sections: [{ id: "O1", h2: "Workflow", text: "Review the workflow." }], deadlineAt: NOW + 120000 };
    expect((await runDraftCoverage(coverage, { config, client: { complete: coverageCall }, now: () => NOW })).reads.status).toBe("complete");
    expect(coverageCall.mock.calls[0]?.[0].user).toContain("English");
    expect(coverage.language).toBe(language);
  });
  it("preserves legacy SEO Spanish generation", async () => {
    const { geo: _geo, ...legacy } = input("es");
    const complete = vi.fn(async () => ({ content: JSON.stringify({ paragraphs: [{ sentences: [{ text: "Revise el flujo de trabajo.", claim: "no_claim", evidence_refs: [] }] }] }), usage, modelId: "offline" }));
    expect((await generateDraftSection(legacy, { config, client: { complete }, now: () => NOW })).status).toBe("ok");
    expect(complete).toHaveBeenCalledOnce();
  });
});
