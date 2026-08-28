// @input  -- draft fixtures assembled through draft-assemble.ts, then deliberately damaged one field at a time
// @output -- proof the draft parser accepts every assembled variant and names the first offending path for every damaged one
// @pos    -- parse-draft's unit tests
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it, vi } from "vitest";

import { draftFingerprint } from "./canonical.ts";
import {
  DRAFT_RESULT_MAX_BYTES,
  DRAFT_TOTAL_BUDGET_MS,
  MODEL_TEXT_MAX_CHARS,
  MUST_ANSWER_CAP,
  OUTLINE_CAP,
  SECTION_BODY_MAX_BYTES,
  SECTION_ENDPOINT_BUDGET_MS,
  SECTION_MAX_ATTEMPTS,
  SECTION_MAX_SENTENCES,
  SECTION_REQUEST_MAX_BYTES,
  SENTENCE_MAX_CHARS,
} from "./constants.ts";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES } from "./contract.ts";
import type { ContentBrief, DraftResult, DraftSection, LlmReadMeta, ModelSentence, MustAnswerItem, OutlineItem } from "./contract.ts";
import { aggregateSectionLlm, assembleDraftResult, buildCoverage, planSections, validateCoverageOutput } from "./draft-assemble.ts";
import type { PlannedSection, SectionCallMeta } from "./draft-assemble.ts";
import { draftBrief, draftResultFixture, fixtureCallOf } from "./draft-fixtures.ts";
import { contentBriefFixture, withFingerprint } from "./fixtures.ts";
import { parseDraftResult, parseDraftResultShape, parseDraftSections, parseDraftSettings, sectionEvidenceFor } from "./parse-draft.ts";
import type { ParseDraftFailure, RerunProvenance } from "./parse-draft.ts";
import { validateSectionOutput } from "./validate-section.ts";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

// Mutants are deliberately ill-typed (unknown keys, wrong types), so the
// draft is loosened once here instead of sprinkling casts through the file.
type Draft = { [key: string]: any };

function mutated<T>(value: T, edit: (draft: Draft) => void): T {
  const draft = structuredClone(value) as Draft;
  edit(draft);
  return draft as T;
}

function failure(code: ParseDraftFailure["code"], path: string): ParseDraftFailure {
  return { ok: false, code, path };
}

function expectShape(input: unknown, code: ParseDraftFailure["code"], path: string): void {
  expect(parseDraftResultShape(input)).toEqual(failure(code, path));
}

function expectReference(input: unknown, path: string): void {
  expectShape(input, "brief_reference_invalid", path);
}

