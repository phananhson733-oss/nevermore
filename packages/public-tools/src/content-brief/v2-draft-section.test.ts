import { describe, expect, it } from "vitest";
import * as draft from "./v2-draft-section.ts";
import type { ProfileFact } from "./contract.ts";

const facts = new Map<string, ProfileFact>([
  ["P1", { id: "P1", field: "feature", text: "Report comparison", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } }],
  ["P2", { id: "P2", field: "audience", text: "Analysts", derivation: "inferred", provenance: { method: "model", derived_from: ["product_profile"] } }],
]);
const scope = {
  page_units: new Map([
    ["U1", { page_ref: "C1", final_url: "https://source.test/guide" }],
    ["U2", { page_ref: "C1", final_url: "https://source.test/guide" }],
    ["U3", { page_ref: "T1", final_url: "https://owned.test/guide" }],
  ]),
  facts, stance_allowed: true,
};
function body(claim: string, evidence_refs: string[], text = "A reporting sentence.") {
  return { paragraphs: [{ sentences: [{ text, claim, evidence_refs }] }] };
}

describe("v2 Draft sentences over page-unit evidence", () => {
  it("counts multiple excerpt refs from one page once", () => {
    expect(draft.validateDraftV2Section).toBeTypeOf("function");
    expect(draft.validateDraftV2Section(body("bound", ["U1", "U2"]), scope, "en")).toMatchObject({
      ok: true, value: { length: { value: 3, unit: "words", tokenizer: "whitespace" }, paragraphs: [{ heading: null, sentences: [{ support_count: 1 }] }] },
    });
  });
  it("allows observed owned-page evidence without making it a fake competitor", () => {
    expect(draft.validateDraftV2Section(body("bound", ["U1", "U3"]), scope, "en")).toMatchObject({ ok: true, value: { paragraphs: [{ heading: null, sentences: [{ support_count: 2 }] }] } });
  });
  it.each([["U4"], ["A1"], ["C1"], ["P2"], ["U1", "U1"], []].map((refs) => ({ refs })))("rejects PAA, whole-page IDs, inferred facts or malformed bindings %#", ({ refs }) => {
    expect(draft.validateDraftV2Section(body("bound", refs), scope, "en").ok).toBe(false);
  });
  it("keeps profile-only support distinct from supporting pages", () => {
    expect(draft.validateDraftV2Section(body("bound", ["P1"]), scope, "en")).toMatchObject({ ok: true, value: { paragraphs: [{ heading: null, sentences: [{ support_count: 0 }] }] } });
    expect(draft.validateDraftV2Section(body("bound", ["P1"]), { ...scope, facts: new Map() }, "en").ok).toBe(false);
  });
  it("allows inferred-profile stance only in its assigned gap-angle section", () => {
    expect(draft.validateDraftV2Section(body("stance", ["P2"]), scope, "en").ok).toBe(true);
    expect(draft.validateDraftV2Section(body("stance", ["P2"]), { ...scope, stance_allowed: false }, "en").ok).toBe(false);
    expect(draft.validateDraftV2Section(body("stance", ["U1"]), scope, "en").ok).toBe(false);
  });
  it("requires empty references on gaps and non-claims", () => {
    for (const claim of ["gap", "no_claim"]) {
      expect(draft.validateDraftV2Section(body(claim, []), scope, "en").ok).toBe(true);
      expect(draft.validateDraftV2Section(body(claim, ["U1"]), scope, "en").ok).toBe(false);
    }
  });
  it("normalizes harmless model whitespace without deleting or changing claims", () => {
    expect(draft.validateDraftV2Section(body("gap", [], "  A\nreporting  sentence. "), scope, "en")).toMatchObject({
      ok: true, value: { paragraphs: [{ heading: null, sentences: [{ text: "A reporting sentence.", claim: "gap" }] }] },
    });
  });
  it("counts Chinese characters honestly and rechecks exported derived fields", () => {
    const result = draft.validateDraftV2Section(body("gap", [], "报告数据需要处理。"), scope, "zh");
    expect(result).toMatchObject({ ok: true, value: { length: { value: 9, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" } } });
    if (!result.ok) throw new Error(result.path);
    expect(draft.parseDraftV2SectionBody(result.value, scope, "zh")).toEqual(result);
    expect(draft.parseDraftV2SectionBody({ ...result.value, length: { value: 1, unit: "words", tokenizer: "whitespace" } }, scope, "zh").ok).toBe(false);
    const sentence = result.value.paragraphs[0]!.sentences[0]!;
    expect(draft.parseDraftV2SectionBody({ ...result.value, paragraphs: [{ heading: null, sentences: [{ ...sentence, support_count: 1 }] }] }, scope, "zh").ok).toBe(false);
  });
  it("rejects empty, oversized, extra-key and malformed whole sections", () => {
    for (const value of [
      { paragraphs: [] }, { ...body("gap", []), extra: 1 }, body("gap", [], "x".repeat(601)), body("gap", [], "<script>"),
      body("made_up", []), { paragraphs: [{ sentences: Array.from({ length: 121 }, () => ({ text: "Text", claim: "gap", evidence_refs: [] })) }] },
    ]) expect(draft.validateDraftV2Section(value, scope, "en").ok).toBe(false);
  });
});

const headings = ["Read the current report", "Compare complete periods"];
const headingScope = { ...scope, allowed_h3: headings };
function headedBody(values: readonly (string | null)[]) {
  return { paragraphs: values.map((heading) => ({ heading, sentences: [{ text: "Keep comparing reports.", claim: "no_claim", evidence_refs: [] }] })) };
}

describe("v2 Draft exact confirmed H3 structure", () => {
  it("renders each confirmed H3 in order with null introduction and continuation paragraphs", () => {
    const input = headedBody([null, headings[0]!, null, headings[1]!, null]);
    const result = draft.validateDraftV2Section(input, headingScope, "en");
    expect(result).toMatchObject({ ok: true, value: {
      length: { value: 15, unit: "words", tokenizer: "whitespace" },
      paragraphs: input.paragraphs.map((paragraph) => ({ heading: paragraph.heading, sentences: [{ claim: "no_claim", evidence_refs: [], support_count: 0 }] })),
    } });
    if (!result.ok) throw new Error(result.path);
    expect(draft.parseDraftV2SectionBody(result.value, headingScope, "en")).toEqual(result);
  });

  it.each([
    [null], [headings[0]!], [headings[1]!, headings[0]!], [headings[0]!, headings[0]!, headings[1]!],
    ["Invented heading", headings[1]!], [...headings, "Another heading"],
  ].map((values) => ({ values })))("rejects omitted, reordered, duplicate or invented H3 sequence $values", ({ values }) => {
    expect(draft.validateDraftV2Section(headedBody(values), headingScope, "en").ok).toBe(false);
  });

  it("requires all H3 while treating omitted intro headings as null", () => {
    const missing = body("no_claim", []);
    expect(draft.validateDraftV2Section(missing, headingScope, "en").ok).toBe(false);
    const withRequiredHeadings = { paragraphs: [...missing.paragraphs, ...headedBody(headings).paragraphs] };
    expect(draft.validateDraftV2Section(withRequiredHeadings, headingScope, "en")).toMatchObject({ ok: true, value: {
      paragraphs: [{ heading: null }, { heading: headings[0] }, { heading: headings[1] }],
    } });
  });

  it("normalizes harmless model heading whitespace against untouched confirmed text", () => {
    const input = headedBody(["  Read the\n current  report  ", " Compare complete periods "]);
    expect(draft.validateDraftV2Section(input, headingScope, "en")).toMatchObject({ ok: true, value: {
      paragraphs: [{ heading: headings[0] }, { heading: headings[1] }],
    } });
    expect(draft.validateDraftV2Section(input, { ...headingScope, allowed_h3: ["Read the  current report", headings[1]!] }, "en").ok).toBe(false);
    expect(draft.validateDraftV2Section(headedBody(["read the current report", headings[1]!]), headingScope, "en").ok).toBe(false);
  });

  it("requires canonical heading fields when reading frozen bodies and rechecks their exact sequence", () => {
    const sentence = { text: "Keep comparing reports.", claim: "no_claim", evidence_refs: [], support_count: 0 };
    const frozen = {
      length: { value: 6, unit: "words", tokenizer: "whitespace" },
      paragraphs: headings.map((heading) => ({ heading, sentences: [sentence] })),
    };
    expect(draft.parseDraftV2SectionBody(frozen, headingScope, "en").ok).toBe(true);
    for (const paragraphs of [
      [{ sentences: [sentence] }, frozen.paragraphs[1]!],
      [...frozen.paragraphs].reverse(),
      [{ heading: "Invented heading", sentences: [sentence] }, frozen.paragraphs[1]!],
      [{ heading: " Read the current report ", sentences: [sentence] }, frozen.paragraphs[1]!],
      [{ heading: null, sentences: [sentence] }, frozen.paragraphs[1]!],
    ]) expect(draft.parseDraftV2SectionBody({ ...frozen, paragraphs }, headingScope, "en").ok).toBe(false);
  });

  it("defaults standalone evidence to no headings while preserving legacy raw omission as canonical null", () => {
    const result = draft.validateDraftV2Section(body("no_claim", []), scope, "en");
    expect(result).toMatchObject({ ok: true, value: { paragraphs: [{ heading: null }] } });
    expect(draft.validateDraftV2Section(headedBody([null]), scope, "en").ok).toBe(true);
    expect(draft.validateDraftV2Section(headedBody([headings[0]!]), scope, "en").ok).toBe(false);
    if (!result.ok) throw new Error(result.path);
    const sentence = result.value.paragraphs[0]!.sentences[0]!;
    expect(draft.parseDraftV2SectionBody({ ...result.value, paragraphs: [{ sentences: [sentence] }] }, scope, "en").ok).toBe(false);
  });

  it("keeps exact Chinese headings out of sentence-only character length", () => {
    const input = { paragraphs: [{ heading: "检查报告时间", sentences: [{ text: "报告数据需要处理。", claim: "gap", evidence_refs: [] }] }] };
    const result = draft.validateDraftV2Section(input, { ...scope, allowed_h3: ["检查报告时间"] }, "zh");
    expect(result).toMatchObject({ ok: true, value: { length: { value: 9, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" }, paragraphs: [{ heading: "检查报告时间" }] } });
  });
});
