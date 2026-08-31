// @input  -- a parsed ContentBrief, the visitor's settings and what each section call returned
// @output -- every derived DraftResult field and the assembled, fingerprinted result
// @pos    -- the only place draft fields are derived; pure, deterministic, shared by producer and parser
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { draftFingerprint } from "./canonical.ts";
import { boundedModelText } from "./text.ts";
import { DRAFT_TOTAL_BUDGET_MS, MODEL_TEXT_MAX_CHARS } from "./constants.ts";
import {
  DRAFT_RESULT_SCHEMA,
  type Coverage,
  type CoverageItem,
  type DraftResult,
  type DraftRunMeta,
  type DraftSection,
  type LlmAggregateMeta,
  type LlmReadMeta,
  type ModelCoverageOutput,
  type RunMode,
  type SectionFailReason,
  type VerifyItem,
} from "./contract.ts";
import { isGeoContentBrief, type SharedContentBrief as ContentBrief } from "./geo-contract.ts";
import { geoDraftFacts } from "./geo-draft.ts";

/**
 * Why the draft side has its own assembler.
 *
 * Screen, Markdown copy and JSON export all come from one DraftResult. The
 * fields a reader compares — the verify list, the coverage counts, the run
 * mode — are derived here from the sections and never written by hand, so a
 * section rerun that replaces one section re-derives everything through the
 * same functions the parser uses to check them.
 */

/* ------------------------------------------------------------------ */
/* section planning                                                     */
/* ------------------------------------------------------------------ */

export interface PlannedSection {
  readonly id: string;
  readonly h2: string;
  readonly h3: readonly string[];
  readonly answers: readonly string[];
}

export interface SectionPlan {
  /** Sections the caller asked for, in outline order. */
  readonly requested: PlannedSection[];
  /** Writable sections the caller left unchecked; emitted as `skipped`. */
  readonly skipped: PlannedSection[];
}

export type SectionPlanFailure = { readonly ok: false; readonly code: "section_not_writable" };

function outlineItems(brief: ContentBrief): readonly PlannedSection[] {
  return brief.outline.status === "available" ? brief.outline.items : [];
}

/**
 * Only writable outline sections exist for the draft; anything else is a
 * refusal, never a silent drop. Order is outline order regardless of the
 * order ids were sent in.
 */
export function planSections(
  brief: ContentBrief,
  sectionIds: readonly string[],
): SectionPlan | SectionPlanFailure {
  const writable = new Set(brief.draft_readiness.writable);
  if (writable.size === 0 || sectionIds.length === 0) return { ok: false, code: "section_not_writable" };
  const wanted = new Set(sectionIds);
  if ([...wanted].some((id) => !writable.has(id))) return { ok: false, code: "section_not_writable" };
  const requested: PlannedSection[] = [];
  const skipped: PlannedSection[] = [];
  for (const item of outlineItems(brief)) {
    if (!writable.has(item.id)) continue;
    const planned: PlannedSection = { id: item.id, h2: item.h2, h3: item.h3, answers: item.answers };
    (wanted.has(item.id) ? requested : skipped).push(planned);
  }
  return { requested, skipped };
}

/** The gap angle is written into the last outline section (handoff §5.1); null when there is none. */
export function gapAngleSectionId(brief: ContentBrief): string | null {
  const items = outlineItems(brief);
  const last = items[items.length - 1];
  return last === undefined || brief.gap_angle.status !== "available" ? null : last.id;
}

/**
 * The evidence one section was actually allowed to cite: the observed pages
 * behind its own questions (with excerpts), and the profile facts the
 * visitor's `product_mention` setting released to it. The handler builds the
 * prompt from this and the parser validates against it, so a reference the
 * model could not have seen is refused instead of being displayed as bound.
 */
export interface SectionEvidenceScope {
  readonly citableCrawlIds: ReadonlySet<string>;
  readonly profileFactIds: ReadonlySet<string>;
  /** Only the section that received the gap angle may take a `stance` (contract: stance comes from gap_angle). */
  readonly stanceAllowed: boolean;
}