function expectAccepted(input: unknown): DraftResult {
  const result = parseDraftResultShape(input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

/** Stable stand-in for canonical.ts so binding tests do not depend on it. */
function fakeFingerprint(result: DraftResult): Promise<string> {
  const body = JSON.stringify({ ...result, run: { ...result.run, fingerprint: "", elapsed_ms: 0 } });
  let hash = 5381;
  for (let index = 0; index < body.length; index += 1) hash = Math.imul(hash, 33) ^ body.charCodeAt(index);
  return Promise.resolve(`fake-${(hash >>> 0).toString(16)}`);
}

async function fakeStamped(result: DraftResult): Promise<DraftResult> {
  return { ...result, run: { ...result.run, fingerprint: await fakeFingerprint(result) } };
}

const sentenceAt = (section: number, paragraph: number, index: number) =>
  `sections[${section}].body.paragraphs[${paragraph}].sentences[${index}]`;

const brief = await draftBrief();
const base = await draftResultFixture(brief);
const failed = await draftResultFixture(brief, { failSection: "O2" });
const skipped = await draftResultFixture(brief, { skipSection: "O3" });
const noCoverage = await draftResultFixture(brief, { coverage: "unavailable" });
const throughout = await draftResultFixture(brief, { productMention: "throughout" });
const nothingOk = await draftResultFixture(brief, { failSection: ["O1", "O2"], skipSection: "O3" });
const plainBrief = await draftBrief({});
const plain = await draftResultFixture(plainBrief);
const SETTINGS = base.settings;

/** Binding failures: shape passes, the brief disagrees. */
async function expectBound(input: unknown, path: string, against = brief): Promise<void> {
  expect(await parseDraftResult(input, against, { fingerprint: fakeFingerprint })).toEqual(failure("brief_reference_invalid", path));
}

function okSection(result: DraftResult, index: number): Extract<DraftSection, { status: "ok" }> {
  const section = result.sections[index];
  if (section === undefined || section.status !== "ok") throw new Error(`fixture: section ${index} is not ok`);
  return section;
}

/** The first-run aggregate the fixture would have produced for these sections. */
function aggregateOf(sections: readonly DraftSection[]) {
  return aggregateSectionLlm(sections.flatMap((section) => fixtureCallOf(section) ?? []), 0.4);
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/* ------------------------------------------------------------------ */
/* the largest contract-valid result                                   */
/* ------------------------------------------------------------------ */

/** The connected fixture brief stretched to OUTLINE_CAP sections over MUST_ANSWER_CAP questions (clusters reused). */
async function widestBrief(): Promise<ContentBrief> {
  const seed = contentBriefFixture({ connected: true });
  if (seed.must_answer.status !== "available" || seed.outline.status !== "available") throw new Error("fixture: connected brief has questions and an outline");
  const seedQuestions = seed.must_answer.items;
  const questions = Array.from({ length: MUST_ANSWER_CAP }, (_, index): MustAnswerItem => ({
    ...structuredClone(seedQuestions[index % seedQuestions.length] as MustAnswerItem),
    id: `Q${index + 1}`,
  }));
  const provenance = seed.outline.items[0].provenance;
  const answers = Array.from({ length: OUTLINE_CAP }, (_, index): [string, ...string[]] =>
    index < OUTLINE_CAP - 1
      ? [`Q${index + 1}`]
      : [`Q${OUTLINE_CAP}`, ...Array.from({ length: MUST_ANSWER_CAP - OUTLINE_CAP }, (_, extra) => `Q${OUTLINE_CAP + extra + 1}`)],
  );
  const items = answers.map((sectionAnswers, index): OutlineItem => ({
    id: `O${index + 1}`,
    h2: `Section ${index + 1}`,
    h3: [],
    answers: sectionAnswers,
    provenance: { method: "model", derived_from: [...provenance.derived_from] },
  }));
  const [head, ...tail] = items;
  if (head === undefined) throw new Error("unreachable");
  return withFingerprint({
    ...seed,
    must_answer: { status: "available", items: questions },
    outline: { status: "available", items: [head, ...tail] },
    draft_readiness: { ...seed.draft_readiness, writable: items.map((item) => item.id) },
  });
}

/** As many full-length gap sentences as fit under SECTION_BODY_MAX_BYTES; every one lands in the verify list. */
function fullestSection(brief: ContentBrief, planned: PlannedSection, settings: DraftResult["settings"]): DraftSection {
  const sentence = (n: number): ModelSentence => ({
    text: `${"a".repeat(SENTENCE_MAX_CHARS - 4)} ${n.toString().padStart(3, "0")}`,
    claim: "gap",
    evidence_refs: [],
  });
  const build = (count: number): DraftSection => {
    const output = { paragraphs: [{ sentences: Array.from({ length: count }, (_, index) => sentence(index + 1)) }] };
    const validated = validateSectionOutput(output, sectionEvidenceFor(brief, planned.id, settings));
    if (!validated.ok) throw new Error(`boundary: ${planned.id} rejected at ${validated.path} (${validated.rule})`);
    return {
      id: planned.id,
      h2: planned.h2,
      answers: [...planned.answers],
      status: "ok",
      body: { word_count: validated.word_count, paragraphs: validated.paragraphs },
      llm: { attempts: 1, input_tokens: 5_000, output_tokens: 2_500 },
    };
  };
  let section = build(1);
  for (let count = 2; count <= SECTION_MAX_SENTENCES; count += 1) {
    const next = build(count);
    if (bytes(next) > SECTION_BODY_MAX_BYTES) break;
    section = next;
  }
  return section;
}

async function largestDraft(): Promise<{ brief: ContentBrief; result: DraftResult }> {
  const wide = await widestBrief();
  const settings = base.settings;
  const plan = planSections(wide, wide.draft_readiness.writable);
  if ("ok" in plan) throw new Error("boundary: nothing writable");
  const sections = plan.requested.map((planned) => fullestSection(wide, planned, settings));
  const askable = wide.must_answer.status === "available" ? wide.must_answer.items.map((item) => item.id) : [];
  const owner = new Map(sections.flatMap((section) => section.answers.map((question) => [question, section.id] as const)));
  const verdict = validateCoverageOutput(
    { items: askable.map((question) => ({ question_id: question, status: "partial", covered_in: owner.get(question) ?? null, gap: "g".repeat(MODEL_TEXT_MAX_CHARS) })) },
    askable,
    new Set(sections.map((section) => section.id)),
  );
  if (!verdict.ok) throw new Error(`boundary: coverage rejected at ${verdict.path}`);
  const llmCoverage = base.run.reads.llm_coverage;
  const result = await assembleDraftResult({
    run: { run_id: "draft_boundary", reran_from: null, collected_at: "2026-08-29T00:00:00.000Z", elapsed_ms: 0, budget_ms: DRAFT_TOTAL_BUDGET_MS },
    brief: wide,
    settings,
    sections,
    coverage: buildCoverage(wide, [], verdict.items, llmCoverage),
    llmSections: aggregateOf(sections),
    llmCoverage,
  });
  return { brief: wide, result };
}

/* ------------------------------------------------------------------ */
/* accepted                                                            */
/* ------------------------------------------------------------------ */

describe("parseDraftResultShape accepts", () => {
  it("the base fixture, returning an equal but distinct object", () => {
    const value = expectAccepted(base);
    expect(value).toEqual(base);
    expect(value).not.toBe(base);
    expect(value.sections).not.toBe(base.sections);
    expect(value.sections[0]).not.toBe(base.sections[0]);
  });

  it("every fixture variant assembled through draft-assemble", () => {
    for (const result of [failed, skipped, noCoverage, throughout, nothingOk, plain]) expectAccepted(result);
    expect(failed.run).toMatchObject({ mode: "degraded", reads: { sections: { requested: 3, ok: 2, failed: 1, skipped: 0 }, llm_sections: { status: "partial", failed_reasons: ["timeout"] } } });
    expect(skipped.run).toMatchObject({ mode: "partial", reads: { sections: { requested: 2, ok: 2, failed: 0, skipped: 1 }, llm_sections: { status: "complete" } } });
    expect(noCoverage.run.mode).toBe("degraded");
    expect(noCoverage.coverage).toEqual({ status: "unavailable", reason: "timeout", attempted: 1 });
    expect(nothingOk.run).toMatchObject({ mode: "unavailable", reads: { sections: { requested: 2, ok: 0, failed: 2, skipped: 1 }, llm_sections: { status: "unavailable", reason: "timeout", attempted: 2, calls: 4 } } });
    expect(nothingOk.run.reads.llm_coverage).toMatchObject({ status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0 });
    expect(nothingOk.coverage).toMatchObject({ status: "available", total: 4, none: 4 });
  });

  it("the fixture facts the negatives below rely on", () => {
    expect(base.sections.map((section) => [section.id, section.status, section.answers])).toEqual([["O1", "ok", ["Q1"]], ["O2", "ok", ["Q2"]], ["O3", "ok", ["Q3", "Q4"]]]);
    // gap_only: only the gap angle's home section (O3) was given a fact, so only it carries profile-only and stance sentences.
    expect(okSection(base, 0).body.paragraphs.map((paragraph) => paragraph.sentences.map((sentence) => [sentence.claim, sentence.support_count]))).toEqual([
      [["bound", 2], ["bound", 1]],
      [["gap", 0], ["no_claim", 0]],
    ]);
    expect(okSection(base, 2).body.paragraphs.map((paragraph) => paragraph.sentences.map((sentence) => [sentence.claim, sentence.evidence_refs]))).toEqual([
      [["bound", ["C5", "C1"]], ["bound", ["C3"]], ["bound", ["P1"]]],
      [["gap", []], ["no_claim", []], ["stance", ["P1"]]],
    ]);
    expect(okSection(base, 0).body.paragraphs[0]?.sentences.map((sentence) => sentence.evidence_refs)).toEqual([["C1", "C2"], ["C4"]]);
    expect(base.verify_before_publish.map((item) => item.kind)).toEqual([
      "single_source", "gap",
      "single_source", "gap",
      "single_source", "profile_only", "gap", "stance",
    ]);
    expect(throughout.verify_before_publish.map((item) => item.kind)).toEqual([
      "single_source", "profile_only", "gap",
      "single_source", "profile_only", "gap",
      "single_source", "profile_only", "gap", "stance",
    ]);
    expect(okSection(throughout, 2).body.paragraphs[1]?.sentences.at(-1)).toMatchObject({ claim: "stance", evidence_refs: ["P2"] });
    expect(base.coverage).toMatchObject({ status: "available", total: 4, covered: 2, partial: 1, none: 1 });
    expect(base.coverage.status === "available" && base.coverage.items.map((item) => [item.question_id, item.status, item.method])).toEqual([["Q1", "covered", "model"], ["Q2", "partial", "model"], ["Q3", "none", "model"], ["Q4", "covered", "model"]]);
    expect(failed.coverage.status === "available" && failed.coverage.items[1]).toEqual({ question_id: "Q2", status: "none", covered_in: null, gap: null, method: "heuristic", cause: "section_failed" });
    expect(base.run).toMatchObject({ mode: "complete", reran_from: null, budget_ms: DRAFT_TOTAL_BUDGET_MS, reads: { llm_sections: { status: "complete", calls: 3, input_tokens: 12_300 } } });
    // A failed section with unreported usage makes the aggregate's usage unknown (draft-assemble sumTokens).
    expect(failed.run.reads.llm_sections).toMatchObject({ calls: 4, input_tokens: null, output_tokens: null });
    expect(plain.verify_before_publish.map((item) => item.kind)).toEqual(["single_source", "gap", "single_source", "gap", "single_source", "gap"]);
  });

  it("a rerun whose llm_sections reflects the one call it made", () => {
    const rerun = mutated(failed, (draft) => {
      draft.run.reran_from = "draft_prev";
      draft.run.budget_ms = SECTION_ENDPOINT_BUDGET_MS;
      draft.run.reads.llm_sections = { status: "complete", calls: 1, model_id: "m", temperature_requested: 0.4, temperature_effective: null, input_tokens: 4_000, output_tokens: 600, failed_reasons: [] };
    });
    expectAccepted(rerun);
    expectAccepted(mutated(rerun, (draft) => {
      draft.run.reads.llm_sections = { status: "unavailable", reason: "timeout", attempted: 1, calls: 2, model_id: null, input_tokens: null, output_tokens: null, failed_reasons: ["timeout"] };
    }));
  });
});

/* ------------------------------------------------------------------ */
/* shape                                                               */
/* ------------------------------------------------------------------ */

describe("parseDraftResultShape rejects", () => {
  it("non-objects, the wrong schema, unknown and missing keys", () => {
    expectShape("nope", "invalid_request", "");
    expectShape(mutated(base, (draft) => { draft.schema = "gengrowth.content_draft/v2"; }), "brief_schema_mismatch", "schema");
    expectShape(mutated(base, (draft) => { draft.extra = 1; }), "invalid_request", "extra");
    expectShape(mutated(base, (draft) => { delete draft.totals; }), "invalid_request", "totals");
    expectShape(mutated(base, (draft) => { draft.brief_ref.schema = "x"; }), "invalid_request", "brief_ref.schema");
    expectShape(mutated(base, (draft) => { draft.brief_ref.fingerprint = ""; }), "invalid_request", "brief_ref.fingerprint");
    expectShape(mutated(base, (draft) => { draft.totals.word_count = "12"; }), "invalid_request", "totals.word_count");
  });

  it("settings outside the three enumerations", () => {
    expectShape(mutated(base, (draft) => { draft.settings.tone = "casual"; }), "invalid_request", "settings.tone");
    expectShape(mutated(base, (draft) => { draft.settings.person = "first"; }), "invalid_request", "settings.person");
    expectShape(mutated(base, (draft) => { draft.settings.product_mention = "always"; }), "invalid_request", "settings.product_mention");
    expectShape(mutated(base, (draft) => { draft.settings.voice = "x"; }), "invalid_request", "settings.voice");
  });

  it("run metadata outside the contract", () => {
    expectShape(mutated(base, (draft) => { draft.run.mode = "great"; }), "invalid_request", "run.mode");
    expectShape(mutated(base, (draft) => { draft.run.collected_at = "yesterday"; }), "invalid_request", "run.collected_at");
    expectShape(mutated(base, (draft) => { draft.run.reran_from = 5; }), "invalid_request", "run.reran_from");
    expectShape(mutated(base, (draft) => { draft.run.budget_ms = 1; }), "invalid_request", "run.budget_ms");
    expectShape(mutated(base, (draft) => { draft.run.reads.sections.ok = -1; }), "invalid_request", "run.reads.sections.ok");
    expectShape(mutated(base, (draft) => { draft.run.fingerprint = 123; }), "invalid_request", "run.fingerprint");
  });

  it("section branches that carry another branch's keys", () => {
    expectShape(mutated(base, (draft) => { draft.sections[0].status = "done"; }), "invalid_request", "sections[0].status");
    expectShape(mutated(base, (draft) => { delete draft.sections[0].body; }), "invalid_request", "sections[0].body");
    expectShape(mutated(failed, (draft) => { draft.sections[1].body = { word_count: 0, paragraphs: [] }; }), "invalid_request", "sections[1].body");
    expectShape(mutated(failed, (draft) => { draft.sections[1].fail_reason = "quota"; }), "invalid_request", "sections[1].fail_reason");
    expectShape(mutated(skipped, (draft) => { draft.sections[2].llm = { attempts: 0, input_tokens: null, output_tokens: null }; }), "invalid_request", "sections[2].llm");
    expectShape(mutated(base, (draft) => { draft.sections[0].id = "S1"; }), "invalid_request", "sections[0].id");
    expectShape(mutated(base, (draft) => { draft.sections[0].h2 = ""; }), "invalid_request", "sections[0].h2");
    expectShape(mutated(base, (draft) => { draft.sections[0].answers = []; }), "invalid_request", "sections[0].answers");
    expectShape(mutated(base, (draft) => { draft.sections[0].answers = ["Q1", "Q1"]; }), "invalid_request", "sections[0].answers");
    expectShape(mutated(base, (draft) => { draft.sections[0].llm.attempts = 0; }), "invalid_request", "sections[0].llm.attempts");
    expectShape(mutated(base, (draft) => { draft.sections[0].llm.attempts = SECTION_MAX_ATTEMPTS + 1; }), "invalid_request", "sections[0].llm.attempts");
    expectShape(mutated(base, (draft) => { draft.sections = [...draft.sections, ...draft.sections, ...draft.sections]; }), "invalid_request", "sections");
  });

  it("sentences outside the contract", () => {
    const path = sentenceAt(0, 0, 0);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].claim = "maybe"; }), "invalid_request", `${path}.claim`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].evidence_refs = ["X1"]; }), "invalid_request", `${path}.evidence_refs[0]`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].evidence_refs = ["C1", "C1"]; }), "invalid_request", `${path}.evidence_refs`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].support_count = 1.5; }), "invalid_request", `${path}.support_count`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].text = "Bold <b>claim</b>."; }), "invalid_request", `${path}.text`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].text = "Two  spaces."; }), "invalid_request", `${path}.text`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].text = ""; }), "invalid_request", `${path}.text`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].text = "a".repeat(SENTENCE_MAX_CHARS + 1); }), "invalid_request", `${path}.text`);
    expectShape(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences = []; }), "invalid_request", `${path.slice(0, path.lastIndexOf("["))}`);
  });

  it("a section over the sentence cap or the byte cap", () => {
    const connector = { text: "And so on.", claim: "no_claim", evidence_refs: [], support_count: 0 };
    expectShape(mutated(base, (draft) => {
      draft.sections[0].body.paragraphs = [{ sentences: Array.from({ length: SECTION_MAX_SENTENCES + 1 }, () => ({ ...connector })) }];
    }), "invalid_request", "sections[0].body.paragraphs");
    const long = { ...connector, text: "a".repeat(SENTENCE_MAX_CHARS) };
    const count = Math.ceil(SECTION_BODY_MAX_BYTES / SENTENCE_MAX_CHARS) + 1;
    expect(count).toBeLessThanOrEqual(SECTION_MAX_SENTENCES);
    expectShape(mutated(base, (draft) => {
      draft.sections[0].body.paragraphs = [{ sentences: Array.from({ length: count }, () => ({ ...long })) }];
    }), "invalid_request", "sections[0]");
  });

  it("coverage items whose fields belong to another branch", () => {
    expectShape(mutated(base, (draft) => { draft.coverage.items[0].gap = "x"; }), "invalid_request", "coverage.items[0].gap");
    expectShape(mutated(base, (draft) => { draft.coverage.items[0].status = "maybe"; }), "invalid_request", "coverage.items[0].status");
    expectShape(mutated(base, (draft) => { draft.coverage.items[1].cause = null; }), "invalid_request", "coverage.items[1].cause");
    expectShape(mutated(base, (draft) => { draft.coverage.items[1].gap = "a".repeat(MODEL_TEXT_MAX_CHARS + 1); }), "invalid_request", "coverage.items[1].gap");
    expectShape(mutated(base, (draft) => { draft.coverage.items[2].gap = null; }), "invalid_request", "coverage.items[2].gap");
    expectShape(mutated(base, (draft) => { draft.coverage.items[2].method = "rule"; }), "invalid_request", "coverage.items[2].method");
    expectShape(mutated(failed, (draft) => { draft.coverage.items[1].cause = "content"; }), "invalid_request", "coverage.items[1].cause");
    expectShape(mutated(failed, (draft) => { draft.coverage.items[1].covered_in = "O1"; }), "invalid_request", "coverage.items[1].covered_in");
    expectShape(mutated(base, (draft) => { draft.coverage.provenance.derived_from = ["crawl"]; }), "invalid_request", "coverage.provenance.derived_from");
    expectShape(mutated(noCoverage, (draft) => { draft.coverage.items = []; }), "invalid_request", "coverage.items");
  });

  it("llm reads whose keys do not match their status", () => {
    expectShape(mutated(base, (draft) => { draft.run.reads.llm_sections.reason = "timeout"; }), "invalid_request", "run.reads.llm_sections.reason");
    expectShape(mutated(failed, (draft) => { draft.run.reads.llm_sections.model_id = null; }), "invalid_request", "run.reads.llm_sections.model_id");
    expectShape(mutated(failed, (draft) => { draft.run.reads.llm_sections.failed_reasons = ["oops"]; }), "invalid_request", "run.reads.llm_sections.failed_reasons[0]");
    expectShape(mutated(failed, (draft) => {
      draft.run.reads.llm_sections = { status: "unavailable", reason: "timeout", attempted: 1, calls: 2, model_id: null, input_tokens: null, output_tokens: null };
    }), "invalid_request", "run.reads.llm_sections.failed_reasons");
    expectShape(mutated(base, (draft) => { delete draft.run.reads.llm_coverage.temperature_requested; }), "invalid_request", "run.reads.llm_coverage.temperature_requested");
    expectShape(mutated(noCoverage, (draft) => { draft.run.reads.llm_coverage.temperature_requested = 0; }), "invalid_request", "run.reads.llm_coverage.temperature_requested");
  });

  it("verify items outside the contract", () => {
    expectShape(mutated(base, (draft) => { draft.verify_before_publish[0].kind = "weak"; }), "invalid_request", "verify_before_publish[0].kind");
    expectShape(mutated(base, (draft) => { draft.verify_before_publish[0].section_id = "Q1"; }), "invalid_request", "verify_before_publish[0].section_id");
  });
});

