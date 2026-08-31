import { describe, expect, it } from "vitest";
import { parseConfirmedBriefV2, parseContentBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { draftResultV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import { parseDraftResultV2 } from "@sf/public-tools/content-brief/v2-draft";
import { buildBriefV2Observations } from "../src/lib/tools/content-brief-v2-observations.ts";
import { createBriefV3Fixture, createConfirmedBriefV3Fixture, createCoverageGapDraftFixture } from "./content-brief-v3-fixtures.ts";

describe("offline Brief v3 browser receipts", () => {
  it.each(["en", "zh"] as const)("strictly validates a %s v3 receipt with actual synthetic SERP rows and separate denominators", async (locale) => {
    const value = await createBriefV3Fixture({ locale });
    expect(value.schema).toBe("gengrowth.content_brief/v3");
    expect(await parseContentBriefV2(value)).toEqual({ ok: true, value });
    expect(value.context.serp?.rows).toHaveLength(10);
    const observations = buildBriefV2Observations(value.context);
    expect(observations.formats.method).toBe("url_title_heuristic");
    expect(observations.formats.denominator).toBe(10);
    expect(observations.question_coverage_denominator).toBe(1);
  });

  it("preserves observed lengths, owned evidence and raw PAA when no model result exists", async () => {
    const value = await createBriefV3Fixture({ action: "update", unavailable: true });
    expect(value.schema).toBe("gengrowth.content_brief/v3");
    expect(await parseContentBriefV2(value)).toEqual({ ok: true, value });
    expect(value.generated).toBeNull();
    expect(value.context.gsc.matches).toHaveLength(1);
    expect(value.context.candidates).toHaveLength(1);
    expect(value.context.research.paa).toHaveLength(2);
    expect(buildBriefV2Observations(value.context).lengths).toHaveLength(1);
  });

  it.each(["create", "update", "undecidable"] as const)("keeps confirmed v3 %s revisions valid in Draft v2", async (action) => {
    const confirmed = await createConfirmedBriefV3Fixture({ action });
    expect(confirmed.schema).toBe("gengrowth.confirmed_brief/v3");
    expect(await parseConfirmedBriefV2(confirmed)).toEqual({ ok: true, value: confirmed });
    const draft = await draftResultV2Fixture(confirmed);
    expect(draft.confirmed_ref.schema).toBe(confirmed.schema);
    expect(await parseDraftResultV2(draft, confirmed)).toEqual({ ok: true, value: draft });
  });

  it.each(["create", "update"] as const)("provides three source-bound %s chapters to test the default collapsed third chapter", async (action) => {
    const confirmed = await createConfirmedBriefV3Fixture({ chapters: 3, action, language: "zh-CN" });
    expect(await parseConfirmedBriefV2(confirmed)).toEqual({ ok: true, value: confirmed });
    expect(confirmed.outline.map((section) => section.id)).toEqual(["O1", "O2", "O3"]);
    expect(confirmed.brief.generated?.research.questions.map((question) => question.id)).toEqual(["Q1", "Q2", "Q3"]);
    const draft = await draftResultV2Fixture(confirmed);
    expect(draft.sections).toHaveLength(3);
    expect(await parseDraftResultV2(draft, confirmed)).toEqual({ ok: true, value: draft });
  });

  it("retains a PAA-only v3 receipt without inventing a competitor-page denominator", async () => {
    const confirmed = await createConfirmedBriefV3Fixture({ paaOnly: true });
    expect(await parseConfirmedBriefV2(confirmed)).toEqual({ ok: true, value: confirmed });
    expect(confirmed.brief.context.research.pages).toEqual([]);
    expect(buildBriefV2Observations(confirmed.brief.context).question_coverage_denominator).toBe(0);
    const draft = await draftResultV2Fixture(confirmed);
    expect(await parseDraftResultV2(draft, confirmed)).toEqual({ ok: true, value: draft });
  });

  it("keeps processing complete distinct from coverage gaps and preserves page/profile/model source tiers", async () => {
    const confirmed = await createConfirmedBriefV3Fixture({ chapters: 3 });
    const result = await createCoverageGapDraftFixture(confirmed, { tone: "explanatory", person: "second", product_mention: "throughout" });
    expect(await parseDraftResultV2(result, confirmed)).toEqual({ ok: true, value: result });
    expect(result.run.mode).toBe("complete");
    expect(result.coverage).toMatchObject({ status: "available", covered: 1, partial: 1, none: 1 });
    const sentences = result.sections.flatMap((section) => section.status === "ok" ? section.body.paragraphs.flatMap((paragraph) => paragraph.sentences) : []);
    expect(sentences[0]).toMatchObject({ claim: "bound", evidence_refs: ["U1"], support_count: 1 });
    expect(sentences[1]).toMatchObject({ claim: "bound", evidence_refs: ["P1"], support_count: 0 });
    expect(sentences[2]).toMatchObject({ claim: "no_claim", evidence_refs: [] });
  });
});
