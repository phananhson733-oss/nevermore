// @input  -- a ContentBrief (normally contentBriefFixture + withFingerprint) and fixture knobs
// @output -- a DraftResult assembled and fingerprinted through draft-assemble.ts / validate-section.ts, exactly as the handler builds one
// @pos    -- the shared draft-side test fixture; parser, handler and UI tests start from this instead of hand-writing a DraftResult
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { DRAFT_TOTAL_BUDGET_MS } from "./constants.ts";
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
import { validateSectionOutput } from "./validate-section.ts";
import type { SectionEvidence } from "./validate-section.ts";

/* ------------------------------------------------------------------ */
/* knobs                                                                */
/* ------------------------------------------------------------------ */

export interface DraftFixtureOptions {
  /** This writable section comes back `failed` (timeout after two attempts); its questions are decided heuristically. */
  readonly failSection?: string;
  /** This writable section is left unchecked: `skipped`, no model call. */
  readonly skipSection?: string;
  /** The coverage call timed out: `coverage` is the unavailable branch, run mode degraded. */
  readonly coverage?: "unavailable";
}

export const DRAFT_FIXTURE_RUN_ID = "draft_01J6FIXTURE000000000000001";
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

/* ------------------------------------------------------------------ */
/* evidence                                                             */
/* ------------------------------------------------------------------ */

/** The same ledger the handler hands validate-section.ts: pages with at least one excerpt, every profile fact. */
export function sectionEvidenceOf(brief: ContentBrief): SectionEvidence {
  return {
    citableCrawlIds: new Set(
      brief.evidence.crawl.observed.filter((page) => page.excerpts.length > 0).map((page) => page.id),
    ),
    profileFacts: new Map((brief.evidence.profile?.facts ?? []).map((fact) => [fact.id, fact] as const)),
  };
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
 * One section's model output, written against the brief's own ledger so the
 * verify list has every kind: a two-source bound sentence (not listed), a
 * single-source one, a profile-only one, a gap, a connector, and — in the
 * section the gap angle lives in — a stance citing the inferred fact.
 */
function sectionOutput(brief: ContentBrief, section: PlannedSection, index: number, gapHome: boolean): ModelSectionOutput {
  const evidence = sectionEvidenceOf(brief);
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
  if (gapHome && stanceRef !== null) {
    closing.push({ text: "Pooled warmup is the better default for a new domain.", claim: "stance", evidence_refs: [stanceRef] });
  }
  return { paragraphs: opening.length > 0 ? [{ sentences: opening }, { sentences: closing }] : [{ sentences: closing }] };
}

function okSection(brief: ContentBrief, section: PlannedSection, index: number, gapHome: boolean): DraftSection {
  const validated = validateSectionOutput(sectionOutput(brief, section, index, gapHome), sectionEvidenceOf(brief));
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

function sectionFor(brief: ContentBrief, section: PlannedSection, index: number, options: DraftFixtureOptions): DraftSection {
  const base = { id: section.id, h2: section.h2, answers: [...section.answers] as [string, ...string[]] };
  if (section.id === options.skipSection) return { ...base, status: "skipped" };
  if (section.id === options.failSection) {
    return { ...base, status: "failed", fail_reason: "timeout", llm: { attempts: 2, input_tokens: null, output_tokens: null } };
  }
  return okSection(brief, section, index, section.id === gapAngleSectionId(brief));
}

function callOf(section: DraftSection): SectionCallMeta | null {
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
  const plan = planSections(brief, brief.draft_readiness.writable);
  if ("ok" in plan) throw new Error("draft fixture: the brief has no writable section");
  const sections = plan.requested.map((section, index) => sectionFor(brief, section, index, options));
  const decided = decideCoverage(brief, sections);
  const okIds = new Set(sections.filter((section) => section.status === "ok").map((section) => section.id));
  const llmCoverage = options.coverage === "unavailable" ? LLM_COVERAGE_TIMEOUT : LLM_COVERAGE_OK;
  const verdict: CoverageValidation | null =
    options.coverage === "unavailable" ? null : validateCoverageOutput(coverageOutput(decided.askable, sections), decided.askable, okIds);
  if (verdict !== null && !verdict.ok) throw new Error(`draft fixture: coverage output rejected at ${verdict.path}`);
  const coverage = buildCoverage(brief, decided.heuristic, verdict === null ? null : verdict.items, llmCoverage);
  const calls = sections.flatMap((section) => {
    const call = callOf(section);
    return call === null ? [] : [call];
  });
  return assembleDraftResult({
    run: { run_id: DRAFT_FIXTURE_RUN_ID, reran_from: null, collected_at: COLLECTED_AT, elapsed_ms: 31_200, budget_ms: DRAFT_TOTAL_BUDGET_MS },
    brief,
    settings: { tone: "explanatory", person: "second", product_mention: "gap_only" },
    sections,
    coverage,
    llmSections: aggregateSectionLlm(calls, SECTION_TEMPERATURE),
    llmCoverage,
  });
}

/** The brief a draft is normally written against: GSC and profile connected, LLM complete, fingerprint stamped. */
export async function draftBrief(options: FixtureOptions = { connected: true }): Promise<ContentBrief> {
  return withFingerprint(contentBriefFixture(options));
}
