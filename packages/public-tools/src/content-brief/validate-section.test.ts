// @input  -- model section outputs around every claim rule
// @output -- proof the validator accepts only what the contract allows and never rewrites a claim
// @pos    -- validate-section's unit tests
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { SECTION_MAX_SENTENCES, SENTENCE_MAX_CHARS } from "./constants.ts";
import type { ModelSectionOutput, ProfileFact } from "./contract.ts";
import { countWords, validateSectionOutput, type SectionEvidence } from "./validate-section.ts";

const FACTS: ProfileFact[] = [
  { id: "P1", field: "productName", text: "Brewly", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } },
  { id: "P2", field: "oneLinePositioning", text: "Gear for home baristas", derivation: "inferred", provenance: { method: "model", derived_from: ["product_profile"] } },
];

const EVIDENCE: SectionEvidence = {
  citableCrawlIds: new Set(["C1", "C2"]),
  profileFacts: new Map(FACTS.map((fact) => [fact.id, fact])),
  stanceAllowed: true,
};

function output(sentences: ModelSectionOutput["paragraphs"][number]["sentences"]): ModelSectionOutput {
  return { paragraphs: [{ sentences }] };
}

describe("validateSectionOutput", () => {
  it("derives support_count from distinct crawl refs and counts words", () => {
    const result = validateSectionOutput(
      output([
        { text: "Pour over  takes three minutes.", claim: "bound", evidence_refs: ["C1", "C2", "P1"] },
        { text: "Brewly sells kettles.", claim: "bound", evidence_refs: ["P1"] },
        { text: "So the grind matters.", claim: "no_claim", evidence_refs: [] },
        { text: "Most guides skip water hardness.", claim: "gap", evidence_refs: [] },
        { text: "We think that is a mistake.", claim: "stance", evidence_refs: ["P2"] },
      ]),
      EVIDENCE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sentences = result.paragraphs[0]?.sentences ?? [];
    expect(sentences.map((sentence) => sentence.support_count)).toEqual([2, 0, 0, 0, 0]);
    expect(sentences[0]?.text).toBe("Pour over takes three minutes.");
    expect(result.word_count).toBe(countWords("Pour over takes three minutes.") + 3 + 4 + 5 + 6);
  });

  it.each([
    ["bound without refs", { text: "x", claim: "bound", evidence_refs: [] }, "bound_without_refs"],
    ["bound citing an inferred fact", { text: "x", claim: "bound", evidence_refs: ["P2"] }, "bound_cannot_cite_inferred"],
    ["bound citing a page without excerpts", { text: "x", claim: "bound", evidence_refs: ["C9"] }, "ref_not_citable"],
    ["unknown fact", { text: "x", claim: "stance", evidence_refs: ["P9"] }, "ref_unknown"],
    ["stance citing a page", { text: "x", claim: "stance", evidence_refs: ["C1"] }, "stance_needs_profile_fact"],
    ["stance without refs", { text: "x", claim: "stance", evidence_refs: [] }, "stance_needs_profile_fact"],
    ["gap with refs", { text: "x", claim: "gap", evidence_refs: ["C1"] }, "refs_must_be_empty"],
    ["no_claim with refs", { text: "x", claim: "no_claim", evidence_refs: ["P1"] }, "refs_must_be_empty"],
    ["repeated ref", { text: "x", claim: "bound", evidence_refs: ["C1", "C1"] }, "ref_repeated"],
    ["unknown claim", { text: "x", claim: "maybe" as never, evidence_refs: [] }, "claim_unknown"],
    ["empty text", { text: "   ", claim: "no_claim", evidence_refs: [] }, "sentence_text"],
    ["too long", { text: "a".repeat(SENTENCE_MAX_CHARS + 1), claim: "no_claim", evidence_refs: [] }, "sentence_text"],
  ] as const)("fails the section on %s", (_name, sentence, rule) => {
    const result = validateSectionOutput(output([sentence as never]), EVIDENCE);
    expect(result).toMatchObject({ ok: false, rule });
  });

  it("refuses a section with no sentences at all", () => {
    expect(validateSectionOutput({ paragraphs: [] }, EVIDENCE)).toMatchObject({ ok: false, rule: "empty_section" });
    expect(validateSectionOutput({ paragraphs: [{ sentences: [] }] }, EVIDENCE)).toMatchObject({ ok: false, rule: "empty_section" });
  });

  it("refuses a stance in a section that did not receive the gap angle", () => {
    const elsewhere: SectionEvidence = { ...EVIDENCE, stanceAllowed: false };
    expect(validateSectionOutput(output([{ text: "We think so.", claim: "stance", evidence_refs: ["P1"] }]), elsewhere)).toMatchObject({
      ok: false,
      rule: "stance_outside_gap_angle",
    });
    expect(validateSectionOutput(output([{ text: "Grounded.", claim: "bound", evidence_refs: ["P1"] }]), elsewhere)).toMatchObject({ ok: true });
  });

  it("caps the number of sentences", () => {
    const many = Array.from({ length: SECTION_MAX_SENTENCES + 1 }, () => ({ text: "ok", claim: "no_claim" as const, evidence_refs: [] }));
    expect(validateSectionOutput(output(many), EVIDENCE)).toMatchObject({ ok: false, rule: "too_many_sentences" });
  });

  it("does not mutate its input", () => {
    const input = output([{ text: "x", claim: "no_claim", evidence_refs: [] }]);
    const snapshot = JSON.stringify(input);
    validateSectionOutput(input, EVIDENCE);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
