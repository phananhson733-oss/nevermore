// @input  -- a ContentBrief (normally contentBriefFixture + withFingerprint) and fixture knobs
// @output -- a DraftResult assembled and fingerprinted through draft-assemble.ts / validate-section.ts, exactly as the handler builds one
// @pos    -- the shared draft-side test fixture; parser, handler and UI tests start from this instead of hand-writing a DraftResult
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { DRAFT_TOTAL_BUDGET_MS, SECTION_ENDPOINT_BUDGET_MS } from "./constants.ts";
import type {
  ContentBrief,
  DraftResult,
  DraftSection,
  LlmReadMeta,
  ModelCoverageOutput,
  ModelSectionOutput,
  ModelSentence,
} from "./contract.ts";
import {
  aggregateSectionLlm,
  assembleDraftResult,
  buildCoverage,
  decideCoverage,
  gapAngleSectionId,
  planSections,
  validateCoverageOutput,
} from "./draft-assemble.ts";
import type { CoverageValidation, PlannedSection, SectionCallMeta } from "./draft-assemble.ts";
import { contentBriefFixture, withFingerprint } from "./fixtures.ts";
import type { FixtureOptions } from "./fixtures.ts";
import { sectionEvidenceFor } from "./parse-draft.ts";
import { validateSectionOutput } from "./validate-section.ts";

/* ------------------------------------------------------------------ */
/* knobs                                                                */
/* ------------------------------------------------------------------ */

export interface DraftFixtureOptions {
  /** These writable sections come back `failed` (timeout after two attempts); their questions are decided heuristically. */
  readonly failSection?: string | readonly string[];
  /** These writable sections are left unchecked: `skipped`, no model call. */
  readonly skipSection?: string | readonly string[];
  /** The coverage call timed out: `coverage` is the unavailable branch, run mode degraded. */
  readonly coverage?: "unavailable";
  /** Which profile facts each section may cite (sectionEvidenceScope); `gap_only` by default. */
  readonly productMention?: DraftResult["settings"]["product_mention"];
  /**
   * The section endpoint's reply (handoff §5.2): a new run id, `reran_from` =
   * previousRunId, `budget_ms` = SECTION_ENDPOINT_BUDGET_MS, and an
   * `llm_sections` aggregate reflecting only the one section rewritten. The
   * section must not be skipped in this fixture.
   */
  readonly rerun?: { readonly previousRunId: string; readonly sectionId: string };
}

export const DRAFT_FIXTURE_RUN_ID = "draft_01J6FIXTURE000000000000001";
export const DRAFT_FIXTURE_RERUN_ID = "draft_01J6FIXTURE000000000000002";
const COLLECTED_AT = "2026-08-28T10:05:00.000Z";
const SECTION_TEMPERATURE = 0.4;
const SECTION_MODEL_ID = "gpt-4.1-draft";

const LLM_COVERAGE_OK: LlmReadMeta = {
  status: "complete",
  calls: 1,
  model_id: SECTION_MODEL_ID,
  temperature_requested: 0,
  temperature_effective: null,
  input_tokens: 3_100,
  output_tokens: 400,
};

const LLM_COVERAGE_TIMEOUT: LlmReadMeta = {
  status: "unavailable",
  reason: "timeout",
  attempted: 1,
  calls: 1,
  model_id: SECTION_MODEL_ID,
  input_tokens: null,
  output_tokens: null,
};

/** No ok section, so no question to ask: the coverage call never goes out. */
const LLM_COVERAGE_NOT_ASKED: LlmReadMeta = {
  status: "unavailable",
  reason: "insufficient_evidence",
  attempted: 0,
  calls: 0,
  model_id: null,
  input_tokens: null,
  output_tokens: null,
};

function toList(value: string | readonly string[] | undefined): readonly string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : value;
}

/* ------------------------------------------------------------------ */
/* sections                                                             */
/* ------------------------------------------------------------------ */

function rotate<T>(items: readonly T[], by: number): T[] {
  if (items.length === 0) return [];
  const offset = by % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * One section's model output, written only against the evidence that
 * section was given (sectionEvidenceScope), so the verify list has every
 * kind: a two-source bound sentence (not listed), a single-source one, a
 * profile-only one where a fact is in scope, a gap, a connector, and — in
 * the gap angle's home section — a stance (citing the inferred fact when
 * it is in scope, else the first-hand one).
 */