describe("DraftResult byte cap", () => {
  it("refuses a result over DRAFT_RESULT_MAX_BYTES before looking at its shape", () => {
    expectShape({ ...base, padding: "x".repeat(DRAFT_RESULT_MAX_BYTES) }, "invalid_request", "");
    expectShape({ padding: "x".repeat(DRAFT_RESULT_MAX_BYTES) }, "invalid_request", "");
  });

  it("fits the largest contract-valid result, plus a full-size brief, under the section request cap", async () => {
    expect(MUST_ANSWER_CAP).toBeGreaterThanOrEqual(OUTLINE_CAP);
    const big = await largestDraft();
    expect(big.result.sections).toHaveLength(OUTLINE_CAP);
    expect(big.result.verify_before_publish.length).toBe(big.result.sections.reduce((sum, section) => sum + (section.status === "ok" ? section.body.paragraphs[0]?.sentences.length ?? 0 : 0), 0));
    expect(big.result.coverage).toMatchObject({ status: "available", total: MUST_ANSWER_CAP, partial: MUST_ANSWER_CAP });
    expect(await parseDraftResult(big.result, big.brief)).toEqual({ ok: true, value: big.result });
    const draftBytes = bytes(big.result);
    const briefBytes = bytes(big.brief);
    const shellBytes = bytes({ brief: big.brief, section_id: "O7", previous: big.result }) - briefBytes - draftBytes;
    expect(draftBytes).toBeLessThanOrEqual(DRAFT_RESULT_MAX_BYTES);
    expect(draftBytes + CONTENT_BRIEF_HANDOFF_MAX_BYTES + shellBytes).toBeLessThanOrEqual(SECTION_REQUEST_MAX_BYTES);
  });
});

