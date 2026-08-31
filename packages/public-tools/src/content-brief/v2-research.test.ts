import { describe, expect, it } from "vitest";
import * as research from "./v2-research.ts";
import { measureResearchLength, RESEARCH_BUNDLE_MAX_BYTES, type ResearchPage, type ResearchPaaQuestion } from "./v2-contract.ts";

function page(id: string, text: string, role: "competitor" | "owned" = "competitor", finalUrl = `https://example.com/${id}`): ResearchPage {
  return {
    id, role, url: finalUrl, final_url: finalUrl, fetched_at: "2026-08-31T00:00:00.000Z", content_hash: "a".repeat(64), body_complete: true,
    research: { segments: [{ heading: null, text, truncated: false }], segments_total: 1, omitted_segments: 0, length: measureResearchLength(text, "en") },
  };
}

function bundle(pages: readonly ResearchPage[], paa: readonly ResearchPaaQuestion[] = []) {
  expect(research.buildResearchBundle).toBeTypeOf("function");
  const built = research.buildResearchBundle(pages, paa);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.path);
  return built.value;
}

const paraphrases = [
  page("C1", "Search Console data usually appears after processing; check the report timestamp before comparing days."),
  page("C2", "Fresh GSC numbers can lag behind events while Google processes the performance report."),
  page("C3", "Reporting delay means the newest Search Console dates may not be settled yet."),
];

