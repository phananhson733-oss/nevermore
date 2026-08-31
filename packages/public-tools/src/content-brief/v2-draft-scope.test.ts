import { describe, expect, it } from "vitest";
import { confirmBriefV2, fingerprintBriefV2, parseConfirmedBriefV2 } from "./v2-brief.ts";
import { measureResearchLength, type ResearchPage } from "./v2-contract.ts";
import type { DraftV2Settings } from "./v2-draft-contract.ts";
import { buildDraftV2SectionScope, planDraftV2Sections } from "./v2-draft-scope.ts";
import { validateDraftV2Section } from "./v2-draft-section.ts";
import { validateModelBriefV2 } from "./v2-generation.ts";
import type { BriefV2Context, ConfirmedBriefV2, ContentBriefV2, ModelBriefV2Output } from "./v2-generation-contract.ts";
import { buildResearchBundle } from "./v2-research.ts";

const settings: DraftV2Settings = { tone: "explanatory", person: "second", product_mention: "none" };
const collectedAt = "2026-08-31T01:00:00.000Z";

function page(id: string, role: ResearchPage["role"], texts: readonly string[]): ResearchPage {
  const url = `https://${role === "owned" ? "owned" : "competitor"}.test/${id}`;
  return {
    id, role, url, final_url: url, fetched_at: collectedAt, content_hash: "a".repeat(64), body_complete: true,
    research: {
      segments: texts.map((text) => ({ heading: null, text, truncated: false })),
      segments_total: texts.length, omitted_segments: 0, length: measureResearchLength(texts.join(" "), "en"),
    },
  };
}

