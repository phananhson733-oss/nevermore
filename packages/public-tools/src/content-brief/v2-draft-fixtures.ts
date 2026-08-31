// @input -- explicit offline create/update, language and PAA-only fixture choices
// @output -- fully validated and fingerprinted confirmed Brief v2 fixtures
// @pos -- reusable deterministic tests only; no provider or production provenance
import { confirmBriefV2, fingerprintBriefV2, parseConfirmedBriefV2 } from "./v2-brief.ts";
import { DRAFT_TOTAL_BUDGET_MS } from "./constants.ts";
import { measureResearchLength, type ResearchPage } from "./v2-contract.ts";
import type { DraftResultV2, DraftV2Section, DraftV2Settings } from "./v2-draft-contract.ts";
import { buildDraftV2SectionScope } from "./v2-draft-scope.ts";
import { validateDraftV2Section } from "./v2-draft-section.ts";
import { assembleDraftV2, type AssembleDraftV2Input } from "./v2-draft.ts";
import { validateModelBriefV2 } from "./v2-generation.ts";
import type { BriefV2Context, ConfirmedBriefV2, ContentBriefV2, ModelBriefV2Output } from "./v2-generation-contract.ts";
import { buildResearchBundle } from "./v2-research.ts";

export interface ConfirmedDraftV2FixtureOptions {
  readonly action?: "create" | "update" | "undecidable";
  readonly language?: string;
  readonly paaOnly?: boolean;
  readonly reverse?: boolean;
}

const collectedAt = "2026-08-31T01:00:00.000Z";

function page(id: string, role: ResearchPage["role"], text: string): ResearchPage {
  const url = `https://${role === "owned" ? "owned" : "competitor"}.test/${id}`;
  return {
    id, role, url, final_url: url, fetched_at: collectedAt, content_hash: "a".repeat(64), body_complete: true,
    research: { segments: [{ heading: null, text, truncated: false }], segments_total: 1, omitted_segments: 0, length: measureResearchLength(text, "en") },
  };
}

export async function confirmedDraftV2Fixture(options: ConfirmedDraftV2FixtureOptions = {}): Promise<ConfirmedBriefV2> {
  const action = options.action ?? "create";
  if (options.paaOnly && action === "update") throw new Error("A PAA-only fixture cannot have an observed update target.");
  const pages = options.paaOnly ? [] : [
    page("C1", "competitor", "Reporting can lag behind collection."),
    page("C2", "competitor", "Compare finalized reporting periods."),
    ...(action === "update" ? [page("T1", "owned", "The current reporting introduction.")] : []),
  ];
  const research = buildResearchBundle(pages, [
    { id: "A1", question: "Why is reporting delayed?", seed_question: null },
    { id: "A2", question: "How should I compare dates?", seed_question: null },
  ]);
  if (!research.ok) throw new Error(research.path);
  const paaRefs = research.value.units.filter((unit) => unit.kind === "paa").map((unit) => unit.id);
  const pageRef = (id: string): string => {
    const found = research.value.units.find((unit) => unit.kind === "page" && unit.page_ref === id);
    if (found === undefined) throw new Error("Missing page fixture " + id);
    return found.id;
  };
  const anchors = options.paaOnly ? paaRefs : [pageRef("C1"), pageRef("C2")];
  const facts: BriefV2Context["facts"] = options.paaOnly ? [] : [
    { id: "P1", field: "feature", text: "Compares finalized reporting periods", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } },
    { id: "P2", field: "audience", text: "May suit analysts", derivation: "inferred", provenance: { method: "model", derived_from: ["product_profile"] } },
  ];
  const context: BriefV2Context = {
    input: { primary: "reporting delay", supporting: [], market: "US", language: options.language ?? "en" },
    research: research.value, facts,
    profile_snapshot: facts.length === 0 ? null : { website_id: "website-fixture", revision: 1, hash: "b".repeat(64) },
    gsc: {
      status: "complete", property: "sc-domain:owned.test", reason: null,
      window: { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 }, omitted_matches: 0,
      matches: action === "update" ? [{ id: "G1", query: "reporting delay", keyword: "reporting delay", scope: "primary", page: "https://owned.test/T1", clicks: 1, impressions: 3, position: 70 }] : [],
    },
    candidates: action === "update" ? [{ id: "T1", url: "https://owned.test/T1", match_refs: ["G1"], read: "observed" }] : [],
  };
  const model: ModelBriefV2Output = {
    research: {
      questions: anchors.map((anchor, index) => ({ anchor, q: research.value.paa[index]!.question, sources: [...new Set([anchor, paaRefs[index]!])] })),
      outline: anchors.map((anchor, index) => ({ h2: index === 0 ? "Understand reporting" : "Compare dates", h3: [index === 0 ? "Collection timing" : "Complete periods"], answers: [anchor] })),
    },
    intent: { value: "informational", rationale: "Explain reporting limitations." },
    format: { value: "guide", rationale: "Provide reporting checks." },
    page_plan: {
      action, rationale: "The recommendation is scoped to the observed sample.", target_ref: action === "update" ? "T1" : null,
      steps: action === "update" ? [
        { kind: "rewrite", instruction: "Clarify the current reporting introduction.", sources: [pageRef("T1")], answers: [anchors[0]!] },
        { kind: "add", instruction: "Add finalized date comparisons.", sources: [pageRef("C2")], answers: [anchors[1]!] },
      ] : [],
    },
    gap_angle: options.paaOnly ? null : { value: "Use finalized comparisons", rationale: "Connect the declared feature to the workflow.", fact_refs: ["P1", "P2"], sources: [pageRef("C2")] },
    internal_links: [], do_not_cover: [],
  };
  const generated = validateModelBriefV2(model, context);
  if (!generated.ok) throw new Error(generated.path);
  const unsigned: ContentBriefV2 = {
    schema: "gengrowth.content_brief/v2", context, generated: generated.value,
    run: {
      run_id: "brief-fixture", collected_at: collectedAt, elapsed_ms: 42, budget_ms: 45000,
      reads: [
        { source: "serp", status: "complete", attempted: 10, retained: 10, reason: null },
        { source: "paa", status: "complete", attempted: 2, retained: 2, reason: null },
        { source: "competitors", status: "complete", attempted: options.paaOnly ? 0 : 2, retained: options.paaOnly ? 0 : 2, reason: null },
        { source: "owned_pages", status: "complete", attempted: action === "update" ? 1 : 0, retained: action === "update" ? 1 : 0, reason: null },
        { source: "gsc", status: "complete", attempted: action === "update" ? 1 : 0, retained: action === "update" ? 1 : 0, reason: null },
        { source: "profile", status: "complete", attempted: facts.length, retained: facts.length, reason: null },
      ],
      llm: { status: "complete", calls: 1, model_id: "offline-fixture-model", temperature_requested: 0.2, temperature_effective: null, input_tokens: 200, output_tokens: 100 },
      serp_cost_usd: null, prompt_bytes: 2048, fingerprint: "0".repeat(64),
    },
  };
  const brief = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintBriefV2(unsigned) } };
  const confirmed = await confirmBriefV2(brief, {
    outline: options.reverse ? [...generated.value.research.outline].reverse() : generated.value.research.outline,
    revision: 2, confirmed_at: collectedAt, resolution: action === "undecidable" ? "create_despite_uncertainty" : "accept_recommendation",
  });
  if (!confirmed.ok) throw new Error(confirmed.path);
  const parsed = await parseConfirmedBriefV2(confirmed.value);
  if (!parsed.ok) throw new Error(parsed.path);
  return parsed.value;
}

