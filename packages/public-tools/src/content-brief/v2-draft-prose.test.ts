import { beforeAll, describe, expect, it } from "vitest";
import type { ProfileFact } from "./contract.ts";
import { confirmedDraftV2Fixture } from "./v2-draft-fixtures.ts";
import type { DraftV2Settings } from "./v2-draft-contract.ts";
import { checkDraftV2Prose, draftV2Warnings, type DraftV2ProseSection } from "./v2-draft-prose.ts";
import { buildDraftV2SectionScope, type DraftV2SectionScope } from "./v2-draft-scope.ts";
import type { DraftV2SectionBody, DraftV2Sentence } from "./v2-draft-section.ts";
import type { ConfirmedBriefV2 } from "./v2-generation-contract.ts";

const SETTINGS: DraftV2Settings = { tone: "explanatory", person: "second", product_mention: "none" };
const SOURCE = "Reports lag by 48 hours, and 12% of runs never finish. One page listed 1,200 queries.";
const FACT: ProfileFact = { id: "P1", field: "feature", text: "The exporter caps a download at 25000 rows.", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } };

// The real fixture brief states no figure at all, so every number in these
// cases comes from the excerpts and facts below and nowhere else.
let confirmed: ConfirmedBriefV2;
let built: DraftV2SectionScope;
beforeAll(async () => {
  confirmed = await confirmedDraftV2Fixture();
  const result = buildDraftV2SectionScope(confirmed, confirmed.outline[0]!.id, SETTINGS);
  if (!result.ok) throw new Error(result.path);
  built = result.value;
});

