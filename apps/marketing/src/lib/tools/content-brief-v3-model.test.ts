import { describe, expect, it } from "vitest";
import { buildSerpObservations } from "@sf/public-tools/content-brief/assemble";
import { measureResearchLength, type ResearchPage } from "@sf/public-tools/content-brief/v2-contract";
import type { BriefV2Context } from "@sf/public-tools/content-brief/v2-generation-contract";
import { validateModelBriefV2 } from "@sf/public-tools/content-brief/v2-generation";
import { buildResearchBundle } from "@sf/public-tools/content-brief/v2-research";
import { validateSectionQuestionsBrief } from "./content-brief-v3-model.ts";

function page(id: string, text: string): ResearchPage {
  const role = id.startsWith("T") ? "owned" : "competitor";
  const url = `https://${role}.example/${id}`;
  return {
    id, role, url, final_url: url, fetched_at: "2026-08-31T00:00:00.000Z", content_hash: "a".repeat(64), body_complete: true,
    research: { segments: [{ heading: null, text, truncated: false }], segments_total: 1, omitted_segments: 0, length: measureResearchLength(text, "en") },
  };
}

function context(): BriefV2Context {
  const pages = [
    page("C1", "Reporting follows data collection."), page("C2", "Compare complete date ranges."),
    page("T1", "This reporting page explains collection delays."), page("T2", "This reference explains date comparisons."),
  ];
  const research = buildResearchBundle(pages, [
    { id: "A1", question: "Why is reporting delayed?", seed_question: null },
    { id: "A2", question: "Which dates should I compare?", seed_question: null },
    { id: "A3", question: "When is a reporting period complete?", seed_question: null },
    { id: "A4", question: "How do I check collection time?", seed_question: null },
    { id: "A5", question: "Where is the date filter?", seed_question: null },
  ]);
  if (!research.ok) throw new Error(research.path);
  return {
    input: { primary: "reporting delay", supporting: ["report dates"], market: "US", language: "en" }, research: research.value,
    facts: [{ id: "P1", field: "feature", text: "Compares complete date ranges", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } }],
    profile_snapshot: { website_id: "synthetic-website", revision: 1, hash: "b".repeat(64) },
    gsc: { status: "complete", property: "sc-domain:owned.example", window: { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 }, reason: null, omitted_matches: 0,
      matches: [{ id: "G1", query: "reporting delay", keyword: "reporting delay", scope: "primary", page: "https://owned.example/T1", clicks: 1, impressions: 2, position: 20 }] },
    candidates: [{ id: "T1", url: "https://owned.example/T1", match_refs: ["G1"], read: "observed" }, { id: "T2", url: "https://owned.example/T2", match_refs: [], read: "observed" }],
    serp: { rows: buildSerpObservations(pages.filter((item) => item.role === "competitor").map((item, index) => ({ rank: index + 1, url: item.url, domain: "competitor.example", title: "Reporting guidance" }))), read: { status: "complete", requested: 2, returned: 2, unresolved: 0 } },
  };
}

/** Independent model wire fixture, not produced by the adapter under test. */
function wire() {
  return {
    research: { sections: [
      { h2: "Understand reporting", h3: ["Collection timing"], questions: [
        { anchor: "U1", q: "Why is reporting delayed?", sources: ["U1", "U5"] },
        { anchor: "U2", q: "How do complete periods help?", sources: ["U2"] },
      ] },
      { h2: "Check date ranges", h3: [], questions: [{ anchor: "U6", q: "Which dates should I compare?", sources: ["U6", "U2"] }] },
    ] },
    intent: { value: "informational", rationale: "Explain reporting and date checks." },
    format: { value: "guide", rationale: "Organize the reporting steps." },
    page_plan: { action: "update", rationale: "The observed target already explains reporting delays.", target_ref: "T1", steps: [
      { kind: "keep", instruction: "Keep the collection explanation.", sources: ["U3"], answers: ["U1"] },
      { kind: "add", instruction: "Add complete-period comparison guidance.", sources: ["U2"], answers: ["U2", "U6"] },
    ] },
    gap_angle: { value: "Use complete-period comparisons", rationale: "Connect the comparison feature to reporting guidance.", fact_refs: ["P1"], sources: ["U2"] },
    internal_links: [{ page_ref: "T2", anchor: "date comparison reference", why: "The observed page covers date comparisons." }],
    do_not_cover: [{ page_ref: "T2", topic: "Date comparison setup", why: "The reference already explains that setup." }],
  };
}