/* ------------------------------------------------------------------ */
/* recompute without the brief                                         */
/* ------------------------------------------------------------------ */

describe("recompute: section bodies", () => {
  it("re-derives support_count and word_count from the sentences", () => {
    expectReference(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].support_count = 1; }), `${sentenceAt(0, 0, 0)}.support_count`);
    expectReference(mutated(base, (draft) => { draft.sections[0].body.word_count += 1; }), "sections[0].body.word_count");
    expectReference(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].text = "Shorter."; }), "sections[0].body.word_count");
  });

  it("applies validate-section's claim rules", () => {
    expectReference(mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].evidence_refs = []; }), `${sentenceAt(0, 0, 0)}.evidence_refs`);
    expectReference(mutated(base, (draft) => { draft.sections[0].body.paragraphs[1].sentences[0].evidence_refs = ["C1"]; }), `${sentenceAt(0, 1, 0)}.evidence_refs`);
    expectReference(mutated(base, (draft) => { draft.sections[2].body.paragraphs[1].sentences[2].evidence_refs = ["C1"]; }), `${sentenceAt(2, 1, 2)}.evidence_refs`);
    expectReference(mutated(base, (draft) => {
      draft.sections[0].body.paragraphs[1].sentences[1].evidence_refs = ["P1"];
      draft.sections[0].body.paragraphs[1].sentences[1].claim = "no_claim";
    }), `${sentenceAt(0, 1, 1)}.evidence_refs`);
  });

  it("rejects a repeated section id", () => {
    expectReference(mutated(base, (draft) => { draft.sections[1].id = "O1"; }), "sections[1].id");
  });

  it("ties a failed section's attempts and usage to its reason", () => {
    const withReason = (fail_reason: string, attempts: number, input_tokens: number | null = null) =>
      mutated(failed, (draft) => {
        draft.sections[1].fail_reason = fail_reason;
        draft.sections[1].llm = { attempts, input_tokens, output_tokens: null };
        draft.run.reads.llm_sections = aggregateOf(draft.sections);
      });
    expectAccepted(withReason("not_configured", 0));
    expectAccepted(withReason("timeout", 0));
    expectAccepted(withReason("timeout", 1, 900));
    expectReference(withReason("not_configured", 1), "sections[1].llm.attempts");
    expectReference(withReason("validation_failed", 0), "sections[1].llm.attempts");
    expectReference(withReason("provider_error", 0), "sections[1].llm.attempts");
    expectReference(withReason("timeout", 0, 5), "sections[1].llm.input_tokens");
    expectReference(mutated(failed, (draft) => { draft.sections[1].llm = { attempts: 0, input_tokens: null, output_tokens: 3 }; }), "sections[1].llm.output_tokens");
  });

  it("accepts a same-length text edit here and leaves it to the fingerprint", async () => {
    const edited = mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[0].text = draft.sections[0].body.paragraphs[0].sentences[0].text.replace("Most", "Some"); });
    expectAccepted(edited);
    expect(await parseDraftResult(edited, brief)).toEqual(failure("brief_fingerprint_mismatch", "run.fingerprint"));
  });
});

describe("recompute: verify list, totals, reads and mode", () => {
  it("re-derives verify_before_publish from the sections", () => {
    expectReference(mutated(base, (draft) => { draft.verify_before_publish.splice(0, 1); }), "verify_before_publish");
    expectReference(mutated(base, (draft) => { draft.verify_before_publish[0].kind = "gap"; }), "verify_before_publish[0].kind");
    expectReference(mutated(base, (draft) => { draft.verify_before_publish[0].sentence = "Another sentence."; }), "verify_before_publish[0].sentence");
    expectReference(mutated(base, (draft) => { draft.verify_before_publish[0].support_count = 2; }), "verify_before_publish[0].support_count");
  });

  it("re-derives totals and reads.sections", () => {
    expectReference(mutated(base, (draft) => { draft.totals.word_count += 1; }), "totals.word_count");
    expectReference(mutated(base, (draft) => { draft.run.reads.sections.ok = 2; }), "run.reads.sections.ok");
    expectReference(mutated(skipped, (draft) => { draft.run.reads.sections.skipped = 0; }), "run.reads.sections.skipped");
  });

  it("refuses a run that requested no section at all", () => {
    expectReference(mutated(base, (draft) => {
      draft.sections = draft.sections.map(({ id, h2, answers }: Draft) => ({ id, h2, answers, status: "skipped" }));
      draft.run.reads.sections = { requested: 0, ok: 0, failed: 0, skipped: 3 };
    }), "run.reads.sections.requested");
  });

  it("re-derives run.mode", () => {
    expectReference(mutated(base, (draft) => { draft.run.mode = "partial"; }), "run.mode");
    expectReference(mutated(skipped, (draft) => { draft.run.mode = "complete"; }), "run.mode");
    expectReference(mutated(failed, (draft) => { draft.run.mode = "partial"; }), "run.mode");
    expectReference(mutated(noCoverage, (draft) => { draft.run.mode = "complete"; }), "run.mode");
    expectReference(mutated(nothingOk, (draft) => { draft.run.mode = "degraded"; }), "run.mode");
  });
});