function sectionOutput(brief: ContentBrief, section: PlannedSection, index: number, settings: DraftResult["settings"]): ModelSectionOutput {
  const evidence = sectionEvidenceFor(brief, section.id, settings);
  const citable = rotate([...evidence.citableCrawlIds], index);
  const facts = [...evidence.profileFacts.values()];
  const firstHand = facts.find((fact) => fact.derivation !== "inferred")?.id ?? null;
  const inferred = facts.find((fact) => fact.derivation === "inferred")?.id ?? null;
  const [first, second, third] = citable;
  const opening: ModelSentence[] = [];
  if (first !== undefined && second !== undefined) {
    opening.push({ text: `Most guides open ${section.h2} with the same definition.`, claim: "bound", evidence_refs: [first, second] });
  }
  if (third !== undefined) {
    opening.push({ text: `Only one page puts a number on ${section.h2}.`, claim: "bound", evidence_refs: [third] });
  }
  if (firstHand !== null) {
    opening.push({ text: `The product warms inboxes from a shared pool (${section.h2}).`, claim: "bound", evidence_refs: [firstHand] });
  }
  const closing: ModelSentence[] = [
    { text: `No competitor explains how ${section.h2} changes with pooled warmup.`, claim: "gap", evidence_refs: [] },
    { text: "That leaves the practical question open.", claim: "no_claim", evidence_refs: [] },
  ];
  const stanceRef = inferred ?? firstHand;
  if (section.id === gapAngleSectionId(brief) && stanceRef !== null) {
    closing.push({ text: "Pooled warmup is the better default for a new domain.", claim: "stance", evidence_refs: [stanceRef] });
  }
  return { paragraphs: opening.length > 0 ? [{ sentences: opening }, { sentences: closing }] : [{ sentences: closing }] };
}

function okSection(brief: ContentBrief, section: PlannedSection, index: number, settings: DraftResult["settings"]): DraftSection {
  const validated = validateSectionOutput(sectionOutput(brief, section, index, settings), sectionEvidenceFor(brief, section.id, settings));
  if (!validated.ok) throw new Error(`draft fixture: section ${section.id} failed validation at ${validated.path} (${validated.rule})`);
  return {
    id: section.id,
    h2: section.h2,
    answers: [...section.answers],
    status: "ok",
    body: { word_count: validated.word_count, paragraphs: validated.paragraphs },
    llm: { attempts: 1, input_tokens: 4_000 + index * 100, output_tokens: 600 + index * 10 },
  };
}

function sectionFor(
  brief: ContentBrief,
  section: PlannedSection,
  index: number,
  options: DraftFixtureOptions,
  settings: DraftResult["settings"],
): DraftSection {
  const base = { id: section.id, h2: section.h2, answers: [...section.answers] as [string, ...string[]] };
  if (toList(options.skipSection).includes(section.id)) return { ...base, status: "skipped" };
  if (toList(options.failSection).includes(section.id)) {
    return { ...base, status: "failed", fail_reason: "timeout", llm: { attempts: 2, input_tokens: null, output_tokens: null } };
  }
  return okSection(brief, section, index, settings);
}

/** The call record the handler keeps for a section it wrote this run. */
export function fixtureCallOf(section: DraftSection): SectionCallMeta | null {
  if (section.status === "skipped") return null;
  return {
    status: section.status,
    attempts: section.llm.attempts,
    fail_reason: section.status === "failed" ? section.fail_reason : null,
    model_id: SECTION_MODEL_ID,
    temperature_requested: SECTION_TEMPERATURE,
    temperature_effective: section.status === "ok" ? SECTION_TEMPERATURE : null,
    input_tokens: section.llm.input_tokens,
    output_tokens: section.llm.output_tokens,
  };
}

/* ------------------------------------------------------------------ */
/* coverage                                                             */
/* ------------------------------------------------------------------ */

