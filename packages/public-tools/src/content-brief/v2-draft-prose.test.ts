import { describe, expect, it } from "vitest";
import type { ProfileFact } from "./contract.ts";
import { checkDraftV2Prose, draftV2Warnings, type DraftV2ProseSection } from "./v2-draft-prose.ts";
import type { DraftV2SectionBody, DraftV2SectionEvidence, DraftV2Sentence } from "./v2-draft-section.ts";

const SOURCE = "Reports lag by 48 hours, and 12% of runs never finish. One page listed 1,200 queries.";
const FACT: ProfileFact = { id: "P1", field: "feature", text: "The exporter caps a download at 25000 rows.", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } };

function scope(overrides: Partial<DraftV2SectionEvidence> = {}): DraftV2SectionEvidence {
  return {
    page_units: new Map([
      ["U1", { page_ref: "C1", final_url: "https://example.test/a", text: SOURCE }],
      ["U2", { page_ref: "C2", final_url: "https://other.test/b", text: "A second page mentions 96 hours." }],
    ]),
    facts: new Map([["P1", FACT]]),
    stance_allowed: false,
    ...overrides,
  };
}

function body(...sentences: readonly (Partial<DraftV2Sentence> & { text: string })[]): DraftV2SectionBody {
  return {
    length: { value: 0, unit: "words", tokenizer: "whitespace" },
    paragraphs: [{ heading: null, sentences: sentences.map((sentence) => ({ claim: "bound", evidence_refs: ["U1"], support_count: 1, ...sentence })) }],
  };
}