describe("recompute: llm_sections", () => {
  it("re-aggregates a first run from the sections' own call records", () => {
    expectReference(mutated(failed, (draft) => { draft.run.reads.llm_sections.status = "complete"; }), "run.reads.llm_sections.status");
    expectReference(mutated(base, (draft) => {
      draft.run.reads.llm_sections.status = "partial";
      draft.run.reads.llm_sections.failed_reasons = ["timeout"];
    }), "run.reads.llm_sections.status");
    expectReference(mutated(base, (draft) => { draft.run.reads.llm_sections.calls += 1; }), "run.reads.llm_sections.calls");
    expectReference(mutated(base, (draft) => { draft.run.reads.llm_sections.input_tokens += 1; }), "run.reads.llm_sections.input_tokens");
    expectReference(mutated(base, (draft) => { draft.run.reads.llm_sections.output_tokens = null; }), "run.reads.llm_sections.output_tokens");
    expectReference(mutated(failed, (draft) => { draft.run.reads.llm_sections.failed_reasons = ["provider_error"]; }), "run.reads.llm_sections.failed_reasons[0]");
    expectReference(mutated(failed, (draft) => {
      draft.run.reads.llm_sections = { status: "unavailable", reason: "timeout", attempted: 3, calls: 4, model_id: null, input_tokens: 8_200, output_tokens: 1_220, failed_reasons: ["timeout"] };
    }), "run.reads.llm_sections.status");
  });

  it("keeps the aggregate's usage unknown when a real attempt has no usage", () => {
    // Summing the two ok sections over the failed one's missing usage is the lie sumTokens now refuses.
    expectReference(mutated(failed, (draft) => { draft.run.reads.llm_sections.input_tokens = 8_200; }), "run.reads.llm_sections.input_tokens");
    expectReference(mutated(failed, (draft) => { draft.run.reads.llm_sections.output_tokens = 1_220; }), "run.reads.llm_sections.output_tokens");
    expectReference(mutated(nothingOk, (draft) => { draft.run.reads.llm_sections.input_tokens = 0; }), "run.reads.llm_sections.input_tokens");
  });

  it("pins the rerun budget and the rerun's single call", () => {
    const rerun = mutated(failed, (draft) => {
      draft.run.reran_from = "draft_prev";
      draft.run.budget_ms = SECTION_ENDPOINT_BUDGET_MS;
      draft.run.reads.llm_sections = { status: "complete", calls: 1, model_id: "m", temperature_requested: 0.4, temperature_effective: null, input_tokens: 4_000, output_tokens: 600, failed_reasons: [] };
    });
    expectReference(mutated(rerun, (draft) => { draft.run.budget_ms = DRAFT_TOTAL_BUDGET_MS; }), "run.budget_ms");
    expectReference(mutated(base, (draft) => { draft.run.budget_ms = SECTION_ENDPOINT_BUDGET_MS; }), "run.budget_ms");
    expectReference(mutated(rerun, (draft) => { draft.run.reran_from = draft.run.run_id; }), "run.reran_from");
    expectReference(mutated(rerun, (draft) => { draft.run.reads.llm_sections = structuredClone(failed.run.reads.llm_sections); }), "run.reads.llm_sections.status");
    expectReference(mutated(rerun, (draft) => { draft.run.reads.llm_sections.failed_reasons = ["timeout"]; }), "run.reads.llm_sections.failed_reasons");
    expectReference(mutated(rerun, (draft) => { draft.run.reads.llm_sections.calls = 5; }), "run.reads.llm_sections.calls");
    const unavailable = mutated(rerun, (draft) => {
      draft.run.reads.llm_sections = { status: "unavailable", reason: "timeout", attempted: 1, calls: 2, model_id: null, input_tokens: null, output_tokens: null, failed_reasons: ["timeout"] };
    });
    expectAccepted(unavailable);
    expectReference(mutated(unavailable, (draft) => { draft.run.reads.llm_sections.attempted = 2; }), "run.reads.llm_sections.attempted");
    expectReference(mutated(unavailable, (draft) => { draft.run.reads.llm_sections.failed_reasons = []; }), "run.reads.llm_sections.failed_reasons");
    expectReference(mutated(unavailable, (draft) => {
      draft.run.reads.llm_sections.reason = "provider_error";
      draft.run.reads.llm_sections.failed_reasons = ["provider_error"];
    }), "run.reads.llm_sections.reason");
    expectReference(mutated(unavailable, (draft) => { draft.run.reads.llm_sections.calls = 1; }), "run.reads.llm_sections.calls");
  });
});

describe("recompute: coverage against the sections", () => {
  it("recounts covered / partial / none and pins total to the item count", () => {
    expectReference(mutated(base, (draft) => { draft.coverage.covered += 1; }), "coverage.covered");
    expectReference(mutated(base, (draft) => { draft.coverage.partial = 0; }), "coverage.partial");
    expectReference(mutated(base, (draft) => { draft.coverage.none = 2; }), "coverage.none");
    expectReference(mutated(base, (draft) => { draft.coverage.total += 1; }), "coverage.total");
  });

  it("ties heuristic items to a failed or skipped owner and model items to an ok one", () => {
    expectReference(mutated(base, (draft) => { draft.coverage.items[1].question_id = "Q1"; }), "coverage.items[1].question_id");
    expectReference(mutated(base, (draft) => {
      draft.coverage.items[0] = { question_id: "Q1", status: "none", covered_in: null, gap: null, method: "heuristic", cause: "section_failed" };
    }), "coverage.items[0].method");
    expectReference(mutated(failed, (draft) => { draft.coverage.items[1].cause = "section_skipped"; }), "coverage.items[1].cause");
    expectReference(mutated(skipped, (draft) => { draft.coverage.items[2].cause = "section_failed"; }), "coverage.items[2].cause");
    expectReference(mutated(failed, (draft) => {
      draft.coverage.items[1] = { question_id: "Q2", status: "covered", covered_in: "O1", gap: null, method: "model", cause: null };
    }), "coverage.items[1].method");
    expectReference(mutated(failed, (draft) => { draft.coverage.items[0].covered_in = "O2"; }), "coverage.items[0].covered_in");
  });

  it("only accepts a model verdict from one completed call at temperature 0", () => {
    expectReference(mutated(base, (draft) => {
      draft.run.reads.llm_coverage = { status: "unavailable", reason: "timeout", attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: null };
    }), "run.reads.llm_coverage.status");
    expectReference(mutated(base, (draft) => { draft.run.reads.llm_coverage.calls = 2; }), "run.reads.llm_coverage.calls");
    expectReference(mutated(base, (draft) => { draft.run.reads.llm_coverage.temperature_requested = 0.4; }), "run.reads.llm_coverage.temperature_requested");
  });
});

/* ------------------------------------------------------------------ */
/* binding to the brief                                                */
/* ------------------------------------------------------------------ */

