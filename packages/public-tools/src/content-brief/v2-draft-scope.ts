// @input -- one caller-parsed confirmed Brief v2/v3 and explicit section/settings selection
// @output -- section-local frozen question/evidence and observed rewrite context
// @pos -- pure Draft v2 scope projection; never reparses or re-fingerprints a confirmed revision
import { invalid, ok, reference, type Decoded } from "./parse-brief-shape.ts";
import { CONFIRMED_BRIEF_V2_SCHEMA, CONFIRMED_BRIEF_V3_SCHEMA } from "./v2-brief.ts";
import { CONTENT_BRIEF_V2_SCHEMA, CONTENT_BRIEF_V3_SCHEMA, type ResearchOutlineItem, type ResearchPage, type ResearchQuestion } from "./v2-contract.ts";
import type { DraftV2Settings } from "./v2-draft-contract.ts";
import type { DraftV2SectionEvidence } from "./v2-draft-section.ts";
import { sameBriefV2OwnedPage } from "./v2-generation.ts";
import type { BriefV2Generated, BriefV2PlanStep, BriefV2WritingPlan, ConfirmedBriefV2 } from "./v2-generation-contract.ts";

export interface DraftV2SectionScope extends DraftV2SectionEvidence {
  readonly section: ResearchOutlineItem;
  readonly allowed_h3: readonly string[];
  readonly questions: readonly ResearchQuestion[];
  readonly question_unit_refs: readonly string[];
  readonly action: "create" | "update";
  readonly target_ref: string | null;
  readonly target_page: ResearchPage | null;
  readonly steps: readonly BriefV2PlanStep[];
  readonly gap_angle: BriefV2WritingPlan["gap_angle"];
}

function deliveryPlan(confirmed: ConfirmedBriefV2): Decoded<{
  readonly generated: BriefV2Generated;
  readonly action: "create" | "update";
  readonly target_ref: string | null;
  readonly target_page: ResearchPage | null;
}> {
  if ((confirmed.schema !== CONFIRMED_BRIEF_V2_SCHEMA || confirmed.brief.schema !== CONTENT_BRIEF_V2_SCHEMA) &&
      (confirmed.schema !== CONFIRMED_BRIEF_V3_SCHEMA || confirmed.brief.schema !== CONTENT_BRIEF_V3_SCHEMA)) return reference("schema");
  const generated = confirmed.brief.generated;
  if (generated === null || generated.research.outline.length === 0 || generated.research.questions.length === 0 || confirmed.outline.length === 0) return reference("generated.research");
  const plan = generated.page_plan;
  let action: "create" | "update";
  if (confirmed.resolution === "create_despite_uncertainty") {
    if (plan.action !== "undecidable") return reference("resolution");
    action = "create";
  } else if (confirmed.resolution === "accept_recommendation") {
    if (plan.action !== "create" && plan.action !== "update") return reference("page_plan.action");
    action = plan.action;
  } else return reference("resolution");
  if (action === "create") {
    if (plan.target_ref !== null || plan.steps.length !== 0) return reference("page_plan");
    return ok({ generated, action, target_ref: null, target_page: null });
  }
  const candidate = confirmed.brief.context.candidates.find((item) => item.id === plan.target_ref);
  const target = confirmed.brief.context.research.pages.find((item) => item.id === plan.target_ref);
  if (candidate?.read !== "observed" || target?.role !== "owned" || target.research.segments.length === 0 ||
      target.url !== candidate.url || !sameBriefV2OwnedPage(candidate.url, target.final_url)) return reference("page_plan.target_ref");
  return ok({ generated, action, target_ref: target.id, target_page: target });
}