/** Overrides still pass the real assembler/parser; malformed fixtures fail at construction. */
export async function draftResultV2Fixture(confirmed: ConfirmedBriefV2, options: Partial<Omit<AssembleDraftV2Input, "confirmed">> = {}): Promise<DraftResultV2> {
  const settings: DraftV2Settings = options.settings ?? { tone: "explanatory", person: "second", product_mention: "none" };
  const sections: DraftV2Section[] = [];
  for (const heading of confirmed.outline) {
    const scope = buildDraftV2SectionScope(confirmed, heading.id, settings);
    if (!scope.ok) throw new Error(scope.path);
    const isCjk = /^(zh|ja|ko|th)(-|_|$)/u.test(confirmed.brief.context.input.language);
    const paragraphs = (heading.h3.length === 0 ? [null] : heading.h3).map((h3) => ({
      heading: h3,
      sentences: [{ text: isCjk ? "请检查完整报告区间。" : "Review the reporting period before comparing results.", claim: "no_claim", evidence_refs: [] }],
    }));
    const body = validateDraftV2Section({ paragraphs }, scope.value, confirmed.brief.context.input.language);
    if (!body.ok) throw new Error(body.path);
    sections.push({ ...heading, status: "ok", body: body.value, llm: { attempts: 1, model_id: "offline-draft-fixture", temperature_requested: 0.4, temperature_effective: null, input_tokens: 50, output_tokens: 20 } });
  }
  const assembled = await assembleDraftV2({
    confirmed, settings, sections: options.sections ?? sections,
    coverage: options.coverage ?? {
      items: confirmed.brief.generated!.research.questions.map((question) => ({ question_id: question.id, status: "covered", covered_in: confirmed.outline.find((section) => section.answers.includes(question.id))!.id, gap: null })),
      reads: { status: "complete", calls: 1, model_id: "offline-coverage-fixture", temperature_requested: 0, temperature_effective: null, input_tokens: 80, output_tokens: 20 },
    },
    run: options.run ?? { run_id: "draft-fixture", collected_at: "2026-08-31T02:00:00.000Z", elapsed_ms: 100, budget_ms: DRAFT_TOTAL_BUDGET_MS, rerun: null },
  });
  if (!assembled.ok) throw new Error(assembled.path);
  return assembled.value;
}
