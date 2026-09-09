// @input -- one caller-parsed confirmed Brief v2/v3 and explicit section/settings selection
// @output -- section-local frozen question/evidence and observed rewrite context
// @pos -- pure Draft v2 scope projection; never reparses or re-fingerprints a confirmed revision
import { SECTION_EVIDENCE_MAX_BYTES } from "./constants.ts";
import { invalid, ok, reference, type Decoded } from "./parse-brief-shape.ts";
import { CONFIRMED_BRIEF_V2_SCHEMA, CONFIRMED_BRIEF_V3_SCHEMA } from "./v2-brief.ts";
import { CONTENT_BRIEF_V2_SCHEMA, CONTENT_BRIEF_V3_SCHEMA, type ResearchOutlineItem, type ResearchPage, type ResearchQuestion, type ResearchUnit } from "./v2-contract.ts";
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

/**
 * The prompt emits one page unit as `{...unit, role, ...segment, source_domain}`.
 * `source_domain` is that page's hostname, so measuring with the whole final_url
 * can only over-count -- the budget is never underestimated by this proxy.
 */
function promptUnitBytes(unit: ResearchUnit, page: ResearchPage): number {
  if (unit.kind !== "page") return 0;
  const segment = page.research.segments[unit.segment_index];
  if (segment === undefined) return 0;
  return new TextEncoder().encode(JSON.stringify({
    ...unit, role: page.role, ...segment, source_domain: page.final_url,
  })).byteLength;
}

/**
 * Why a section may read more than its own questions' sources, and why the
 * whole set is priced in bytes.
 *
 * A section's mandatory evidence is the union of its mapped questions'
 * `source_refs` -- often three to five excerpts, which is why sections came out
 * two sentences long even though the brief had crawled twelve excerpts per page.
 * This hands the section the *rest of the pages it already cites*, and nothing
 * else.
 *
 * The line is deliberate. The brief decided which pages answer this section's
 * questions, and that judgment stays: a page no question sourced never enters
 * this section, so a PAA-only section still materializes no page evidence and
 * one section's excerpts still never leak into another's prompt. What is dropped
 * is only the accidental narrowing to the three sentences the brief happened to
 * quote from a page it had already accepted.
 *
 * The cap is bytes, not units, because one excerpt serializes to ~799 B in
 * English and ~1724 B in Chinese. A unit count safe for one script overruns
 * DRAFT_V2_PROMPT_MAX_BYTES for the other, and overrunning that ceiling fails
 * the whole section instead of shortening it -- the reader sees "failed", not
 * "short". The budget therefore covers the mandatory units too: priority order
 * means they are spent first and a normal brief never loses one, but a brief
 * whose own question mapping is wider than the ceiling now returns a shorter
 * section rather than no section.
 *
 * Order is priority, not preference: question sources, then the rewrite target
 * and its plan steps, then the remaining excerpts of those same pages. Research
 * order inside each tier keeps the projection deterministic.
 */
function budgetedSectionEvidence(
  research: { readonly units: readonly ResearchUnit[] },
  pages: ReadonlyMap<string, ResearchPage>,
  mandatory: readonly string[],
): Map<string, { readonly page_ref: string; readonly final_url: string }> {
  const byId = new Map(research.units.map((unit) => [unit.id, unit]));
  const pageOf = (ref: string): ResearchPage | undefined => {
    const unit = byId.get(ref);
    return unit?.kind === "page" ? pages.get(unit.page_ref) : undefined;
  };
  const hitPages = new Set(mandatory.flatMap((ref) => {
    const page = pageOf(ref);
    return page === undefined ? [] : [page.id];
  }));
  const ordered = [
    ...mandatory,
    ...research.units
      .filter((unit) => unit.kind === "page" && !mandatory.includes(unit.id) && hitPages.has(unit.page_ref))
      .map((unit) => unit.id),
  ];
  const selected = new Map<string, { readonly page_ref: string; readonly final_url: string }>();
  let used = 0;
  for (const ref of ordered) {
    const unit = byId.get(ref);
    const page = pageOf(ref);
    if (unit === undefined || page === undefined || selected.has(ref)) continue;
    const bytes = promptUnitBytes(unit, page);
    if (used + bytes > SECTION_EVIDENCE_MAX_BYTES) continue;
    used += bytes;
    selected.set(ref, { page_ref: page.id, final_url: page.final_url });
  }
  return selected;
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
  const mandatory: string[] = [];
  function includeUnit(ref: string, allowPaa: boolean): Decoded<null> {
    const unit = units.get(ref);
    if (unit === undefined) return reference("source_refs");
    if (unit.kind === "paa") return allowPaa && paaIds.has(unit.paa_ref) ? ok(null) : reference("source_refs");
    const page = pages.get(unit.page_ref);
    if (page === undefined || page.research.segments[unit.segment_index] === undefined) return reference("source_refs");
    if (!mandatory.includes(ref)) mandatory.push(ref);
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
  const page_units = budgetedSectionEvidence(research, pages, mandatory);
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