/** The caller validates the confirmed envelope once; this projection does not repeat its hash/graph parse. */
export function buildDraftV2SectionScope(confirmed: ConfirmedBriefV2, sectionId: string, settings: DraftV2Settings): Decoded<DraftV2SectionScope> {
  const plan = deliveryPlan(confirmed);
  if (!plan.ok) return plan;
  const section = confirmed.outline.find((item) => item.id === sectionId);
  if (section === undefined) return reference("section_id");
  const { generated, action, target_ref, target_page } = plan.value;
  const questionsById = new Map(generated.research.questions.map((question) => [question.id, question]));
  const questions: ResearchQuestion[] = [];
  for (const id of section.answers) {
    const question = questionsById.get(id);
    if (question === undefined) return reference("section.answers");
    questions.push(question);
  }
  const question_unit_refs = [...new Set(questions.flatMap((question) => question.source_refs))];
  const research = confirmed.brief.context.research;
  const units = new Map(research.units.map((unit) => [unit.id, unit]));
  const pages = new Map(research.pages.map((page) => [page.id, page]));
  const paaIds = new Set(research.paa.map((question) => question.id));
  const page_units = new Map<string, { readonly page_ref: string; readonly final_url: string }>();
  function includeUnit(ref: string, allowPaa: boolean): Decoded<null> {
    const unit = units.get(ref);
    if (unit === undefined) return reference("source_refs");
    if (unit.kind === "paa") return allowPaa && paaIds.has(unit.paa_ref) ? ok(null) : reference("source_refs");
    const page = pages.get(unit.page_ref);
    if (page === undefined || page.research.segments[unit.segment_index] === undefined) return reference("source_refs");
    page_units.set(ref, { page_ref: page.id, final_url: page.final_url });
    return ok(null);
  }
  for (const ref of question_unit_refs) {
    const included = includeUnit(ref, true);
    if (!included.ok) return included;
  }
  const steps = action === "update" ? generated.page_plan.steps.filter((step) =>
    step.answers.length === 0 || step.answers.some((id) => section.answers.includes(id))) : [];
  if (action === "update") {
    for (const unit of research.units) {
      if (unit.kind !== "page" || unit.page_ref !== target_ref) continue;
      const included = includeUnit(unit.id, false);
      if (!included.ok) return included;
    }
    for (const step of steps) for (const ref of step.sources) {
      const included = includeUnit(ref, false);
      if (!included.ok) return included;
    }
  }
  if (!["none", "gap_only", "throughout"].includes(settings.product_mention)) return invalid("settings.product_mention");
  // Heading reorder never transfers the generated gap section's permission.
  const gap_angle = settings.product_mention !== "none" && generated.research.outline.at(-1)?.id === section.id ? generated.gap_angle : null;
  const allFacts = new Map(confirmed.brief.context.facts.map((fact) => [fact.id, fact]));
  if (gap_angle !== null && gap_angle.fact_refs.some((ref) => !allFacts.has(ref))) return reference("gap_angle.fact_refs");
  const facts = new Map([...allFacts].filter(([id]) => settings.product_mention === "throughout" ||
    (settings.product_mention === "gap_only" && gap_angle?.fact_refs.includes(id))));
  return ok(structuredClone({
    section, allowed_h3: section.h3, questions, question_unit_refs, action, target_ref, target_page, steps, gap_angle,
    page_units, facts, stance_allowed: gap_angle !== null,
  }));
}

export function planDraftV2Sections(confirmed: ConfirmedBriefV2, sectionIds: readonly string[]): Decoded<{
  readonly requested: readonly ResearchOutlineItem[];
  readonly skipped: readonly ResearchOutlineItem[];
}> {
  const plan = deliveryPlan(confirmed);
  if (!plan.ok) return plan;
  const selected = new Set(sectionIds);
  if (sectionIds.length === 0 || selected.size !== sectionIds.length) return invalid("section_ids");
  const known = new Set(confirmed.outline.map((section) => section.id));
  if (sectionIds.some((id) => !known.has(id))) return reference("section_ids");
  return ok(structuredClone({
    requested: confirmed.outline.filter((section) => selected.has(section.id)),
    skipped: confirmed.outline.filter((section) => !selected.has(section.id)),
  }));
}