async function fixture(options: { action?: "create" | "update" | "undecidable"; reverse?: boolean; language?: string; gap?: boolean } = {}): Promise<ConfirmedBriefV2> {
  const research = buildResearchBundle([
    page("C1", "competitor", ["Reporting is delayed.", "Check the date range.", "Read the freshness indicator."]),
    page("C2", "competitor", ["Collection and reporting differ.", "Compare complete periods."]),
    page("T1", "owned", ["Current reporting introduction.", "Current reporting method.", "Current reporting caveat."]),
    page("T2", "owned", ["Dedicated date comparison guide."]),
  ], [
    { id: "A1", question: "Why is reporting delayed?", seed_question: null },
    { id: "A2", question: "Which reporting approach should I choose?", seed_question: null },
  ]);
  if (!research.ok) throw new Error(research.path);
  const context: BriefV2Context = {
    input: { primary: "reporting delay", supporting: ["data freshness"], market: "US", language: options.language ?? "en" },
    research: research.value,
    facts: [
      { id: "P1", field: "coreFeatures[0]", text: "Compares reporting periods", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } },
      { id: "P2", field: "audience", text: "May suit analysts", derivation: "inferred", provenance: { method: "model", derived_from: ["product_profile"] } },
      { id: "P3", field: "coreFeatures[1]", text: "Exports comparison tables", derivation: "observed", provenance: { method: "observed", origin: "product_profile" } },
    ],
    profile_snapshot: { website_id: "website-1", revision: 2, hash: "b".repeat(64) },
    gsc: {
      status: "complete", property: "sc-domain:owned.test", reason: null,
      window: { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 }, omitted_matches: 0,
      matches: [
        { id: "G1", query: "reporting delay", keyword: "reporting delay", scope: "primary", page: "https://owned.test/T1", clicks: 1, impressions: 3, position: 70 },
        { id: "G2", query: "data freshness", keyword: "data freshness", scope: "supporting", page: "https://owned.test/T2", clicks: 0, impressions: 1, position: null },
      ],
    },
    candidates: [
      { id: "T1", url: "https://owned.test/T1", match_refs: ["G1"], read: "observed" },
      { id: "T2", url: "https://owned.test/T2", match_refs: ["G2"], read: "observed" },
    ],
  };
  const action = options.action ?? "create";
  const model: ModelBriefV2Output = {
    research: {
      questions: [
        { anchor: "U1", q: "Why is reporting delayed?", sources: ["U1", "U3", "U10"] },
        { anchor: "U5", q: "How do I compare dates?", sources: ["U5", "U4"] },
        { anchor: "U11", q: "Which reporting approach should I choose?", sources: ["U11"] },
        { anchor: "U2", q: "How does collection differ from reporting?", sources: ["U2", "U10"] },
      ],
      outline: [
        { h2: "Understand reporting", h3: ["Check the collection timeline"], answers: ["U1", "U2"] },
        { h2: "Compare dates", h3: [], answers: ["U5"] },
        { h2: "Choose an approach", h3: [], answers: ["U11"] },
      ],
    },
    intent: { value: "informational", rationale: "Explain reporting limitations." },
    format: { value: "guide", rationale: "Provide a sequence of reporting checks." },
    page_plan: {
      action, rationale: "The recommendation is scoped to the observed sample.", target_ref: action === "update" ? "T1" : null,
      steps: action === "update" ? [
        { kind: "keep", instruction: "Keep the current reporting method.", sources: ["U7"], answers: [] },
        { kind: "rewrite", instruction: "Clarify the global reporting caveat.", sources: ["U9"], answers: [] },
        { kind: "add", instruction: "Add freshness guidance to the introduction.", sources: ["U8"], answers: ["U1"] },
        { kind: "add", instruction: "Add complete-period comparison guidance.", sources: ["U6"], answers: ["U5"] },
        { kind: "rewrite", instruction: "Connect the current introduction to date checks.", sources: ["U3"], answers: ["U5"] },
      ] : [],
    },
    gap_angle: options.gap === false ? null : {
      value: "Explain a profile-informed comparison approach", rationale: "Use the declared feature and label the inferred audience.",
      fact_refs: ["P1", "P2"], sources: ["U8"],
    },
    internal_links: [], do_not_cover: [],
  };
  const generated = validateModelBriefV2(model, context);
  if (!generated.ok) throw new Error(generated.path);
  const unsigned: ContentBriefV2 = {
    schema: "gengrowth.content_brief/v2", context, generated: generated.value,
    run: {
      run_id: "scope-fixture", collected_at: collectedAt, elapsed_ms: 42, budget_ms: 45000,
      reads: [
        { source: "serp", status: "complete", attempted: 2, retained: 2, reason: null },
        { source: "paa", status: "complete", attempted: 2, retained: 2, reason: null },
        { source: "competitors", status: "complete", attempted: 2, retained: 2, reason: null },
        { source: "owned_pages", status: "complete", attempted: 2, retained: 2, reason: null },
        { source: "gsc", status: "complete", attempted: 2, retained: 2, reason: null },
        { source: "profile", status: "complete", attempted: 3, retained: 3, reason: null },
      ],
      llm: { status: "complete", calls: 1, model_id: "fixture-model", temperature_requested: 0.2, temperature_effective: null, input_tokens: 200, output_tokens: 100 },
      serp_cost_usd: 0.004, prompt_bytes: 4096, fingerprint: "0".repeat(64),
    },
  };
  const brief = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintBriefV2(unsigned) } };
  const outline = generated.value.research.outline.map((section) => ({ ...section, h2: `Edited ${section.h2}`, h3: section.h3.map((heading) => `Edited ${heading}`) }));
  const confirmed = await confirmBriefV2(brief, {
    outline: options.reverse === true ? outline.reverse() : outline, revision: 2, confirmed_at: collectedAt,
    resolution: action === "undecidable" ? "create_despite_uncertainty" : "accept_recommendation",
  });
  if (!confirmed.ok) throw new Error(confirmed.path);
  const parsed = await parseConfirmedBriefV2(confirmed.value);
  if (!parsed.ok) throw new Error(parsed.path);
  return parsed.value;
}

function freeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