/** The model's verdict on every askable question: covered, then partial, then none, then covered again. */
function coverageOutput(askable: readonly string[], sections: readonly DraftSection[]): ModelCoverageOutput {
  const owner = new Map<string, string>();
  for (const section of sections) {
    if (section.status === "ok") for (const question of section.answers) owner.set(question, section.id);
  }
  return {
    items: askable.map((question, index) => {
      const home = owner.get(question) ?? null;
      const slot = index % 4;
      if (slot === 1 && home !== null) {
        return { question_id: question, status: "partial", covered_in: home, gap: `The draft names ${question} but never quantifies it.` };
      }
      if (slot === 2 || home === null) {
        return { question_id: question, status: "none", covered_in: null, gap: `Nothing in the draft answers ${question}.` };
      }
      return { question_id: question, status: "covered", covered_in: home, gap: null };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* the draft                                                            */
/* ------------------------------------------------------------------ */

/**
 * Assembles a DraftResult for every writable section of `brief` through the
 * same functions the handler uses, then stamps the real `run.fingerprint`.
 * Throws when `brief` has nothing writable: such a brief never reaches the
 * draft endpoint (section_not_writable).
 */
export async function draftResultFixture(brief: ContentBrief, options: DraftFixtureOptions = {}): Promise<DraftResult> {
  const settings: DraftResult["settings"] = { tone: "explanatory", person: "second", product_mention: options.productMention ?? "gap_only" };
  const plan = planSections(brief, brief.draft_readiness.writable);
  if ("ok" in plan) throw new Error("draft fixture: the brief has no writable section");
  const sections = plan.requested.map((section, index) => sectionFor(brief, section, index, options, settings));
  const decided = decideCoverage(brief, sections);
  const okIds = new Set(sections.filter((section) => section.status === "ok").map((section) => section.id));
  const llmCoverage = decided.askable.length === 0 ? LLM_COVERAGE_NOT_ASKED : options.coverage === "unavailable" ? LLM_COVERAGE_TIMEOUT : LLM_COVERAGE_OK;
  const verdict: CoverageValidation | null =
    llmCoverage.status === "complete" ? validateCoverageOutput(coverageOutput(decided.askable, sections), decided.askable, okIds) : null;
  if (verdict !== null && !verdict.ok) throw new Error(`draft fixture: coverage output rejected at ${verdict.path}`);
  // Nothing askable: the coverage call never went out, and every item is the server's own verdict.
  const modelItems = verdict === null ? (decided.askable.length === 0 ? [] : null) : verdict.items;
  const coverage = buildCoverage(brief, decided.heuristic, modelItems, llmCoverage);
  const rerunCall = options.rerun === undefined ? null : rerunCallOf(sections, options.rerun.sectionId);
  const calls =
    rerunCall !== null
      ? [rerunCall]
      : sections.flatMap((section) => {
          const call = fixtureCallOf(section);
          return call === null ? [] : [call];
        });
  const run =
    options.rerun === undefined
      ? { run_id: DRAFT_FIXTURE_RUN_ID, reran_from: null, collected_at: COLLECTED_AT, elapsed_ms: 31_200, budget_ms: DRAFT_TOTAL_BUDGET_MS }
      : { run_id: DRAFT_FIXTURE_RERUN_ID, reran_from: options.rerun.previousRunId, collected_at: COLLECTED_AT, elapsed_ms: 12_400, budget_ms: SECTION_ENDPOINT_BUDGET_MS };
  return assembleDraftResult({
    run,
    brief,
    settings,
    sections,
    coverage,
    llmSections: aggregateSectionLlm(calls, SECTION_TEMPERATURE),
    llmCoverage,
  });
}

/** The one call a rerun made: the rewritten section's own record, nothing else. */
function rerunCallOf(sections: readonly DraftSection[], sectionId: string): SectionCallMeta {
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined) throw new Error(`draft fixture: rerun section ${sectionId} is not in the draft`);
  const call = fixtureCallOf(section);
  if (call === null) throw new Error(`draft fixture: rerun section ${sectionId} is skipped and made no call`);
  return call;
}

/** The brief a draft is normally written against: GSC and profile connected, LLM complete, fingerprint stamped. */
export async function draftBrief(options: FixtureOptions = { connected: true }): Promise<ContentBrief> {
  return withFingerprint(contentBriefFixture(options));
}