export function sectionEvidenceScope(
  brief: ContentBrief,
  sectionId: string,
  settings: DraftResult["settings"],
): SectionEvidenceScope {
  if (isGeoContentBrief(brief)) {
    const facts = geoDraftFacts(brief, sectionId, settings);
    return { citableCrawlIds: new Set(facts.filter(fact => fact.source === "crawl").map(fact => fact.id)), profileFactIds: new Set<string>(), stanceAllowed: false };
  }
  const section = outlineItems(brief).find((item) => item.id === sectionId);
  const answers = new Set(section?.answers ?? []);
  const questions = brief.must_answer.status === "available" ? brief.must_answer.items.filter((item) => answers.has(item.id)) : [];
  const memberIds = new Set(questions.flatMap((item) => item.cluster.members.map((member) => member.observation_id)));
  const citableCrawlIds = new Set(
    brief.evidence.crawl.observed.filter((page) => memberIds.has(page.id) && page.excerpts.length > 0).map((page) => page.id),
  );
  const allFacts = brief.evidence.profile?.facts ?? [];
  const profileFactIds =
    settings.product_mention === "none"
      ? new Set<string>()
      : settings.product_mention === "throughout"
        ? new Set(allFacts.map((fact) => fact.id))
        : gapAngleSectionId(brief) === sectionId && brief.gap_angle.status === "available"
          ? new Set(brief.gap_angle.profile_fact_refs.filter((id) => allFacts.some((fact) => fact.id === id)))
          : new Set<string>();
  return { citableCrawlIds, profileFactIds, stanceAllowed: gapAngleSectionId(brief) === sectionId };
}

/* ------------------------------------------------------------------ */
/* derived fields                                                       */
/* ------------------------------------------------------------------ */

export function deriveVerifyList(sections: readonly DraftSection[]): VerifyItem[] {
  const items: VerifyItem[] = [];
  for (const section of sections) {
    if (section.status !== "ok") continue;
    for (const paragraph of section.body.paragraphs) {
      for (const sentence of paragraph.sentences) {
        if (sentence.claim === "bound" && sentence.sources?.length === 1 && sentence.sources[0] === "kb") continue;
        const kind: VerifyItem["kind"] | null =
          sentence.claim === "gap"
            ? "gap"
            : sentence.claim === "stance"
              ? "stance"
              : sentence.claim === "bound" && sentence.support_count === 1
                ? "single_source"
                : sentence.claim === "bound" && sentence.support_count === 0
                  ? "profile_only"
                  : null;
        if (kind === null) continue;
        items.push({
          sentence: sentence.text,
          section_id: section.id,
          kind,
          support_count: sentence.support_count,
          evidence_refs: [...sentence.evidence_refs],
        });
      }
    }
  }
  return items;
}

export function deriveTotals(sections: readonly DraftSection[]): DraftResult["totals"] {
  return {
    word_count: sections.reduce((sum, section) => sum + (section.status === "ok" ? section.body.word_count : 0), 0),
  };
}

export function deriveSectionReads(sections: readonly DraftSection[]): DraftRunMeta["reads"]["sections"] {
  const ok = sections.filter((section) => section.status === "ok").length;
  const failed = sections.filter((section) => section.status === "failed").length;
  const skipped = sections.filter((section) => section.status === "skipped").length;
  return { requested: ok + failed, ok, failed, skipped };
}

export interface SectionCallMeta {
  readonly status: "ok" | "failed";
  readonly attempts: number;
  readonly fail_reason: SectionFailReason | null;
  readonly model_id: string | null;
  readonly temperature_requested: number;
  readonly temperature_effective: number | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
}