describe("parseDraftResult binds to the brief", () => {
  it("pins brief_ref to the brief's run, fingerprint and keyword", async () => {
    await expectBound(mutated(base, (draft) => { draft.brief_ref.run_id = "brief_other"; }), "brief_ref.run_id");
    await expectBound(mutated(base, (draft) => { draft.brief_ref.fingerprint = "deadbeef"; }), "brief_ref.fingerprint");
    await expectBound(mutated(base, (draft) => { draft.brief_ref.keyword = "email deliverability"; }), "brief_ref.keyword");
    // Both fixture briefs share a run_id, so the fingerprint is the first key that tells them apart.
    await expectBound(base, "brief_ref.fingerprint", plainBrief);
  });

  it("pins the section list to the writable outline: set, order, h2 and answers", async () => {
    await expectBound(mutated(base, (draft) => { draft.sections.pop(); }), "sections");
    await expectBound(mutated(base, (draft) => { draft.sections.push({ ...draft.sections[2], id: "O4" }); }), "sections");
    await expectBound(mutated(base, (draft) => { [draft.sections[0], draft.sections[1]] = [draft.sections[1], draft.sections[0]]; }), "sections[0].id");
    await expectBound(mutated(base, (draft) => { draft.sections[0].h2 = "Another heading"; }), "sections[0].h2");
    await expectBound(mutated(base, (draft) => { draft.sections[2].answers = ["Q3", "Q5"]; }), "sections[2].answers[1]");
    await expectBound(mutated(base, (draft) => { draft.sections[2].answers = ["Q3"]; }), "sections[2].answers");
  });

  it("only accepts references the brief can actually back, within the section's own scope", async () => {
    const single = `${sentenceAt(0, 0, 1)}.evidence_refs[0]`;
    const profile = `${sentenceAt(2, 0, 2)}.evidence_refs[0]`;
    // The verify list copies each listed sentence's refs, so a swapped ref is applied to both places.
    const reref = (section: number, sentence: number, verify: number, refs: string[]) =>
      mutated(base, (draft) => {
        draft.sections[section].body.paragraphs[0].sentences[sentence].evidence_refs = refs;
        draft.verify_before_publish[verify].evidence_refs = refs;
      });
    const unknownPage = reref(0, 1, 0, ["C9"]);
    const noExcerpt = reref(0, 1, 0, ["C6"]);
    // C3 has an excerpt but belongs to Q2 / Q3 / Q4's clusters, not to O1's question.
    const otherCluster = reref(0, 1, 0, ["C3"]);
    const unknownFact = reref(2, 2, 5, ["P9"]);
    // P2 is inferred and, under gap_only, not among the gap angle's refs: unknown to every section.
    const inferred = reref(2, 2, 5, ["P2"]);
    for (const result of [unknownPage, noExcerpt, otherCluster, unknownFact, inferred]) expectAccepted(result);
    await expectBound(unknownPage, single);
    await expectBound(noExcerpt, single);
    await expectBound(otherCluster, single);
    await expectBound(unknownFact, profile);
    await expectBound(inferred, profile);
  });

  it("scopes profile facts by product_mention", async () => {
    // A bound sentence citing P2 (inferred) is refused even where P2 is in scope.
    const inferredBound = mutated(throughout, (draft) => {
      draft.sections[0].body.paragraphs[0].sentences[2].evidence_refs = ["P2"];
      draft.verify_before_publish[1].evidence_refs = ["P2"];
    });
    await expectBound(inferredBound, `${sentenceAt(0, 0, 2)}.evidence_refs[0]`);
    // none: no section was given a fact, so O3's profile-only sentence has nothing to cite.
    await expectBound(mutated(base, (draft) => { draft.settings.product_mention = "none"; }), `${sentenceAt(2, 0, 2)}.evidence_refs[0]`);
    // gap_only: only the gap angle's home section was given facts; O1's profile-only sentence is out of scope.
    await expectBound(mutated(throughout, (draft) => { draft.settings.product_mention = "gap_only"; }), `${sentenceAt(0, 0, 2)}.evidence_refs[0]`);
    await expectBound(mutated(throughout, (draft) => { draft.settings.product_mention = "none"; }), `${sentenceAt(0, 0, 2)}.evidence_refs[0]`);
    expect(await parseDraftResult(throughout, brief)).toEqual({ ok: true, value: throughout });
  });

  it("only lets the gap angle's home section take a stance", async () => {
    const stance = { text: "Pooled warmup is the better default for a new domain.", claim: "stance", evidence_refs: ["P1"], support_count: 0 };
    // O1 was given P1 under throughout, so only the stance rule can refuse this sentence.
    const outside = mutated(throughout, (draft) => { draft.sections[0].body.paragraphs[1].sentences.push({ ...stance }); });
    await expectBound(outside, `${sentenceAt(0, 1, 2)}.claim`);
    // The same sentence in O3 (the gap angle's home) is the fixture's own stance, re-pointed at P1.
    const home = mutated(throughout, (draft) => {
      draft.sections[2].body.paragraphs[1].sentences[2] = { ...stance };
      draft.verify_before_publish[9] = { ...draft.verify_before_publish[9], evidence_refs: ["P1"] };
    });
    expectAccepted(home);
    expect(await parseDraftResult(home, brief, { fingerprint: fakeFingerprint })).toEqual(failure("brief_fingerprint_mismatch", "run.fingerprint"));
  });

  it("re-derives coverage: heuristic set, askable set, order and the unavailable gate", async () => {
    await expectBound(mutated(base, (draft) => {
      draft.coverage.items.splice(3, 1);
      draft.coverage.total = 3;
      draft.coverage.covered = 1;
    }), "coverage.items");
    await expectBound(mutated(base, (draft) => { [draft.coverage.items[0], draft.coverage.items[1]] = [draft.coverage.items[1], draft.coverage.items[0]]; }), "coverage.items[0].question_id");
    await expectBound(mutated(noCoverage, (draft) => { draft.coverage.reason = "provider_error"; }), "coverage.reason");
    await expectBound(mutated(noCoverage, (draft) => { draft.coverage.attempted = 2; }), "coverage.attempted");
    await expectBound(mutated(noCoverage, (draft) => { draft.run.reads.llm_coverage = structuredClone(base.run.reads.llm_coverage); }), "coverage.reason");
  });

  it("keeps the coverage ledger honest about what there was to ask", async () => {
    const withReason = (reason: string, attempted: number | null) =>
      mutated(noCoverage, (draft) => {
        draft.coverage = { status: "unavailable", reason, attempted };
        draft.run.reads.llm_coverage = { ...draft.run.reads.llm_coverage, reason, attempted };
      });
    // Four questions were askable: the call cannot claim it was not needed.
    for (const reason of ["not_requested", "quota_exhausted", "unsupported_language", "insufficient_evidence"]) {
      await expectBound(withReason(reason, 1), "coverage.reason");
    }
    expect(await parseDraftResult(withReason("provider_error", 1), brief, { fingerprint: fakeFingerprint })).toEqual(failure("brief_fingerprint_mismatch", "run.fingerprint"));
    // Nothing askable: the call never went out, so the whole read is fixed.
    await expectBound(mutated(nothingOk, (draft) => { draft.run.reads.llm_coverage = structuredClone(base.run.reads.llm_coverage); }), "run.reads.llm_coverage.status");
    await expectBound(mutated(nothingOk, (draft) => { draft.run.reads.llm_coverage.calls = 1; }), "run.reads.llm_coverage.calls");
    await expectBound(mutated(nothingOk, (draft) => {
      draft.run.reads.llm_coverage.reason = "timeout";
      draft.run.reads.llm_coverage.attempted = 1;
    }), "run.reads.llm_coverage.reason");
    await expectBound(mutated(nothingOk, (draft) => {
      draft.run.reads.llm_coverage.model_id = "fake-deployment";
      draft.run.reads.llm_coverage.input_tokens = 123;
    }), "run.reads.llm_coverage.model_id");
    await expectBound(mutated(nothingOk, (draft) => { draft.run.reads.llm_coverage.output_tokens = 0; }), "run.reads.llm_coverage.output_tokens");
    expect(await parseDraftResult(nothingOk, brief)).toEqual({ ok: true, value: nothingOk });
  });

  it("makes a failed coverage read describe its own failure consistently", async () => {
    const read = (reason: string, attempted: number, calls: number, extra: Draft = {}) =>
      mutated(noCoverage, (draft) => {
        draft.coverage = { status: "unavailable", reason, attempted };
        draft.run.reads.llm_coverage = { status: "unavailable", reason, attempted, calls, model_id: null, input_tokens: null, output_tokens: null, ...extra };
      });
    const passes = async (result: DraftResult) =>
      expect(await parseDraftResult(result, brief, { fingerprint: fakeFingerprint })).toEqual(failure("brief_fingerprint_mismatch", "run.fingerprint"));
    // codex: the coverage step makes exactly one call and never retries, so an error or a rejected
    // answer can only come from attempted 1 / calls 1.
    await expectBound(read("provider_error", 1, 0), "run.reads.llm_coverage.calls");
    await expectBound(read("provider_error", 2, 1), "run.reads.llm_coverage.attempted");
    await expectBound(read("provider_error", 0, 0), "run.reads.llm_coverage.attempted");
    await expectBound(read("provider_error", 2, 2), "run.reads.llm_coverage.attempted");
    await expectBound(read("validation_failed", 0, 0), "run.reads.llm_coverage.attempted");
    await expectBound(read("validation_failed", 2, 2), "run.reads.llm_coverage.attempted");
    await expectBound(read("validation_failed", 1, 2), "run.reads.llm_coverage.calls");
    await passes(read("provider_error", 1, 1, { model_id: "gpt-4.1-draft" }));
    await passes(read("validation_failed", 1, 1, { model_id: "gpt-4.1-draft", input_tokens: 3_100, output_tokens: 400 }));
    await expectBound(read("not_configured", 1, 1), "run.reads.llm_coverage.attempted");
    await expectBound(read("not_configured", 0, 1), "run.reads.llm_coverage.calls");
    await expectBound(read("not_configured", 0, 0, { model_id: "gpt-4.1-draft" }), "run.reads.llm_coverage.model_id");
    await passes(read("not_configured", 0, 0));
    await passes(read("timeout", 1, 1, { model_id: "gpt-4.1-draft" }));
    await passes(read("timeout", 0, 0));
    await expectBound(read("timeout", 2, 2), "run.reads.llm_coverage.calls");
    await expectBound(read("timeout", 1, 0), "run.reads.llm_coverage.calls");
    await expectBound(read("timeout", 0, 0, { input_tokens: 5 }), "run.reads.llm_coverage.input_tokens");
    await expectBound(read("not_configured", 0, 0, { output_tokens: 7 }), "run.reads.llm_coverage.output_tokens");
    // A verdict the call did return but the server refused: one completed call at temperature 0.
    const refusedVerdict = (calls: number, temperature: number) =>
      mutated(noCoverage, (draft) => {
        draft.coverage = { status: "unavailable", reason: "validation_failed", attempted: calls };
        draft.run.reads.llm_coverage = { ...base.run.reads.llm_coverage, calls, temperature_requested: temperature };
      });
    await passes(refusedVerdict(1, 0));
    await expectBound(refusedVerdict(2, 0), "run.reads.llm_coverage.calls");
    await expectBound(refusedVerdict(1, 0.4), "run.reads.llm_coverage.temperature_requested");
  });
});