describe("v2 frozen research source graph", () => {
  it("round-robins actual page material, caps it, and keeps text in one ledger", () => {
    const pages = Array.from({ length: 6 }, (_unused, index) => {
      const value = page(`C${index + 1}`, "Article text");
      return { ...value, research: { ...value.research, segments: Array.from({ length: 12 }, (_n, segment) => ({ heading: null, text: `Page ${index + 1} section ${segment + 1}`, truncated: false })), segments_total: 12, length: { value: 48, unit: "words" as const, tokenizer: "whitespace" as const } } };
    });
    const value = bundle(pages);
    expect(value.units).toHaveLength(60);
    expect(value.units.slice(0, 7)).toEqual([
      { id: "U1", kind: "page", page_ref: "C1", segment_index: 0 },
      { id: "U2", kind: "page", page_ref: "C2", segment_index: 0 },
      { id: "U3", kind: "page", page_ref: "C3", segment_index: 0 },
      { id: "U4", kind: "page", page_ref: "C4", segment_index: 0 },
      { id: "U5", kind: "page", page_ref: "C5", segment_index: 0 },
      { id: "U6", kind: "page", page_ref: "C6", segment_index: 0 },
      { id: "U7", kind: "page", page_ref: "C1", segment_index: 1 },
    ]);
    expect(value.pages.map((item) => item.research.segments.length)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(value.pages.every((item) => item.research.omitted_segments === 2)).toBe(true);
    expect(value.budget).toMatchObject({ page_units_available: 72, page_units_retained: 60, page_units_omitted: 12 });
    expect(pages[0]?.research.segments).toHaveLength(12);
  });

  it("deduplicates PAA explicitly, retains raw first spelling, and counts cap omissions", () => {
    const paa = Array.from({ length: 10 }, (_unused, index) => ({ id: `A${index + 1}`, question: `Question ${index}?`, seed_question: null }));
    paa.push({ id: "A11", question: "  QUESTION 0?  ", seed_question: null });
    const value = bundle([], paa);
    expect(value.paa).toHaveLength(8);
    expect(value.paa[0]?.question).toBe("Question 0?");
    expect(value.budget).toMatchObject({ paa_available: 11, paa_retained: 8, paa_duplicates: 1, paa_omitted: 2 });
    expect(value.units[0]).toEqual({ id: "U1", kind: "paa", paa_ref: "A1" });
  });

  it("retains provider question whitespace as source data rather than invalidating a readable PAA lane", () => {
    const question = "How long\ndoes reporting take?";
    const value = bundle([], [{ id: "A1", question, seed_question: null }]);
    expect(value.paa[0]?.question).toBe(question);
  });

  it("assigns stable units to the same frozen source identities regardless of fetch completion order", () => {
    const paa = [{ id: "A2", question: "Second?", seed_question: null }, { id: "A1", question: "First?", seed_question: null }];
    const forward = bundle(paraphrases, [...paa].reverse());
    const reverse = bundle([...paraphrases].reverse(), paa);
    expect(reverse).toEqual(forward);
    expect(research.parseResearchBundle({ ...forward, pages: [...forward.pages].reverse() }).ok).toBe(false);
    expect(research.buildResearchBundle([], [{ id: "A101", question: "Outside source cap?", seed_question: null }]).ok).toBe(false);
  });

  it("reduces retained page units under a real UTF-8 byte budget without inventing lower observed counts", () => {
    const pages = Array.from({ length: 13 }, (_unused, index) => {
      const id = index < 10 ? `C${index + 1}` : `T${index - 9}`;
      const value = page(id, "X", index < 10 ? "competitor" : "owned", `https://example.com/${"u".repeat(1750)}/${id}`);
      return { ...value, research: { ...value.research, segments: Array.from({ length: 12 }, () => ({ heading: { level: "h2" as const, text: "𠀀".repeat(160) }, text: "𠀀".repeat(300), truncated: false })), segments_total: 12, length: { value: 3760, unit: "non_whitespace_characters" as const, tokenizer: "unicode_code_points" as const } } };
    });
    const paa = Array.from({ length: 8 }, (_unused, index) => ({ id: `A${index + 1}`, question: `${"𠀀".repeat(511)}${index}`, seed_question: "𠀀".repeat(512) }));
    const value = bundle(pages, paa);
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThanOrEqual(RESEARCH_BUNDLE_MAX_BYTES);
    expect(value.budget.page_units_available).toBe(156);
    expect(value.budget.page_units_retained).toBeLessThan(60);
    expect(value.pages.every((item) => item.research.segments.length > 0)).toBe(true);
    expect(value.budget.page_units_omitted).toBe(156 - value.budget.page_units_retained);
    expect(value.budget.paa_retained).toBe(8);
    expect(research.parseResearchBundle(value).ok).toBe(true);
  });

  it("rejects source-edge and counter forgery independently", () => {
    const value = bundle(paraphrases);
    expect(research.parseResearchBundle).toBeTypeOf("function");
    expect(research.parseResearchBundle(value).ok).toBe(true);
    expect(research.parseResearchBundle({ ...value, units: [{ id: "U1", kind: "page", page_ref: "C99", segment_index: 0 }] }).ok).toBe(false);
    expect(research.parseResearchBundle({ ...value, budget: { ...value.budget, page_units_retained: 1 } }).ok).toBe(false);
    expect(research.parseResearchBundle({ ...value, surprise: true }).ok).toBe(false);
  });

  it("refuses duplicate source ids, unavailable source units and unsafe reference URLs", () => {
    expect(research.buildResearchBundle).toBeTypeOf("function");
    expect(research.buildResearchBundle([paraphrases[0]!, paraphrases[0]!], []).ok).toBe(false);
    expect(research.buildResearchBundle([{ ...paraphrases[0]!, final_url: "javascript:alert(1)" }], []).ok).toBe(false);
  });

  it("rejects observed-length metadata contradicted by retained text", () => {
    const original = page("C1", "There are five words here");
    expect(research.buildResearchBundle([{ ...original, research: { ...original.research, length: { value: 0, unit: "words", tokenizer: "whitespace" } } }], []).ok).toBe(false);
    const chinese = page("C1", "你好世界");
    expect(research.buildResearchBundle([{ ...chinese, research: { ...chinese.research, length: { value: 100, unit: "words", tokenizer: "whitespace" } } }], []).ok).toBe(false);
  });
});

describe("v2 model research with independent source-backed oracle", () => {
  it("allows one semantic question across different wording instead of requiring three questions", () => {
    const value = bundle(paraphrases);
    expect(research.validateResearchOutput).toBeTypeOf("function");
    const parsed = research.validateResearchOutput({
      questions: [{ anchor: "U1", q: "Why is Search Console data delayed?", sources: ["U1", "U2", "U3"] }],
      outline: [{ h2: "Understand the reporting delay", h3: [], answers: ["U1"] }],
    }, value);
    expect(parsed).toEqual({ ok: true, value: {
      questions: [{ id: "Q1", anchor: "U1", q: "Why is Search Console data delayed?", source_refs: ["U1", "U2", "U3"], covered_by: 3, paa_refs: [] }],
      outline: [{ id: "O1", h2: "Understand the reporting delay", h3: [], answers: ["Q1"] }],
    } });
  });

  it("allows a PAA-only question and outline with zero competitor coverage", () => {
    const value = bundle([], [{ id: "A1", question: "How long does reporting take?", seed_question: null }]);
    const result = research.validateResearchOutput({ questions: [{ anchor: "U1", q: "How long does reporting take?", sources: ["U1"] }], outline: [{ h2: "Reporting timing", h3: [], answers: ["U1"] }] }, value);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.questions[0]).toMatchObject({ covered_by: 0, paa_refs: ["A1"] });
  });

  it("does not double-count final page aliases, owned pages or PAA", () => {
    const pages = [page("C1", "A", "competitor", "https://example.com/page#one"), page("C2", "B", "competitor", "https://example.com/page#two"), page("T1", "Owned text", "owned")];
    const value = bundle(pages, [{ id: "A1", question: "Topic?", seed_question: null }]);
    const result = research.validateResearchOutput({ questions: [{ anchor: "U1", q: "What does the topic cover?", sources: ["U1", "U2", "U3", "U4"] }], outline: [{ h2: "Topic", h3: [], answers: ["U1"] }] }, value);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.questions[0]).toMatchObject({ covered_by: 1, paa_refs: ["A1"] });
  });

  it("allows zero relevant questions without inventing an outline", () => {
    const value = bundle(paraphrases);
    expect(research.validateResearchOutput({ questions: [], outline: [] }, value)).toEqual({ ok: true, value: { questions: [], outline: [] } });
  });

  it.each([
    { questions: [{ anchor: "U99", q: "Q?", sources: ["U99"] }], outline: [] },
    { questions: [{ anchor: "U1", q: "Q?", sources: ["U2"] }], outline: [{ h2: "H", h3: [], answers: ["U1"] }] },
    { questions: [{ anchor: "U1", q: "Q?", sources: ["U1", "U1"] }], outline: [{ h2: "H", h3: [], answers: ["U1"] }] },
    { questions: [{ anchor: "U1", q: "Q?", sources: ["U1"] }], outline: [] },
    { questions: [{ anchor: "U1", q: "Q?", sources: ["U1"] }], outline: [{ h2: "H", h3: [], answers: ["U1"] }, { h2: "Again", h3: [], answers: ["U1"] }] },
    { questions: [], outline: [{ h2: "Invented", h3: [], answers: ["U1"] }] },
    { questions: [{ anchor: "U1", q: "<script>", sources: ["U1"] }], outline: [{ h2: "H", h3: [], answers: ["U1"] }] },
    { questions: [], outline: [], extra: true },
  ])("refuses invalid model graph %# without silently repairing it", (output) => {
    const value = bundle(paraphrases);
    expect(research.validateResearchOutput(output, value).ok).toBe(false);
  });

  it("rejects forged derived coverage even when the source graph is valid", () => {
    const value = bundle(paraphrases);
    const parsed = research.validateResearchOutput({ questions: [{ anchor: "U1", q: "Q?", sources: ["U1"] }], outline: [{ h2: "H", h3: [], answers: ["U1"] }] }, value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.path);
    expect(research.parseResearchResult).toBeTypeOf("function");
    expect(research.parseResearchResult(parsed.value, value).ok).toBe(true);
    expect(research.parseResearchResult({ ...parsed.value, questions: [{ ...parsed.value.questions[0]!, covered_by: 3 }] }, value).ok).toBe(false);
  });
});