function emptyWire() {
  return { ...wire(), research: { sections: [] }, intent: null, format: null,
    page_plan: { action: "undecidable", rationale: "No relevant questions were selected.", target_ref: null, steps: [] }, gap_angle: null, internal_links: [], do_not_cover: [] };
}

function changed(input: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const result = structuredClone(input) as Record<string | number, unknown>;
  let cursor = result;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string | number, unknown>;
  cursor[path.at(-1)!] = value;
  return result;
}

describe("Brief v3 private section-question model protocol", () => {
  it.each([null, undefined, [], {}, "not JSON"])("rejects a non-envelope input: %j", (input) => {
    expect(validateSectionQuestionsBrief(input, context())).toMatchObject({ ok: false });
  });

  it("derives question and outline links from explicit nested questions without changing their text or sources", () => {
    const input = wire(); const source = context(); const before = JSON.stringify({ input, source });
    const result = validateSectionQuestionsBrief(input, source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.research).toEqual({
      questions: [
        { id: "Q1", anchor: "U1", q: "Why is reporting delayed?", source_refs: ["U1", "U5"], covered_by: 1, paa_refs: ["A1"] },
        { id: "Q2", anchor: "U2", q: "How do complete periods help?", source_refs: ["U2"], covered_by: 1, paa_refs: [] },
        { id: "Q3", anchor: "U6", q: "Which dates should I compare?", source_refs: ["U6", "U2"], covered_by: 1, paa_refs: ["A2"] },
      ],
      outline: [
        { id: "O1", h2: "Understand reporting", h3: ["Collection timing"], answers: ["Q1", "Q2"] },
        { id: "O2", h2: "Check date ranges", h3: [], answers: ["Q3"] },
      ],
    });
    expect(result.value.page_plan).toEqual({ ...input.page_plan, steps: [{ ...input.page_plan.steps[0], answers: ["Q1"] }, { ...input.page_plan.steps[1], answers: ["Q2", "Q3"] }] });
    for (const field of ["intent", "format", "gap_angle", "internal_links", "do_not_cover"] as const) expect(result.value[field]).toEqual(input[field]);
    expect(JSON.stringify({ input, source })).toBe(before);
  });

  it("allows zero sections as zero selected questions without manufacturing an outline", () => {
    expect(validateSectionQuestionsBrief(emptyWire(), context())).toMatchObject({ ok: true, value: { research: { questions: [], outline: [] } } });
  });

  it("does not accept the historical flat model protocol as a fallback", () => {
    const nested = wire();
    const flat = { ...nested, research: { questions: [
      { anchor: "U1", q: "Why is reporting delayed?", sources: ["U1", "U5"] },
      { anchor: "U2", q: "How do complete periods help?", sources: ["U2"] },
      { anchor: "U6", q: "Which dates should I compare?", sources: ["U6", "U2"] },
    ], outline: [{ h2: "Understand reporting", h3: ["Collection timing"], answers: ["U1", "U2"] }, { h2: "Check date ranges", h3: [], answers: ["U6"] }] } };
    expect(validateModelBriefV2(flat, context()).ok).toBe(true);
    expect(validateSectionQuestionsBrief(flat, context())).toMatchObject({ ok: false });
  });

  it.each([
    [["extra"], true], [["research", "extra"], true], [["research", "questions"], []],
    [["research", "sections", 0, "extra"], true], [["research", "sections", 0, "answers"], ["U9"]],
    [["research", "sections", 0, "questions", 0, "extra"], true],
  ] as const)("rejects unknown keys at %j instead of dropping them during projection", (path, value) => {
    expect(validateSectionQuestionsBrief(changed(wire(), path, value), context())).toMatchObject({ ok: false });
  });

  it.each([
    [["research"], null], [["research", "sections"], null], [["research", "sections"], {}],
    [["research", "sections", 0], null], [["research", "sections", 0, "questions"], null],
    [["research", "sections", 0, "questions"], []], [["research", "sections", 0, "questions", 0], null],
    [["research", "sections", 0, "questions", 0, "q"], undefined],
    [["research", "sections", 0, "h2"], undefined], [["research", "sections", 0, "h3"], undefined],
  ] as const)("rejects malformed nested structure at %j without guessing missing values", (path, value) => {
    expect(validateSectionQuestionsBrief(changed(wire(), path, value), context())).toMatchObject({ ok: false });
  });

  it.each(["one", "seven"] as const)("accepts eight questions across %s sections and delegates public IDs to the existing validator", (count) => {
    const questions = Array.from({ length: 8 }, (_, index) => ({ anchor: `U${index + 1}`, q: `Reporting question ${index + 1}?`, sources: [`U${index + 1}`] }));
    const sections = count === "one" ? [{ h2: "Reporting questions", h3: [], questions }]
      : [{ h2: "First two questions", h3: [], questions: questions.slice(0, 2) }, ...questions.slice(2).map((question, index) => ({ h2: `Remaining question ${index + 1}`, h3: [], questions: [question] }))];
    const result = validateSectionQuestionsBrief({ ...emptyWire(), intent: wire().intent, format: wire().format, research: { sections } }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.research.questions.map((question) => question.id)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"]);
    expect(result.value.research.outline).toHaveLength(count === "one" ? 1 : 7);
  });

  it.each(["sections", "per-section", "total"] as const)("rejects the %s bound without truncating any model item", (kind) => {
    const questions = Array.from({ length: 9 }, (_, index) => ({ anchor: `U${index + 1}`, q: `Reporting question ${index + 1}?`, sources: [`U${index + 1}`] }));
    const sections = kind === "sections" ? questions.slice(0, 8).map((question) => ({ h2: "Reporting", h3: [], questions: [question] }))
      : kind === "per-section" ? [{ h2: "Reporting", h3: [], questions }]
        : [{ h2: "First questions", h3: [], questions: questions.slice(0, 5) }, { h2: "More questions", h3: [], questions: questions.slice(5) }];
    expect(validateSectionQuestionsBrief({ ...emptyWire(), intent: wire().intent, format: wire().format, research: { sections } }, context())).toMatchObject({ ok: false });
  });

  it.each([
    [["research", "sections", 0, "questions", 0, "anchor"], "U999"],
    [["research", "sections", 0, "questions", 0, "anchor"], "Q1"],
    [["research", "sections", 0, "questions", 0, "sources"], ["U2"]],
    [["research", "sections", 0, "questions", 0, "sources"], ["U1", "U1"]],
    [["research", "sections", 1, "questions", 0], { anchor: "U1", q: "Duplicate anchor?", sources: ["U1"] }],
    [["page_plan", "target_ref"], "T3"],
    [["page_plan", "steps", 0, "sources"], ["U2"]],
    [["page_plan", "steps", 0, "sources"], ["U5"]],
    [["page_plan", "steps", 1, "answers"], ["U9"]],
    [["gap_angle", "sources"], ["U3"]],
    [["gap_angle", "sources"], ["U5"]],
    [["gap_angle", "sources"], ["U999"]],
    [["gap_angle", "fact_refs"], ["P99"]],
    [["internal_links", 0, "page_ref"], "T1"],
  ] as const)("preserves the existing strict source and plan rejection at %j", (path, value) => {
    expect(validateSectionQuestionsBrief(changed(wire(), path, value), context())).toMatchObject({ ok: false });
  });

  it("does not weaken the existing frozen-context validator", () => {
    const source = context();
    const invalid = { ...source, research: { ...source.research, units: [{ id: "U1", kind: "page" as const, page_ref: "C99", segment_index: 0 }] } };
    expect(validateSectionQuestionsBrief(wire(), invalid)).toMatchObject({ ok: false });
  });
});