/* ------------------------------------------------------------------ */
/* what the server knows first-hand                                    */
/* ------------------------------------------------------------------ */

describe("parseDraftResult with trusted rerun provenance", () => {
  const failedCall: SectionCallMeta = {
    status: "failed",
    attempts: 2,
    fail_reason: "timeout",
    model_id: "gpt-4.1-draft",
    temperature_requested: 0.4,
    temperature_effective: null,
    input_tokens: null,
    output_tokens: null,
  };
  const okCall: SectionCallMeta = { ...failedCall, status: "ok", attempts: 1, fail_reason: null, temperature_effective: 0.4, input_tokens: 4_000, output_tokens: 600 };
  const rerunOf = (result: DraftResult, call: SectionCallMeta) =>
    mutated(result, (draft) => {
      draft.run.reran_from = "draft_prev";
      draft.run.budget_ms = SECTION_ENDPOINT_BUDGET_MS;
      draft.run.reads.llm_sections = aggregateSectionLlm([call], call.temperature_requested);
    });
  const failedRerun = rerunOf(failed, failedCall);
  const okRerun = rerunOf(base, okCall);
  const provenance = (sectionId: string, call: SectionCallMeta): RerunProvenance => ({ previousRunId: "draft_prev", sectionId, call });

  async function expectTrusted(input: DraftResult, rerun: RerunProvenance, path: string): Promise<void> {
    expect(await parseDraftResult(await fakeStamped(input), brief, { fingerprint: fakeFingerprint, rerun })).toEqual(failure("brief_reference_invalid", path));
  }

  it("accepts a rerun whose section and aggregate match the call the server made", async () => {
    expect(await parseDraftResult(await fakeStamped(failedRerun), brief, { fingerprint: fakeFingerprint, rerun: provenance("O2", failedCall) })).toMatchObject({ ok: true });
    expect(await parseDraftResult(await fakeStamped(okRerun), brief, { fingerprint: fakeFingerprint, rerun: provenance("O1", okCall) })).toMatchObject({ ok: true });
  });

  it("pins reran_from and the rewritten section to the call record", async () => {
    await expectTrusted(failedRerun, { ...provenance("O2", failedCall), previousRunId: "draft_other" }, "run.reran_from");
    await expectTrusted(failedRerun, provenance("O9", failedCall), "sections");
    await expectTrusted(failedRerun, provenance("O1", failedCall), "sections[0].status");
    await expectTrusted(failedRerun, provenance("O2", { ...failedCall, attempts: 1 }), "sections[1].llm.attempts");
    await expectTrusted(failedRerun, provenance("O2", { ...failedCall, fail_reason: "provider_error" }), "sections[1].fail_reason");
    await expectTrusted(okRerun, provenance("O1", { ...okCall, input_tokens: 1 }), "sections[0].llm.input_tokens");
    await expectTrusted(mutated(okRerun, (draft) => { draft.sections[0].llm.output_tokens = 2; }), provenance("O1", okCall), "sections[0].llm.output_tokens");
  });

  it("pins the whole llm_sections aggregate to the one call", async () => {
    // Usage forged into the aggregate while the rewritten section still reports none.
    await expectTrusted(mutated(failedRerun, (draft) => {
      draft.run.reads.llm_sections.input_tokens = 1;
      draft.run.reads.llm_sections.output_tokens = 2;
    }), provenance("O2", failedCall), "run.reads.llm_sections.input_tokens");
    await expectTrusted(mutated(okRerun, (draft) => { draft.run.reads.llm_sections.calls = 2; }), provenance("O1", okCall), "run.reads.llm_sections.calls");
    await expectTrusted(mutated(okRerun, (draft) => { draft.run.reads.llm_sections.model_id = "other"; }), provenance("O1", okCall), "run.reads.llm_sections.model_id");
    await expectTrusted(mutated(okRerun, (draft) => { draft.run.reads.llm_sections.temperature_effective = null; }), provenance("O1", okCall), "run.reads.llm_sections.temperature_effective");
    // Without provenance the same forgery only has to be consistent with some section, so it passes the weak pin.
    expectAccepted(mutated(okRerun, (draft) => { draft.run.reads.llm_sections.model_id = "other"; }));
  });

  it("pins run.reads.llm_coverage to the read the server made", async () => {
    const llm: LlmReadMeta = base.run.reads.llm_coverage;
    expect(await parseDraftResult(base, brief, { coverageLlm: llm })).toEqual({ ok: true, value: base });
    expect(await parseDraftResult(base, brief, { coverageLlm: { ...llm, input_tokens: 1 } })).toEqual(failure("brief_reference_invalid", "run.reads.llm_coverage.input_tokens"));
    expect(await parseDraftResult(noCoverage, brief, { coverageLlm: llm })).toEqual(failure("brief_reference_invalid", "run.reads.llm_coverage.status"));
  });
});

/* ------------------------------------------------------------------ */
/* fingerprint                                                         */
/* ------------------------------------------------------------------ */