describe("Draft v2 exact section scope", () => {
  it("keeps stable question mappings and only the selected granular page units", async () => {
    const confirmed = await fixture();
    const result = buildDraftV2SectionScope(confirmed, "O1", settings);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.section).toEqual(confirmed.outline[0]);
    expect(result.value).toMatchObject({ allowed_h3: ["Edited Check the collection timeline"] });
    expect(result.value.allowed_h3).not.toBe(confirmed.outline[0]!.h3);
    expect(result.value.questions.map((question) => question.id)).toEqual(["Q1", "Q4"]);
    expect(result.value.question_unit_refs).toEqual(["U1", "U3", "U10", "U2"]);
    expect([...result.value.page_units]).toEqual([
      ["U1", { page_ref: "C1", final_url: "https://competitor.test/C1" }],
      ["U3", { page_ref: "T1", final_url: "https://owned.test/T1" }],
      ["U2", { page_ref: "C2", final_url: "https://competitor.test/C2" }],
    ]);
    expect(result.value).toMatchObject({ action: "create", target_ref: null, target_page: null, steps: [], gap_angle: null });
  });

  it("retains a PAA-only question without promoting its unit or gap sources to bound evidence", async () => {
    const result = buildDraftV2SectionScope(await fixture(), "O3", { ...settings, product_mention: "gap_only" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.questions).toMatchObject([{ id: "Q3", source_refs: ["U11"], covered_by: 0, paa_refs: ["A2"] }]);
    expect(result.value.question_unit_refs).toEqual(["U11"]);
    expect(result.value).toMatchObject({ allowed_h3: [] });
    expect(result.value.page_units.size).toBe(0);
    expect(validateDraftV2Section({ paragraphs: [{ sentences: [{ text: "A supported reporting fact.", claim: "bound", evidence_refs: ["U11"] }] }] }, result.value, "en").ok).toBe(false);
  });

  it("adds every target unit and only applicable update instructions and their page units", async () => {
    const confirmed = await fixture({ action: "update" });
    const result = buildDraftV2SectionScope(confirmed, "O1", settings);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.action).toBe("update");
    expect(result.value.target_ref).toBe("T1");
    expect(result.value.target_page).toEqual(confirmed.brief.context.research.pages.find((item) => item.id === "T1"));
    expect([...result.value.page_units.keys()].sort()).toEqual(["U1", "U2", "U3", "U7", "U8", "U9"]);
    expect(result.value.steps.map((step) => step.instruction)).toEqual(confirmed.brief.generated!.page_plan.steps.slice(0, 3).map((step) => step.instruction));
    expect(result.value.steps[2]?.answers).toEqual(["Q1"]);
    expect(result.value.question_unit_refs).toEqual(["U1", "U3", "U10", "U2"]);
  });

  it("provides current target context and global keep/rewrite instructions to a PAA-only update section", async () => {
    const result = buildDraftV2SectionScope(await fixture({ action: "update" }), "O3", settings);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect([...result.value.page_units.keys()]).toEqual(["U3", "U7", "U9"]);
    expect(result.value.steps.map((step) => step.kind)).toEqual(["keep", "rewrite"]);
  });

  it.each(["none", "gap_only", "throughout"] as const)("applies product-mention %s to facts and original gap permission", async (product_mention) => {
    const confirmed = await fixture({ reverse: true });
    const first = buildDraftV2SectionScope(confirmed, "O1", { ...settings, product_mention });
    const gap = buildDraftV2SectionScope(confirmed, "O3", { ...settings, product_mention });
    expect(first.ok && gap.ok).toBe(true);
    if (!first.ok || !gap.ok) throw new Error("Expected section scopes");
    expect([...first.value.facts.keys()]).toEqual(product_mention === "throughout" ? ["P1", "P2", "P3"] : []);
    expect(first.value.stance_allowed).toBe(false);
    expect(first.value.gap_angle).toBeNull();
    expect([...gap.value.facts.keys()]).toEqual(product_mention === "none" ? [] : product_mention === "gap_only" ? ["P1", "P2"] : ["P1", "P2", "P3"]);
    expect(gap.value.stance_allowed).toBe(product_mention !== "none");
    expect(gap.value.gap_angle).toEqual(product_mention === "none" ? null : confirmed.brief.generated!.gap_angle);
  });

  it("does not invent a stance section when the generated gap is absent", async () => {
    const result = buildDraftV2SectionScope(await fixture({ gap: false }), "O3", { ...settings, product_mention: "throughout" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect([...result.value.facts.keys()]).toEqual(["P1", "P2", "P3"]);
    expect(result.value).toMatchObject({ gap_angle: null, stance_allowed: false });
  });

  it("retains inferred profile provenance but the body validator refuses it as a bound claim", async () => {
    const result = buildDraftV2SectionScope(await fixture(), "O3", { ...settings, product_mention: "gap_only" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(result.value.facts.get("P2")?.derivation).toBe("inferred");
    const body = (claim: "bound" | "stance") => ({ paragraphs: [{ sentences: [{ text: "This may suit analysts.", claim, evidence_refs: ["P2"] }] }] });
    expect(validateDraftV2Section(body("bound"), result.value, "en").ok).toBe(false);
    expect(validateDraftV2Section(body("stance"), result.value, "en").ok).toBe(true);
  });

  it("requires explicit uncertainty resolution and never falls through to update or create", async () => {
    const confirmed = await fixture({ action: "undecidable" });
    expect(buildDraftV2SectionScope(confirmed, "O1", settings)).toMatchObject({ ok: true, value: { action: "create", target_ref: null, target_page: null, steps: [] } });
    expect(buildDraftV2SectionScope({ ...confirmed, resolution: "accept_recommendation" }, "O1", settings).ok).toBe(false);
    const create = await fixture();
    expect(buildDraftV2SectionScope({ ...create, resolution: "create_despite_uncertainty" }, "O1", settings).ok).toBe(false);
    const invalidResolution = structuredClone(create);
    Reflect.set(invalidResolution, "resolution", "unconfirmed");
    expect(buildDraftV2SectionScope(invalidResolution, "O1", settings).ok).toBe(false);
    const invalidAction = structuredClone(create);
    Reflect.set(invalidAction.brief.generated!, "page_plan", { ...invalidAction.brief.generated!.page_plan, action: "publish" });
    expect(buildDraftV2SectionScope(invalidAction, "O1", settings).ok).toBe(false);
  });

  it.each(["unavailable", "redirected", "missing_page", "foreign_role", "empty_target", "unknown_target"])("rejects an update with %s target context", async (kind) => {
    const confirmed = await fixture({ action: "update" });
    const context = confirmed.brief.context;
    const changed: ConfirmedBriefV2 = { ...confirmed, brief: { ...confirmed.brief, context: {
      ...context,
      candidates: context.candidates.map((candidate) => candidate.id === "T1" && (kind === "unavailable" || kind === "redirected") ? { ...candidate, read: kind } : candidate),
      research: { ...context.research, pages: kind === "missing_page" ? context.research.pages.filter((item) => item.id !== "T1") : context.research.pages.map((item) => {
        if (item.id !== "T1") return item;
        if (kind === "foreign_role") return { ...item, role: "competitor" as const };
        return kind === "empty_target" ? { ...item, research: { ...item.research, segments: [] } } : item;
      }) },
    }, generated: kind === "unknown_target" ? { ...confirmed.brief.generated!, page_plan: { ...confirmed.brief.generated!.page_plan, target_ref: "T99" } } : confirmed.brief.generated } };
    expect(buildDraftV2SectionScope(changed, "O1", settings).ok).toBe(false);
  });

  it.each(["section", "question", "unit", "page", "segment", "paa", "step", "fact"])("rejects unknown %s references rather than silently reducing scope", async (kind) => {
    const confirmed = await fixture({ action: "update" });
    const generated = confirmed.brief.generated!;
    const context = confirmed.brief.context;
    const changed: ConfirmedBriefV2 = {
      ...confirmed,
      outline: kind === "question" ? confirmed.outline.map((section) => section.id === "O1" ? { ...section, answers: ["Q99"] } : section) : confirmed.outline,
      brief: {
        ...confirmed.brief,
        generated: {
          ...generated,
          research: { ...generated.research, questions: kind === "unit" ? generated.research.questions.map((question) => question.id === "Q1" ? { ...question, source_refs: ["U99"] } : question) : generated.research.questions },
          page_plan: { ...generated.page_plan, steps: kind === "step" ? [{ ...generated.page_plan.steps[0]!, sources: ["U99"] }] : generated.page_plan.steps },
          gap_angle: kind === "fact" ? { ...generated.gap_angle!, fact_refs: ["P99"] } : generated.gap_angle,
        },
        context: { ...context, research: {
          ...context.research,
          units: context.research.units.map((unit) => {
            if (unit.id === "U1" && unit.kind === "page") return kind === "page" ? { ...unit, page_ref: "C99" } : kind === "segment" ? { ...unit, segment_index: 99 } : unit;
            return kind === "paa" && unit.id === "U10" && unit.kind === "paa" ? { ...unit, paa_ref: "A99" } : unit;
          }),
        } },
      },
    };
    expect(buildDraftV2SectionScope(changed, kind === "section" ? "O99" : kind === "fact" ? "O3" : "O1", { ...settings, product_mention: "gap_only" }).ok).toBe(false);
  });

  it("does not mutate the confirmed graph or share mutable returned data with it", async () => {
    const confirmed = await fixture({ action: "update" });
    const before = structuredClone(confirmed);
    freeze(confirmed);
    const result = buildDraftV2SectionScope(confirmed, "O3", { ...settings, product_mention: "throughout" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.path);
    expect(confirmed).toEqual(before);
    expect(result.value.section).not.toBe(confirmed.outline[2]);
    expect(result.value.questions[0]).not.toBe(confirmed.brief.generated!.research.questions[2]);
    expect(result.value.facts.get("P1")).not.toBe(confirmed.brief.context.facts[0]);
    expect(result.value.target_page).not.toBe(confirmed.brief.context.research.pages.find((item) => item.id === "T1"));
    expect(result.value.steps[0]).not.toBe(confirmed.brief.generated!.page_plan.steps[0]);
    expect(result.value.gap_angle).not.toBe(confirmed.brief.generated!.gap_angle);
    result.value.facts.get("P1")!.text = "Changed detached value";
    expect(confirmed).toEqual(before);
  });
});

describe("Draft v2 selected-section planning", () => {
  it("returns selected and skipped sections in effective confirmed order without a language gate", async () => {
    const confirmed = await fixture({ reverse: true, language: "zh-CN" });
    const before = structuredClone(confirmed);
    freeze(confirmed);
    const result = planDraftV2Sections(confirmed, ["O1", "O3"]);
    expect(result).toEqual({ ok: true, value: { requested: [confirmed.outline[0], confirmed.outline[2]], skipped: [confirmed.outline[1]] } });
    if (!result.ok) throw new Error(result.path);
    expect(result.value.requested[0]).not.toBe(confirmed.outline[0]);
    expect(confirmed).toEqual(before);
  });

  it.each([[], ["O1", "O1"], ["O99"], ["O1", "O99"], [""], [" O1"]].map((ids) => ({ ids })))("rejects invalid selected IDs $ids", async ({ ids }) => {
    expect(planDraftV2Sections(await fixture(), ids).ok).toBe(false);
  });

  it.each(["unconfirmed", "missing_generation", "empty_outline", "empty_questions"])("refuses %s rather than emitting an empty draft", async (kind) => {
    const confirmed = await fixture();
    const generated = confirmed.brief.generated!;
    const changed = { ...confirmed, brief: { ...confirmed.brief, generated: kind === "missing_generation" ? null : {
      ...generated, research: { ...generated.research, outline: kind === "empty_outline" ? [] : generated.research.outline, questions: kind === "empty_questions" ? [] : generated.research.questions },
    } } };
    if (kind === "unconfirmed") Reflect.set(changed, "schema", "gengrowth.content_brief/v2");
    expect(buildDraftV2SectionScope(changed, "O1", settings).ok).toBe(false);
    expect(planDraftV2Sections(changed, ["O1"]).ok).toBe(false);
  });
});
