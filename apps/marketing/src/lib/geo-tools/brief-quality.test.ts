import { describe, expect, it } from "vitest";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { geoBriefQuality, geoBriefQuestionSource } from "./brief-quality.ts";

describe("GEO Brief evidence quality projection", () => {
  it("separates a valid outline from facts and observed answers without trusting historical readiness", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = []; brief.evidence.facts = []; brief.evidence.samples = [];
    brief.geo_origin = { ...brief.geo_origin, kind: "manual", run_ref: null, sample_refs: [] };
    brief.draft_readiness = { writable: ["O1", "O2"], gaps: [] };
    const before = JSON.stringify(brief);
    expect(geoBriefQuality(brief)).toMatchObject({ status: "structure_only", origin: "frozen_question", outlineSections: 2, usableFacts: 0, missingFacts: 0, answeredSamples: 0, observedQuestions: 0, canDraft: true });
    expect(JSON.stringify(brief)).toBe(before);
  });

  it("only counts non-null facts bound to matching receipts and actual observed question coverage", async () => {
    const brief = await geoBriefFixture();
    expect(geoBriefQuality(brief)).toMatchObject({ status: "limited", usableFacts: 1, missingFacts: 1, answeredSamples: 2, observedQuestions: 1, hasProfile: false, hasSiteIndex: true });
    brief.evidence.facts[0]!.text = "A different statement";
    brief.evidence.samples[1]!.status = "failed";
    expect(geoBriefQuality(brief)).toMatchObject({ status: "structure_only", usableFacts: 0, missingFacts: 2, answeredSamples: 1, observedQuestions: 0 });
  });

  it("does not turn absence of null rows into a completeness guarantee", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = brief.fact_table.filter(fact => fact.value !== null);
    expect(geoBriefQuality(brief)).toMatchObject({ status: "evidence_available", usableFacts: 1, missingFacts: 0 });
    brief.evidence.samples = [];
    expect(geoBriefQuality(brief).status).toBe("limited");
  });

  it("keeps answered samples without reusable observed topics in the limited state", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = brief.fact_table.filter(fact => fact.value !== null);
    for (const sample of brief.evidence.samples) sample.topics = [];
    for (const item of brief.must_answer.items) if (item.source === "ai_sample") { item.covered_by = 0; item.cluster.members = []; }
    expect(geoBriefQuality(brief)).toMatchObject({ status: "limited", usableFacts: 1, missingFacts: 0, answeredSamples: 2, observedQuestions: 0 });
  });

  it("blocks Draft for unavailable outlines or a server-identified historical question issue", async () => {
    const brief = await geoBriefFixture();
    expect(geoBriefQuality(brief, { questionNeedsRevision: true })).toMatchObject({ status: "revise_question", canDraft: false });
    brief.outline = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
    expect(geoBriefQuality(brief)).toMatchObject({ status: "no_outline", outlineSections: 0, canDraft: false });
  });

  it("distinguishes a frozen question, a typed question and a visibility run", async () => {
    const brief = await geoBriefFixture();
    expect(geoBriefQuality(brief).origin).toBe("visibility");
    brief.geo_origin.kind = "manual"; brief.geo_origin.run_ref = null;
    expect(geoBriefQuality(brief).origin).toBe("frozen_question");
    brief.geo_origin.question.id = null;
    expect(geoBriefQuality(brief).origin).toBe("typed_question");
  });

  it("distinguishes the system opening rule from frozen role criteria and observed topics", async () => {
    const brief = await geoBriefFixture();
    expect(geoBriefQuestionSource(brief, brief.must_answer.items[0]!)).toBe("openingFrozen");
    expect(geoBriefQuestionSource(brief, brief.must_answer.items[1]!)).toBe("observedQuestion");
    expect(geoBriefQuestionSource(brief, { ...brief.must_answer.items[0]!, id: "Q2" })).toBe("frozenCriterion");
    brief.geo_origin.question.id = null; brief.lead_answer.source = "user_input";
    expect(geoBriefQuestionSource(brief, { ...brief.must_answer.items[0]!, source: "user_input" })).toBe("openingManual");
  });
});