describe("Draft v2 prose gate", () => {
  it("accepts a figure the cited excerpt states", () => {
    expect(checkDraftV2Prose(body({ text: "Reports lag by 48 hours." }), scope())).toBeNull();
  });

  it("rejects a figure that appears in none of the sources that sentence cites", () => {
    expect(checkDraftV2Prose(body({ text: "Reports lag by 72 hours." }), scope()))
      .toEqual({ rule: "number_without_source", path: "paragraphs[0].sentences[0].text" });
  });

  it("does not accept a figure from a source the sentence did not cite", () => {
    // 96 is in U2, which this sentence does not claim to be writing from.
    expect(checkDraftV2Prose(body({ text: "Reports lag by 96 hours." }), scope())?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Reports lag by 96 hours.", evidence_refs: ["U1", "U2"] }), scope())).toBeNull();
  });

  it("reads a cited profile fact as a source like any other", () => {
    expect(checkDraftV2Prose(body({ text: "The export stops at 25000 rows.", evidence_refs: ["P1"] }), scope())).toBeNull();
    expect(checkDraftV2Prose(body({ text: "The export stops at 25000 rows." }), scope())?.rule).toBe("number_without_source");
  });

  it("compares figures with their thousands separators removed", () => {
    expect(checkDraftV2Prose(body({ text: "One page listed 1200 queries." }), scope())).toBeNull();
    expect(checkDraftV2Prose(body({ text: "The exporter caps a download at 25,000 rows.", evidence_refs: ["P1"] }), scope())).toBeNull();
  });

  it("leaves a lone digit alone and still checks a lone percentage", () => {
    expect(checkDraftV2Prose(body({ text: "There are 3 fields to fill in." }), scope())).toBeNull();
    expect(checkDraftV2Prose(body({ text: "Only 5% of runs stall." }), scope())?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Only 12% of runs stall." }), scope())).toBeNull();
  });

  it("holds an uncited sentence to this section's whole evidence set", () => {
    // no_claim and gap cite nothing, so relabelling a fabricated measurement
    // must not be a way past the rule.
    expect(checkDraftV2Prose(body({ text: "Some runs take 72 hours.", claim: "no_claim", evidence_refs: [] }), scope())?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Some runs take 96 hours.", claim: "no_claim", evidence_refs: [] }), scope())).toBeNull();
  });

  it.each([
    "As an AI, I cannot verify the export limit.",
    "As a language model I have no access to that page.",
    "Sure, the reporting delay is the place to start.",
    "Great question -- the delay is the place to start.",
    "Here is the rewritten section you asked for.",
    "Let me know if you want a longer version.",
    "I hope this helps you plan the rewrite.",
    "As requested, the delay is covered first.",
    "## Reporting delays",
    "The snippet is ```export --all``` in the console.",
  ])("rejects chat residue: %s", (text) => {
    expect(checkDraftV2Prose(body({ text, claim: "no_claim", evidence_refs: [] }), scope()))
      .toEqual({ rule: "chat_residue", path: "paragraphs[0].sentences[0].text" });
  });

  it.each([
    "Certainly the delay is worth checking before you republish.",
    "Of course the report can lag behind the crawl.",
    "Here is where the collection date matters most.",
    "Sureness about the date is what the check buys you.",
  ])("leaves prose a writer might actually choose: %s", (text) => {
    expect(checkDraftV2Prose(body({ text, claim: "no_claim", evidence_refs: [] }), scope())).toBeNull();
  });

  it("names the first broken sentence, by paragraph and then sentence order", () => {
    const value: DraftV2SectionBody = {
      length: { value: 0, unit: "words", tokenizer: "whitespace" },
      paragraphs: [
        { heading: null, sentences: [{ text: "Reports lag by 48 hours.", claim: "bound", evidence_refs: ["U1"], support_count: 1 }] },
        { heading: null, sentences: [
          { text: "The collection date is the one to compare.", claim: "no_claim", evidence_refs: [], support_count: 0 },
          { text: "Reports lag by 72 hours.", claim: "bound", evidence_refs: ["U1"], support_count: 1 },
        ] },
      ],
    };
    expect(checkDraftV2Prose(value, scope())).toEqual({ rule: "number_without_source", path: "paragraphs[1].sentences[1].text" });
  });
});

const COPIED = "compare the collection date with the last update before you republish";

function prose(id: string, sentences: readonly (Partial<DraftV2Sentence> & { text: string })[], evidence = scope()): DraftV2ProseSection {
  return { id, body: body(...sentences), evidence };
}

describe("Draft v2 writing warnings", () => {
  const wordy = (n: number) => Array.from({ length: n }, (_, index) => ({ text: `Sentence number ${index + 1} says something.` }));

  it("flags a paragraph that runs past four sentences and leaves four alone", () => {
    expect(draftV2Warnings([prose("O1", wordy(4))])).toEqual([]);
    expect(draftV2Warnings([prose("O1", wordy(5))]))
      .toEqual([{ code: "paragraph_too_long", at: { section_id: "O1", paragraph: 0, sentence: null }, other: null }]);
  });

  it("does not count bulleted sentences against the paragraph rhythm", () => {
    expect(draftV2Warnings([prose("O1", wordy(6).map((sentence) => ({ ...sentence, bullet: true as const })))])).toEqual([]);
  });

  it.each([
    "It is important to note that the report lags.",
    "When it comes to reporting, the date is what matters.",
    "This will take your reporting to the next level.",
    "In today's digital landscape the delay still applies.",
  ])("flags recognized filler: %s", (text) => {
    expect(draftV2Warnings([prose("O1", [{ text, claim: "no_claim", evidence_refs: [] }])]))
      .toEqual([{ code: "filler_phrase", at: { section_id: "O1", paragraph: 0, sentence: 0 }, other: null }]);
  });

  it("flags a sentence that reproduces a run of words from a supplied excerpt", () => {
    const evidence = scope({ page_units: new Map([["U1", { page_ref: "C1", final_url: "https://example.test/a", text: `The guide says you should ${COPIED}.` }]]) });
    expect(draftV2Warnings([prose("O1", [{ text: `You should ${COPIED}.` }], evidence)]))
      .toEqual([{ code: "source_phrase_reused", at: { section_id: "O1", paragraph: 0, sentence: 0 }, other: null }]);
    expect(draftV2Warnings([prose("O1", [{ text: "Check the collection date first." }], evidence)])).toEqual([]);
  });

  it("flags a run of words repeated in a later section and points back at the first one", () => {
    const bare = scope({ page_units: new Map() });
    expect(draftV2Warnings([
      prose("O1", [{ text: `First we ${COPIED}.`, claim: "no_claim", evidence_refs: [] }], bare),
      prose("O2", [{ text: `Later you ${COPIED}.`, claim: "no_claim", evidence_refs: [] }], bare),
    ])).toEqual([{
      code: "repeated_across_sections",
      at: { section_id: "O2", paragraph: 0, sentence: 0 },
      other: { section_id: "O1", paragraph: 0, sentence: 0 },
    }]);
  });

  it("says nothing about repetition inside one section", () => {
    const bare = scope({ page_units: new Map() });
    expect(draftV2Warnings([prose("O1", [
      { text: `First we ${COPIED}.`, claim: "no_claim", evidence_refs: [] },
      { text: `Later you ${COPIED}.`, claim: "no_claim", evidence_refs: [] },
    ], bare)])).toEqual([]);
  });

  it("stays silent for a script without whitespace word boundaries", () => {
    const text = "报告数据存在延迟，请先比较采集日期与最后更新日期，然后再重新发布这个页面。";
    const evidence = scope({ page_units: new Map([["U1", { page_ref: "C1", final_url: "https://example.test/a", text }]]) });
    expect(draftV2Warnings([prose("O1", [{ text }], evidence), prose("O2", [{ text }], evidence)])).toEqual([]);
  });
});