describe("parseDraftResult", () => {
  it("accepts every fixture variant with the real draftFingerprint and returns a fresh copy", async () => {
    for (const result of [base, failed, skipped, noCoverage, throughout, nothingOk]) {
      const parsed = await parseDraftResult(result, brief);
      expect(parsed).toEqual({ ok: true, value: result });
      if (parsed.ok) expect(parsed.value).not.toBe(result);
    }
    expect(await parseDraftResult(plain, plainBrief)).toEqual({ ok: true, value: plain });
    expect(await draftFingerprint(base)).toBe(base.run.fingerprint);
  });

  it("ignores elapsed_ms but catches any other edit made after stamping", async () => {
    const slower = { ...base, run: { ...base.run, elapsed_ms: base.run.elapsed_ms + 1 } };
    expect(await parseDraftResult(slower, brief)).toEqual({ ok: true, value: slower });
    const retoned = mutated(base, (draft) => { draft.settings.tone = "technical"; });
    expect(await parseDraftResult(retoned, brief)).toEqual(failure("brief_fingerprint_mismatch", "run.fingerprint"));
  });

  it("hands the injected hasher the parsed copy, and never calls it on a rejected draft", async () => {
    const stamped = await fakeStamped(base);
    const seen: DraftResult[] = [];
    const spy = vi.fn(async (result: DraftResult) => {
      seen.push(result);
      return fakeFingerprint(result);
    });
    expect(await parseDraftResult(stamped, brief, { fingerprint: spy })).toEqual({ ok: true, value: stamped });
    expect(seen[0]).not.toBe(stamped);
    expect(seen[0]).toEqual(stamped);
    spy.mockClear();
    expect(await parseDraftResult(mutated(stamped, (draft) => { draft.run.mode = "partial"; }), brief, { fingerprint: spy })).toEqual(failure("brief_reference_invalid", "run.mode"));
    expect(await parseDraftResult({ schema: "nope" }, brief, { fingerprint: spy })).toEqual(failure("brief_schema_mismatch", "schema"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a re-fingerprinted draft whose derived fields no longer match", async () => {
    const forged = mutated(base, (draft) => { draft.sections[0].body.paragraphs[0].sentences[1].support_count = 2; });
    const restamped = { ...forged, run: { ...forged.run, fingerprint: await draftFingerprint(forged) } };
    expect(await parseDraftResult(restamped, brief)).toEqual(failure("brief_reference_invalid", `${sentenceAt(0, 0, 1)}.support_count`));
  });
});

/* ------------------------------------------------------------------ */
/* section endpoint request parts                                      */
/* ------------------------------------------------------------------ */

describe("parseDraftSections", () => {
  it("accepts the sections of every variant and returns a fresh array", () => {
    for (const result of [base, failed, skipped, noCoverage, nothingOk]) {
      const parsed = parseDraftSections(result.sections, brief, SETTINGS);
      expect(parsed).toEqual({ ok: true, value: result.sections });
      if (parsed.ok) {
        expect(parsed.value).not.toBe(result.sections);
        expect(parsed.value[0]).not.toBe(result.sections[0]);
      }
    }
    expect(parseDraftSections(throughout.sections, brief, throughout.settings)).toEqual({ ok: true, value: throughout.sections });
    expect(parseDraftSections(plain.sections, plainBrief, SETTINGS)).toEqual({ ok: true, value: plain.sections });
  });

  it("rejects the wrong shape under the sections path", () => {
    expect(parseDraftSections("nope", brief, SETTINGS)).toEqual(failure("invalid_request", "sections"));
    expect(parseDraftSections([...base.sections, ...base.sections, ...base.sections], brief, SETTINGS)).toEqual(failure("invalid_request", "sections"));
    expect(parseDraftSections(mutated(base.sections, (draft) => { draft[0].status = "done"; }), brief, SETTINGS)).toEqual(failure("invalid_request", "sections[0].status"));
    const oversized = mutated(base.sections, (draft) => {
      const long = { text: "a".repeat(SENTENCE_MAX_CHARS), claim: "no_claim", evidence_refs: [], support_count: 0 };
      draft[0].body.paragraphs = [{ sentences: Array.from({ length: Math.ceil(SECTION_BODY_MAX_BYTES / SENTENCE_MAX_CHARS) + 1 }, () => ({ ...long })) }];
    });
    expect(parseDraftSections(oversized, brief, SETTINGS)).toEqual(failure("invalid_request", "sections[0]"));
    expect(parseDraftSections(mutated(failed.sections, (draft) => { draft[1].llm = { attempts: 0, input_tokens: 5, output_tokens: null }; }), brief, SETTINGS)).toEqual(
      failure("brief_reference_invalid", "sections[1].llm.input_tokens"),
    );
  });

  it("binds every section to the brief under the request's settings", () => {
    expect(parseDraftSections(base.sections.slice(0, 2), brief, SETTINGS)).toEqual(failure("brief_reference_invalid", "sections"));
    expect(parseDraftSections(mutated(base.sections, (draft) => { draft[0].h2 = "Other"; }), brief, SETTINGS)).toEqual(failure("brief_reference_invalid", "sections[0].h2"));
    expect(parseDraftSections(mutated(base.sections, (draft) => { draft[1].id = "O1"; }), brief, SETTINGS)).toEqual(failure("brief_reference_invalid", "sections[1].id"));
    expect(parseDraftSections(mutated(base.sections, (draft) => { draft[0].body.paragraphs[0].sentences[1].evidence_refs = ["C9"]; }), brief, SETTINGS)).toEqual(
      failure("brief_reference_invalid", `${sentenceAt(0, 0, 1)}.evidence_refs[0]`),
    );
    expect(parseDraftSections(mutated(base.sections, (draft) => { draft[0].body.paragraphs[0].sentences[1].evidence_refs = ["C3"]; }), brief, SETTINGS)).toEqual(
      failure("brief_reference_invalid", `${sentenceAt(0, 0, 1)}.evidence_refs[0]`),
    );
    expect(parseDraftSections(mutated(base.sections, (draft) => { draft[0].body.word_count += 1; }), brief, SETTINGS)).toEqual(failure("brief_reference_invalid", "sections[0].body.word_count"));
    // The same sections under settings that gave no section a fact.
    expect(parseDraftSections(base.sections, brief, { ...SETTINGS, product_mention: "none" })).toEqual(failure("brief_reference_invalid", `${sentenceAt(2, 0, 2)}.evidence_refs[0]`));
    expect(parseDraftSections(throughout.sections, brief, SETTINGS)).toEqual(failure("brief_reference_invalid", `${sentenceAt(0, 0, 2)}.evidence_refs[0]`));
    expect(parseDraftSections(base.sections, plainBrief, SETTINGS)).toEqual(failure("brief_reference_invalid", `${sentenceAt(2, 0, 2)}.evidence_refs[0]`));
  });

  it("caps the list at the outline cap", () => {
    expect(OUTLINE_CAP).toBeLessThan(9);
  });
});

describe("parseDraftSettings", () => {
  it("accepts every combination and returns a new object", () => {
    for (const tone of ["explanatory", "conversational", "technical"] as const) {
      for (const person of ["second", "third"] as const) {
        for (const product_mention of ["none", "gap_only", "throughout"] as const) {
          const settings = { tone, person, product_mention };
          const parsed = parseDraftSettings(settings);
          expect(parsed).toEqual({ ok: true, value: settings });
          if (parsed.ok) expect(parsed.value).not.toBe(settings);
        }
      }
    }
  });

  it("rejects non-objects, unknown values, unknown and missing keys under the settings path", () => {
    expect(parseDraftSettings(null)).toEqual(failure("invalid_request", "settings"));
    expect(parseDraftSettings({ tone: "casual", person: "second", product_mention: "none" })).toEqual(failure("invalid_request", "settings.tone"));
    expect(parseDraftSettings({ tone: "technical", person: "second", product_mention: "none", extra: 1 })).toEqual(failure("invalid_request", "settings.extra"));
    expect(parseDraftSettings({ tone: "technical", product_mention: "none" })).toEqual(failure("invalid_request", "settings.person"));
  });
});