function scope(overrides: Partial<DraftV2SectionScope> = {}): DraftV2SectionScope {
  return {
    ...built,
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
    expect(checkDraftV2Prose(body({ text: "Reports lag by 48 hours." }), scope(), confirmed)).toBeNull();
  });

  it("rejects a figure that appears in none of the sources that sentence cites", () => {
    expect(checkDraftV2Prose(body({ text: "Reports lag by 72 hours." }), scope(), confirmed))
      .toEqual({ rule: "number_without_source", path: "paragraphs[0].sentences[0].text" });
  });

  it("does not accept a figure from a source the sentence did not cite", () => {
    // 96 is in U2, which this sentence does not claim to be writing from.
    expect(checkDraftV2Prose(body({ text: "Reports lag by 96 hours." }), scope(), confirmed)?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Reports lag by 96 hours.", evidence_refs: ["U1", "U2"] }), scope(), confirmed)).toBeNull();
  });

  it("reads a cited profile fact as a source like any other", () => {
    expect(checkDraftV2Prose(body({ text: "The export stops at 25000 rows.", evidence_refs: ["P1"] }), scope(), confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "The export stops at 25000 rows." }), scope(), confirmed)?.rule).toBe("number_without_source");
  });

  it("compares figures with their thousands separators removed", () => {
    expect(checkDraftV2Prose(body({ text: "One page listed 1200 queries." }), scope(), confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "The exporter caps a download at 25,000 rows.", evidence_refs: ["P1"] }), scope(), confirmed)).toBeNull();
  });

  it("reads a figure written in another script as the same figure", () => {
    // NFKC folds the fullwidth digits; the Arabic-Indic ones would otherwise
    // match no number at all and skip the rule entirely.
    expect(checkDraftV2Prose(body({ text: "Reports lag by ４８ hours." }), scope(), confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "Reports lag by ٤٨ hours." }), scope(), confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "Reports lag by ٤٢ hours." }), scope(), confirmed)?.rule).toBe("number_without_source");
  });

  it("compares figures as quantities rather than as spellings", () => {
    const evidence = scope({ page_units: new Map([["U1", { page_ref: "C1", final_url: "https://example.test/a", text: "The rate is .5% and the cap is 1200.0 rows." }]]) });
    expect(checkDraftV2Prose(body({ text: "The rate is 0.5%." }), evidence, confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "The cap is 1,200 rows." }), evidence, confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "The rate is 0.6%." }), evidence, confirmed)?.rule).toBe("number_without_source");
  });

  it("leaves a lone digit alone and still checks a lone percentage", () => {
    expect(checkDraftV2Prose(body({ text: "There are 3 fields to fill in." }), scope(), confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "Only 5% of runs stall." }), scope(), confirmed)?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Only 12% of runs stall." }), scope(), confirmed)).toBeNull();
    // The word is the same number as the sign, so neither spelling escapes.
    expect(checkDraftV2Prose(body({ text: "Only 5 percent of runs stall." }), scope(), confirmed)?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Only 12 percent of runs stall." }), scope(), confirmed)).toBeNull();
  });

  it("does not let a count stand in for a proportion", () => {
    const evidence = scope({ page_units: new Map([["U1", { page_ref: "C1", final_url: "https://example.test/a", text: "There were 5 failures across 60 runs." }]]) });
    expect(checkDraftV2Prose(body({ text: "There were 5 failures." }), evidence, confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "The failure rate is 5%." }), evidence, confirmed)?.rule).toBe("number_without_source");
  });

  it("reads a comma as a thousands separator only where it separates thousands", () => {
    const evidence = scope({ page_units: new Map([["U1", { page_ref: "C1", final_url: "https://example.test/a", text: "Samples 10, 20 and 30 are available." }]]) });
    // Reading the comma greedily would fuse this into 1020 and reject prose the
    // source fully supports.
    expect(checkDraftV2Prose(body({ text: "Compare samples 10,20 and 30." }), evidence, confirmed)).toBeNull();
  });

  it("treats a figure the brief itself states as supplied, wherever the sentence cites", () => {
    // A confirmed heading, a question, a plan step, the keyword or the chosen
    // title that names a figure hands the writer that figure; repeating it is
    // not invention, and rejecting it would misfire on the operator's own words.
    const numbered = scope({ section: { ...built.section, h2: "The 10 checks that matter" } });
    expect(checkDraftV2Prose(body({ text: "Work through all 10 checks." }), numbered, confirmed)).toBeNull();
    expect(checkDraftV2Prose(body({ text: "Work through all 11 checks." }), numbered, confirmed)?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Work through all 10 checks." }), scope(), confirmed)?.rule).toBe("number_without_source");
  });

  it("holds an uncited sentence to this section's whole evidence set", () => {
    // no_claim and gap cite nothing, so relabelling a fabricated measurement
    // must not be a way past the rule.
    expect(checkDraftV2Prose(body({ text: "Some runs take 72 hours.", claim: "no_claim", evidence_refs: [] }), scope(), confirmed)?.rule).toBe("number_without_source");
    expect(checkDraftV2Prose(body({ text: "Some runs take 96 hours.", claim: "no_claim", evidence_refs: [] }), scope(), confirmed)).toBeNull();
  });

  it.each([
    "As an AI, I cannot verify the export limit.",
    "As a language model I have no access to that page.",
    "Sure, the reporting delay is the place to start.",
    "Sure! The reporting delay is the place to start.",
    "Great question -- the delay is the place to start.",
    "Here is the rewritten section you asked for.",
    "Let me know if you want a longer version.",
    "I hope this helps you plan the rewrite.",
    "As requested, the delay is covered first.",
    "## Reporting delays",
    "The snippet is ```export --all``` in the console.",
  ])("rejects chat residue: %s", (text) => {
    expect(checkDraftV2Prose(body({ text, claim: "no_claim", evidence_refs: [] }), scope(), confirmed))
      .toEqual({ rule: "chat_residue", path: "paragraphs[0].sentences[0].text" });
  });

  it.each([
    "Certainly the delay is worth checking before you republish.",
    "Of course the report can lag behind the crawl.",
    "Here is where the collection date matters most.",
    "Sureness about the date is what the check buys you.",
    "Sure footing requires checking the reporting window.",
    "Sure enough, the report arrived after the crawl.",
  ])("leaves prose a writer might actually choose: %s", (text) => {
    expect(checkDraftV2Prose(body({ text, claim: "no_claim", evidence_refs: [] }), scope(), confirmed)).toBeNull();
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
    expect(checkDraftV2Prose(value, scope(), confirmed)).toEqual({ rule: "number_without_source", path: "paragraphs[1].sentences[1].text" });
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

  it("says nothing about a clause it cannot break into eight tokens", () => {
    const text = "报告数据存在延迟，请先比较采集日期与最后更新日期，然后再重新发布这个页面。";
    const evidence = scope({ page_units: new Map([["U1", { page_ref: "C1", final_url: "https://example.test/a", text }]]) });
    expect(draftV2Warnings([prose("O1", [{ text }], evidence), prose("O2", [{ text }], evidence)])).toEqual([]);
  });

  it("still reads a spaced language, so the quiet above is about tokens and not about scripts", () => {
    const text = "매일 보고서를 열고 수집 날짜와 마지막 갱신 날짜를 먼저 비교하세요.";
    const bare = scope({ page_units: new Map() });
    expect(draftV2Warnings([
      prose("O1", [{ text, claim: "no_claim", evidence_refs: [] }], bare),
      prose("O2", [{ text, claim: "no_claim", evidence_refs: [] }], bare),
    ])).toEqual([{
      code: "repeated_across_sections",
      at: { section_id: "O2", paragraph: 0, sentence: 0 },
      other: { section_id: "O1", paragraph: 0, sentence: 0 },
    }]);
  });
});
