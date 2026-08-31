import { describe, expect, it } from "vitest";
import { geoBriefFixture, geoDraftFixture } from "./geo-fixtures.ts";
import { decideCoverage, deriveTotals, deriveVerifyList, planSections, sectionEvidenceScope } from "./draft-assemble.ts";
import { parseDraftResult, sectionEvidenceFor } from "./parse-draft.ts";
import { countWords, validateSectionOutput } from "./validate-section.ts";
import { draftFingerprint } from "./canonical.ts";
import { parseSharedContentBrief, parseSharedContentBriefHandoff } from "./parse-geo-brief.ts";
import { CONTENT_BRIEF_HANDOFF_TTL_MS } from "./contract.ts";
import { contentBriefFixture, withFingerprint } from "./fixtures.ts";

const settings = { tone: "explanatory", person: "second", product_mention: "throughout" } as const;
describe("shared Draft GEO adapter", () => {
  it("rejects a forged KB-supported statement even after every count and fingerprint is recomputed", async () => {
    const brief = await geoBriefFixture(); const draft = await geoDraftFixture(brief); const first = draft.sections[0];
    if (first?.status !== "ok") throw new Error("fixture");
    const sentence = first.body.paragraphs[0]?.sentences[0]; if (!sentence) throw new Error("fixture");
    sentence.text = "The product costs $999 monthly and supports 900 seats.";
    first.body.word_count = countWords(sentence.text); draft.totals = deriveTotals(draft.sections); draft.verify_before_publish = deriveVerifyList(draft.sections); draft.run.fingerprint = await draftFingerprint(draft);
    expect((await parseDraftResult(draft, brief)).ok).toBe(false);
  });
  it("does not let a real KB reference launder extra values or qualifiers", async () => {
    const brief = await geoBriefFixture(); const evidence = sectionEvidenceFor(brief, "O1", settings);
    for (const text of ["The product costs $999 monthly and supports 900 seats.", "The fixture tool supports three seats with unlimited integrations."]) {
      expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text, claim: "bound", evidence_refs: ["K1"] }] }] }, evidence).ok).toBe(false);
    }
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "The fixture tool supports 3 seats.", claim: "bound", evidence_refs: ["K1"] }] }] }, evidence).ok).toBe(true);
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "The price is three dollars.", claim: "gap", evidence_refs: [] }] }] }, evidence).ok).toBe(false);
  });
  it("does not turn a failed read into a claim that the price was never published", async () => {
    const brief = await geoBriefFixture(); brief.fact_table[1]!.reason = "fetchFailed";
    const evidence = sectionEvidenceFor(brief, "O1", settings);
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "Price is not published.", claim: "gap", evidence_refs: [] }] }] }, evidence).ok).toBe(false);
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "Price is free.", claim: "no_claim", evidence_refs: [] }] }] }, evidence).ok).toBe(false);
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "Compare price before choosing.", claim: "no_claim", evidence_refs: [] }] }] }, evidence).ok).toBe(true);
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "Price could not be verified because its source could not be read.", claim: "gap", evidence_refs: [] }] }] }, evidence).ok).toBe(true);
    brief.fact_table[1]!.reason = "notPublished";
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "Price is not published.", claim: "gap", evidence_refs: [] }] }] }, sectionEvidenceFor(brief, "O1", settings)).ok).toBe(true);
  });
  it("retains exact origin/evidence in the Draft and excludes verified KB-only claims from verification", async () => {
    const brief = await geoBriefFixture(); const draft = await geoDraftFixture(brief);
    expect(draft.brief_ref.geo_origin).toEqual(brief.geo_origin);
    expect(draft.brief_ref.evidence).toEqual(brief.evidence);
    expect(deriveVerifyList(draft.sections)).toEqual([]);
  });
  it("evaluates a Q from a successful owner even if another owning section was skipped", async () => {
    const brief = await geoBriefFixture(); const draft = await geoDraftFixture(brief);
    const second = draft.sections[1]!;
    const sections = [draft.sections[0]!, { id: second.id, h2: second.h2, answers: ["Q1", "Q2"], status: "skipped" as const }];
    const decision = decideCoverage(brief, sections);
    expect(decision.askable).toContain("Q1");
    expect(decision.heuristic.map(item => item.question_id)).toEqual(["Q2"]);
  });
  it("plans the same Draft sections while carrying KB facts rather than AI sample claims", async () => {
    const brief = await geoBriefFixture();
    expect(planSections(brief, ["O1", "O2"])).toMatchObject({ requested: [{ id: "O1" }, { id: "O2" }] });
    const scope = sectionEvidenceScope(brief, "O1", settings);
    expect(scope.citableCrawlIds.size).toBe(0);
    const evidence = sectionEvidenceFor(brief, "O1", settings);
    const valid = validateSectionOutput({ paragraphs: [{ sentences: [{ text: "The fixture tool supports three seats.", claim: "bound", evidence_refs: ["K1"] }] }] }, evidence);
    expect(valid).toMatchObject({ ok: true, paragraphs: [{ sentences: [{ sources: ["kb"] }] }] });
    expect(validateSectionOutput({ paragraphs: [{ sentences: [{ text: "The AI says the price is one dollar.", claim: "bound", evidence_refs: ["S1"] }] }] }, evidence).ok).toBe(false);
  });
  it("parses both shared branches and keeps the fixed handoff TTL exact", async () => {
    const brief = await geoBriefFixture();
    expect((await parseSharedContentBrief(brief)).ok).toBe(true);
    expect((await parseSharedContentBrief(await withFingerprint(contentBriefFixture()))).ok).toBe(true);
    const handoff = { version: 1, created_at: 1000, expires_at: 1000 + CONTENT_BRIEF_HANDOFF_TTL_MS, brief };
    expect((await parseSharedContentBriefHandoff(handoff, { now: () => 1001 })).ok).toBe(true);
    expect((await parseSharedContentBriefHandoff(handoff, { now: () => handoff.expires_at })).ok).toBe(false);
    expect((await parseSharedContentBriefHandoff({ ...handoff, expires_at: handoff.expires_at + 1 }, { now: () => 1001 })).ok).toBe(false);
  });
});