function sumTokens(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** handoff §5.7: complete = all ok; partial = some ok some failed; unavailable = none ok. */
export function aggregateSectionLlm(calls: readonly SectionCallMeta[], temperatureRequested: number): LlmAggregateMeta {
  const ok = calls.filter((call) => call.status === "ok");
  const failed = calls.filter((call) => call.status === "failed");
  const totalCalls = calls.reduce((sum, call) => sum + call.attempts, 0);
  const modelId = calls.find((call) => call.model_id !== null)?.model_id ?? null;
  const failedReasons = failed.map((call) => call.fail_reason ?? "provider_error");
  // A real attempt whose usage the provider did not report makes the total
  // unknown; only a call that never went out contributes a known zero.
  const attempted = calls.filter((call) => call.attempts > 0);
  const inputTokens = sumTokens(attempted.map((call) => call.input_tokens));
  const outputTokens = sumTokens(attempted.map((call) => call.output_tokens));
  if (ok.length === 0) {
    const first = failedReasons[0] ?? "insufficient_evidence";
    return {
      status: "unavailable",
      reason: first === "validation_failed" || first === "timeout" || first === "provider_error" || first === "not_configured" ? first : "insufficient_evidence",
      attempted: calls.length,
      calls: totalCalls,
      model_id: modelId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      failed_reasons: failedReasons,
    };
  }
  const effective = calls.find((call) => call.status === "ok")?.temperature_effective ?? null;
  return {
    status: failed.length === 0 ? "complete" : "partial",
    calls: totalCalls,
    model_id: modelId ?? "unknown",
    temperature_requested: temperatureRequested,
    temperature_effective: effective,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    failed_reasons: failedReasons,
  };
}

/**
 * handoff §5.7: unavailable when nothing was generated; degraded when a
 * section failed or the coverage check could not run; partial when the
 * visitor skipped sections; complete otherwise.
 */
export function deriveDraftRunMode(input: {
  readonly sections: DraftRunMeta["reads"]["sections"];
  readonly coverage: Coverage;
}): RunMode {
  const { sections } = input;
  if (sections.ok === 0 && sections.requested > 0) return "unavailable";
  if (sections.failed > 0 || input.coverage.status === "unavailable") return "degraded";
  if (sections.skipped > 0) return "partial";
  return "complete";
}

/* ------------------------------------------------------------------ */
/* coverage                                                             */
/* ------------------------------------------------------------------ */

export interface CoverageDecision {
  /** Questions whose section is failed/skipped: decided by the server, never asked. */
  readonly heuristic: CoverageItem[];
  /** Questions the model must judge. */
  readonly askable: readonly string[];
}

export function decideCoverage(brief: ContentBrief, sections: readonly DraftSection[]): CoverageDecision {
  const heuristic: CoverageItem[] = [];
  const askable: string[] = [];
  const questions = brief.must_answer.status === "available" ? brief.must_answer.items.map((item) => item.id) : [];
  const owner = new Map<string, DraftSection[]>();
  for (const section of sections) {
    for (const question of section.answers) owner.set(question, [...(owner.get(question) ?? []), section]);
  }
  for (const question of questions) {
    const owners = owner.get(question) ?? [];
    const section = owners.find(item => item.status === "ok") ?? owners.find(item => item.status === "failed") ?? owners[0];
    if (section === undefined || section.status === "ok") {
      askable.push(question);
      continue;
    }
    heuristic.push({
      question_id: question,
      status: "none",
      covered_in: null,
      gap: null,
      method: "heuristic",
      cause: section.status === "failed" ? "section_failed" : "section_skipped",
    });
  }
  return { heuristic, askable };
}

export type CoverageValidation =
  | { readonly ok: true; readonly items: CoverageItem[] }
  | { readonly ok: false; readonly path: string };

/** The model's answer must cover every askable question exactly once, and only name ok sections. */
export function validateCoverageOutput(
  output: ModelCoverageOutput,
  askable: readonly string[],
  okSectionIds: ReadonlySet<string>,
): CoverageValidation {
  const wanted = new Set(askable);
  const seen = new Set<string>();
  const items: CoverageItem[] = [];
  for (const [index, item] of output.items.entries()) {
    const path = `items[${index}]`;
    if (!wanted.has(item.question_id) || seen.has(item.question_id)) return { ok: false, path: `${path}.question_id` };
    seen.add(item.question_id);
    if (item.status === "covered") {
      if (item.covered_in === null || !okSectionIds.has(item.covered_in)) return { ok: false, path: `${path}.covered_in` };
      // A covered verdict that still names a gap is a contradiction; the server
      // never edits a model verdict into shape, it refuses the whole check.
      if (item.gap !== null) return { ok: false, path: `${path}.gap` };
      items.push({ question_id: item.question_id, status: "covered", covered_in: item.covered_in, gap: null, method: "model", cause: null });
    } else if (item.status === "partial") {
      if (item.covered_in === null || !okSectionIds.has(item.covered_in)) return { ok: false, path: `${path}.covered_in` };
      const partialGap = item.gap === null ? null : boundedModelText(item.gap, MODEL_TEXT_MAX_CHARS);
      if (partialGap === null || !partialGap.ok) return { ok: false, path: `${path}.gap` };
      items.push({ question_id: item.question_id, status: "partial", covered_in: item.covered_in, gap: partialGap.value, method: "model", cause: "content" });
    } else if (item.status === "none") {
      if (item.covered_in !== null) return { ok: false, path: `${path}.covered_in` };
      const noneGap = item.gap === null ? null : boundedModelText(item.gap, MODEL_TEXT_MAX_CHARS);
      if (noneGap === null || !noneGap.ok) return { ok: false, path: `${path}.gap` };
      items.push({ question_id: item.question_id, status: "none", covered_in: null, gap: noneGap.value, method: "model", cause: "content" });
    } else {
      return { ok: false, path: `${path}.status` };
    }
  }
  if (seen.size !== wanted.size) return { ok: false, path: "items" };
  return { ok: true, items };
}

export function buildCoverage(
  brief: ContentBrief,
  heuristic: readonly CoverageItem[],
  modelItems: readonly CoverageItem[] | null,
  llm: LlmReadMeta,
): Coverage {
  const total = brief.must_answer.status === "available" ? brief.must_answer.items.length : 0;
  if (modelItems === null) {
    return llm.status === "unavailable"
      ? { status: "unavailable", reason: llm.reason, attempted: llm.attempted }
      : { status: "unavailable", reason: "validation_failed", attempted: llm.calls };
  }
  const order = new Map(
    (brief.must_answer.status === "available" ? brief.must_answer.items : []).map((item, index) => [item.id, index] as const),
  );
  const items = [...heuristic, ...modelItems].sort((a, b) => (order.get(a.question_id) ?? 0) - (order.get(b.question_id) ?? 0));
  return {
    status: "available",
    items,
    total,
    covered: items.filter((item) => item.status === "covered").length,
    partial: items.filter((item) => item.status === "partial").length,
    none: items.filter((item) => item.status === "none").length,
    provenance: { method: "model", derived_from: [] },
  };
}

/* ------------------------------------------------------------------ */
/* assemble                                                             */
/* ------------------------------------------------------------------ */

export interface AssembleDraftInput {
  readonly run: {
    readonly run_id: string;
    readonly reran_from: string | null;
    readonly collected_at: string;
    readonly elapsed_ms: number;
    readonly budget_ms: number;
  };
  readonly brief: ContentBrief;
  readonly settings: DraftResult["settings"];
  readonly sections: readonly DraftSection[];
  readonly coverage: Coverage;
  readonly llmSections: LlmAggregateMeta;
  readonly llmCoverage: LlmReadMeta;
}

export async function assembleDraftResult(input: AssembleDraftInput): Promise<DraftResult> {
  const sections = [...input.sections];
  const reads = deriveSectionReads(sections);
  const withoutFingerprint: DraftResult = {
    schema: DRAFT_RESULT_SCHEMA,
    run: {
      run_id: input.run.run_id,
      reran_from: input.run.reran_from,
      collected_at: input.run.collected_at,
      elapsed_ms: input.run.elapsed_ms,
      budget_ms: input.run.budget_ms,
      mode: deriveDraftRunMode({ sections: reads, coverage: input.coverage }),
      reads: { sections: reads, llm_sections: input.llmSections, llm_coverage: input.llmCoverage },
      fingerprint: "",
    },
    brief_ref: {
      schema: input.brief.schema,
      run_id: input.brief.run.run_id,
      fingerprint: input.brief.run.fingerprint,
      keyword: input.brief.keyword.primary,
      ...(isGeoContentBrief(input.brief) ? { geo_origin: input.brief.geo_origin, evidence: input.brief.evidence } : {}),
    },
    settings: { ...input.settings },
    sections,
    coverage: input.coverage,
    verify_before_publish: deriveVerifyList(sections),
    totals: deriveTotals(sections),
  };
  const fingerprint = await draftFingerprint(withoutFingerprint);
  return { ...withoutFingerprint, run: { ...withoutFingerprint.run, fingerprint } };
}

export const DRAFT_BUDGET_MS = DRAFT_TOTAL_BUDGET_MS;
