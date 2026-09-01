import { describe, expect, it } from "vitest";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { sharedGeoBriefJson, sharedGeoBriefMarkdown } from "./brief-shared-export.ts";

describe("shared GEO Brief evidence-aware exports", () => {
  it("collapses unverified Profile rows in Markdown while preserving exact JSON", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table.push({ id: "FP1", label: "productName", value: null, reason: "unverified", evidence_refs: [] });
    const markdown = sharedGeoBriefMarkdown(brief);
    expect(markdown).toContain("1 website-profile field lacks per-field source authority and is excluded from writable facts.");
    expect(markdown).not.toContain("FP1 productName: null");
    expect(sharedGeoBriefJson(brief)).toContain('"label": "productName"');
  });
  it("exports empty facts as structure-only without changing the legacy payload or fingerprint", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = []; brief.evidence.facts = []; brief.evidence.samples = [];
    brief.geo_origin = { ...brief.geo_origin, kind: "manual", run_ref: null, sample_refs: [] };
    brief.draft_readiness = { writable: ["O1", "O2"], gaps: [] };
    const before = JSON.stringify(brief);
    const markdown = sharedGeoBriefMarkdown(brief);
    expect(markdown).toContain("Structure only: no facts with matching source records were supplied.");
    expect(markdown).toContain("0 facts with source records; 0 observed topics from 0 answered samples");
    expect(markdown).toContain("No linked website profile snapshot");
    expect(markdown).toContain("System opening rule based on the frozen question");
    expect(markdown).toContain("Outline section IDs are not a guarantee of factual readiness");
    expect(sharedGeoBriefJson(brief)).toBe(`${JSON.stringify(JSON.parse(before), null, 2)}\n`);
    expect(JSON.parse(sharedGeoBriefJson(brief))).toEqual(JSON.parse(before));
    expect(JSON.stringify(brief)).toBe(before);
  });

  it("distinguishes system opening instructions, frozen role requirements and observed topics", async () => {
    const brief = await geoBriefFixture();
    brief.evidence.kb_requirements = [{ id: "R1", text: "Must explain support options." }];
    brief.must_answer.items.push({ ...brief.must_answer.items[0]!, id: "Q3", q: "Must explain support options." });
    const markdown = sharedGeoBriefMarkdown(brief);
    expect(markdown).toContain("System opening rule based on the frozen question");
    expect(markdown).toContain("Decision requirement from the frozen role");
    expect(markdown).toContain("Topic observed in answer samples");
    expect(markdown).toContain("## Frozen role requirements\n- R1: Must explain support options.");
    expect(markdown).toContain("not a separately confirmed scoring criterion");
    expect(markdown).toContain("Listed facts without a usable value or matching source record: 1.");
  });

  it("does not describe a missing outline as an available structure-only draft", async () => {
    const brief = await geoBriefFixture();
    brief.outline = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
    brief.fact_table = []; brief.evidence.facts = [];
    const markdown = sharedGeoBriefMarkdown(brief);
    expect(markdown).toContain("No usable outline was supplied; Draft cannot be generated.");
    expect(markdown).not.toContain("Structure only:");
  });

  it("calls out linked answers that produced no reusable observed topics", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = brief.fact_table.filter(fact => fact.value !== null);
    for (const sample of brief.evidence.samples) sample.topics = [];
    for (const item of brief.must_answer.items) if (item.source === "ai_sample") { item.covered_by = 0; item.cluster.members = []; }
    const markdown = sharedGeoBriefMarkdown(brief);
    expect(markdown).toContain("Linked answers were present, but they did not yield any reusable observed topics for this Brief.");
  });

  it("carries an exact-question revision warning into Markdown without changing JSON", async () => {
    const brief = await geoBriefFixture(); const original = sharedGeoBriefJson(brief);
    expect(sharedGeoBriefMarkdown(brief, { questionNeedsRevision: true })).toContain("The exact frozen question needs revision. Do not generate a Draft until a corrected version is confirmed.");
    expect(sharedGeoBriefJson(brief)).toBe(original);
  });
});
