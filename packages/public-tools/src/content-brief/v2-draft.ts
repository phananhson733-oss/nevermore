// @input -- untrusted Draft v2 delivery and one exact confirmed Brief revision
// @output -- detached, source-scoped result with recomputed coverage, receipts and checksum
// @pos -- whole-result boundary; checksums prove content integrity, never source authenticity
import { canonicalize, fingerprintCanonical } from "./canonical.ts";
import { DRAFT_TOTAL_BUDGET_MS, MODEL_TEXT_MAX_CHARS, SECTION_ENDPOINT_BUDGET_MS, SECTION_MAX_ATTEMPTS, SECTION_MAX_SENTENCES, SENTENCE_MAX_CHARS } from "./constants.ts";
import type { CoverageItem, LlmAggregateMeta, LlmReadMeta, ModelCoverageOutput } from "./contract.ts";
import { aggregateSectionLlm, validateCoverageOutput, type SectionCallMeta } from "./draft-assemble.ts";
import {
  array, at, byteLength, identifier, invalid, isRecord, literal, llmReadMeta, modelText, nullable,
  object, ok, oneOf, reference, tagged, timestamp, unavailableShape, type Decoded, type Decoder,
} from "./parse-brief-shape.ts";
import { CONFIRMED_BRIEF_V2_SCHEMA, parseConfirmedBriefV2 } from "./v2-brief.ts";
import { measureResearchLength, RESEARCH_HEADING_MAX_CHARS, RESEARCH_OUTLINE_MAX, RESEARCH_QUESTION_MAX } from "./v2-contract.ts";
import { DRAFT_V2_MAX_BYTES, DRAFT_V2_SCHEMA, type DraftResultV2, type DraftV2Coverage, type DraftV2Rerun, type DraftV2Section, type DraftV2Settings, type DraftV2VerifyItem } from "./v2-draft-contract.ts";
import { buildDraftV2SectionScope } from "./v2-draft-scope.ts";
import { parseDraftV2SectionBody } from "./v2-draft-section.ts";
import type { ConfirmedBriefV2 } from "./v2-generation-contract.ts";

export interface AssembleDraftV2Input {
  readonly confirmed: ConfirmedBriefV2;
  readonly settings: DraftV2Settings;
  readonly sections: readonly DraftV2Section[];
  readonly coverage: { readonly items: ModelCoverageOutput["items"] | null; readonly reads: LlmReadMeta };
  readonly run: { readonly run_id: string; readonly collected_at: string; readonly elapsed_ms: number; readonly budget_ms: number; readonly rerun: DraftV2Rerun | null };
}

const count = (max = Number.MAX_SAFE_INTEGER, min = 0): Decoder<number> => (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= min && input <= max ? ok(input) : invalid(path);
const hash: Decoder<string> = (input, path) => typeof input === "string" && /^[a-f0-9]{64}$/u.test(input) ? ok(input) : invalid(path);
const id = (prefix: string): Decoder<string> => (input, path) => {
  const bounded = modelText(128)(input, path);
  return bounded.ok ? identifier(prefix)(bounded.value, path) : bounded;
};
const temperature: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isFinite(input) && input >= 0 && input <= 2 ? ok(input) : invalid(path);
const failReason = oneOf(["timeout", "provider_error", "not_configured", "validation_failed"] as const);
const tokens = { input_tokens: nullable(count()), output_tokens: nullable(count()) };
const settingsShape = object({
  tone: oneOf(["explanatory", "conversational", "technical"] as const),
  person: oneOf(["second", "third"] as const), product_mention: oneOf(["none", "gap_only", "throughout"] as const),
});
const rerunShape = nullable(object({ previous_run_id: modelText(128), previous_fingerprint: hash, section_id: id("O") }));
const runInputShape = {
  run_id: modelText(128), collected_at: timestamp, elapsed_ms: count(),
  budget_ms: (input: unknown, path: string) => input === DRAFT_TOTAL_BUDGET_MS || input === SECTION_ENDPOINT_BUDGET_MS ? ok(input) : invalid(path),
  rerun: rerunShape,
};
const llmShape = object({
  attempts: count(SECTION_MAX_ATTEMPTS), model_id: nullable(modelText(2000)),
  temperature_requested: literal(0.4), temperature_effective: nullable(temperature), ...tokens,
});
const readShape: Decoder<LlmReadMeta> = (input, path) => {
  const decoded = llmReadMeta(input, path);
  if (!decoded.ok) return decoded;
  const value = decoded.value;
  if ([value.calls, value.input_tokens, value.output_tokens, ...(value.status === "unavailable" ? [value.attempted] : [])]
    .some((number) => number !== null && !Number.isSafeInteger(number))) return invalid(path);
  if (value.model_id !== null && !modelText(2000)(value.model_id, at(path, "model_id")).ok) return invalid(at(path, "model_id"));
  if (value.status === "complete" && (value.temperature_requested !== 0 ||
      (value.temperature_effective !== null && !temperature(value.temperature_effective, path).ok))) return reference(path);
  return decoded;
};
const failedReasons = array(failReason, { max: RESEARCH_OUTLINE_MAX });
const aggregateAvailable = object({
  status: oneOf(["complete", "partial"] as const), calls: count(RESEARCH_OUTLINE_MAX * SECTION_MAX_ATTEMPTS), model_id: modelText(2000),
  temperature_requested: literal(0.4), temperature_effective: nullable(temperature), ...tokens, failed_reasons: failedReasons,
});
const aggregateShape: Decoder<LlmAggregateMeta> = tagged("status", {
  complete: aggregateAvailable, partial: aggregateAvailable,
  unavailable: object({ ...unavailableShape, attempted: nullable(count(RESEARCH_OUTLINE_MAX)), calls: count(RESEARCH_OUTLINE_MAX * SECTION_MAX_ATTEMPTS), model_id: nullable(modelText(2000)), ...tokens, failed_reasons: failedReasons }),
});
const modelCoverageItems = array(object({
  question_id: id("Q"), status: oneOf(["covered", "partial", "none"] as const), covered_in: nullable(id("O")), gap: nullable(modelText(MODEL_TEXT_MAX_CHARS)),
}), { max: RESEARCH_QUESTION_MAX });
const coverageItem: Decoder<CoverageItem> = tagged("status", {
  covered: object({ question_id: id("Q"), status: literal("covered"), covered_in: id("O"), gap: literal(null), method: literal("model"), cause: literal(null) }),
  partial: object({ question_id: id("Q"), status: literal("partial"), covered_in: id("O"), gap: modelText(MODEL_TEXT_MAX_CHARS), method: literal("model"), cause: literal("content") }),
  none: tagged("method", {
    model: object({ question_id: id("Q"), status: literal("none"), covered_in: literal(null), gap: modelText(MODEL_TEXT_MAX_CHARS), method: literal("model"), cause: literal("content") }),
    heuristic: object({ question_id: id("Q"), status: literal("none"), covered_in: literal(null), gap: literal(null), method: literal("heuristic"), cause: oneOf(["section_failed", "section_skipped"] as const) }),
  }),
});
const coverageShape: Decoder<DraftV2Coverage> = tagged("status", {
  available: object({ status: literal("available"), items: array(coverageItem, { max: RESEARCH_QUESTION_MAX }), total: count(RESEARCH_QUESTION_MAX), covered: count(RESEARCH_QUESTION_MAX), partial: count(RESEARCH_QUESTION_MAX), none: count(RESEARCH_QUESTION_MAX), method: oneOf(["model", "empty_draft"] as const) }),
  unavailable: object({ ...unavailableShape, attempted: nullable(count(1)) }),
});
const noCoverage: LlmReadMeta = { status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null };

function same(left: unknown, right: unknown): boolean { return canonicalize(left) === canonicalize(right); }
function nested<T>(decoded: Decoded<T>, path: string): Decoded<T> {
  return decoded.ok ? decoded : { ...decoded, path: at(path, decoded.path) };
}

function sectionsShape(confirmed: ConfirmedBriefV2, settings: DraftV2Settings): Decoder<DraftV2Section[]> {
  const heading = { id: id("O"), h2: modelText(RESEARCH_HEADING_MAX_CHARS), h3: array(modelText(RESEARCH_HEADING_MAX_CHARS), { max: 3 }), answers: array(id("Q"), { min: 1, max: RESEARCH_QUESTION_MAX, unique: true }) };
  const section: Decoder<DraftV2Section> = (input, path) => {
    if (!isRecord(input)) return invalid(path);
    const sectionId = id("O")(input.id, at(path, "id"));
    if (!sectionId.ok) return sectionId;
    const scope = buildDraftV2SectionScope(confirmed, sectionId.value, settings);
    if (!scope.ok) return nested(scope, path);
    const shape: Decoder<DraftV2Section> = tagged("status", {
      ok: object({ ...heading, status: literal("ok"), body: (body, bodyPath) => nested(parseDraftV2SectionBody(body, scope.value, confirmed.brief.context.input.language), bodyPath), llm: llmShape }),
      failed: object({ ...heading, status: literal("failed"), fail_reason: failReason, llm: llmShape }),
      skipped: object({ ...heading, status: literal("skipped") }),
    });
    const decoded = shape(input, path);
    if (!decoded.ok) return decoded;
    const value = decoded.value;
    if (!same({ id: value.id, h2: value.h2, h3: value.h3, answers: value.answers }, scope.value.section)) return reference(path);
    if (value.status !== "skipped") {
      const call = value.llm;
      if (call.attempts === 0 && (call.model_id !== null || call.input_tokens !== null || call.output_tokens !== null || call.temperature_effective !== null)) return reference(at(path, "llm"));
      if (value.status === "ok" && (call.attempts === 0 || call.model_id === null)) return reference(at(path, "llm"));
      // Prompt validation can stop before any call or before a retry; only
      // provider_error proves that an actual call must have been attempted.
      if (value.status === "failed" && ((value.fail_reason === "not_configured" && call.attempts !== 0) ||
          (value.fail_reason === "provider_error" && call.attempts === 0))) return reference(at(path, "llm"));
    }
    return decoded;
  };
  return (input, path) => {
    const decoded = array(section, { min: 1, max: RESEARCH_OUTLINE_MAX })(input, path);
    if (!decoded.ok) return decoded;
    if (!same(decoded.value.map((item) => item.id), confirmed.outline.map((item) => item.id)) ||
        decoded.value.every((item) => item.status === "skipped")) return reference(path);
    return decoded;
  };
}

function sectionCalls(sections: readonly DraftV2Section[], rerun: DraftV2Rerun | null): SectionCallMeta[] {
  return sections.flatMap((section): SectionCallMeta[] => section.status === "skipped" || (rerun !== null && section.id !== rerun.section_id) ? [] : [{
    ...section.llm, status: section.status, fail_reason: section.status === "failed" ? section.fail_reason : null,
  }]);
}
function derive(sections: readonly DraftV2Section[], confirmed: ConfirmedBriefV2, coverage: DraftV2Coverage, rerun: DraftV2Rerun | null) {
  const okSections = sections.filter((section) => section.status === "ok");
  const failed = sections.filter((section) => section.status === "failed").length;
  const skipped = sections.filter((section) => section.status === "skipped").length;
  const reads = { requested: okSections.length + failed, ok: okSections.length, failed, skipped };
  const verify: DraftV2VerifyItem[] = [];
  const allText: string[] = [];
  for (const section of okSections) for (const paragraph of section.body.paragraphs) for (const sentence of paragraph.sentences) {
    allText.push(sentence.text);
    const kind = sentence.claim === "gap" || sentence.claim === "stance" ? sentence.claim :
      sentence.claim === "bound" && sentence.support_count === 1 ? "single_source" :
        sentence.claim === "bound" && sentence.support_count === 0 ? "profile_only" : null;
    if (kind !== null) verify.push({ sentence: sentence.text, section_id: section.id, kind, support_count: sentence.support_count, evidence_refs: [...sentence.evidence_refs] });
  }
  const mode = reads.ok === 0 ? "unavailable" : failed > 0 || coverage.status === "unavailable" ? "degraded" : skipped > 0 ? "partial" : "complete";
  return { reads, verify, totals: measureResearchLength(allText.join(" "), confirmed.brief.context.input.language), mode, llm: aggregateSectionLlm(sectionCalls(sections, rerun), 0.4) } as const;
}
function availableCoverage(items: readonly CoverageItem[], method: "model" | "empty_draft"): DraftV2Coverage {
  return { status: "available", items, total: items.length, covered: items.filter((item) => item.status === "covered").length, partial: items.filter((item) => item.status === "partial").length, none: items.filter((item) => item.status === "none").length, method };
}
function failedCoverageRead(read: Extract<LlmReadMeta, { status: "unavailable" }>): boolean {
  const noCall = read.attempted === 0 && read.calls === 0;
  const oneCall = read.attempted === 1 && read.calls === 1;
  if (read.reason === "not_configured" ? !noCall : read.reason === "provider_error" || read.reason === "validation_failed" ? !oneCall : read.reason === "timeout" ? !noCall && !oneCall : true) return false;
  return read.calls !== 0 || (read.model_id === null && read.input_tokens === null && read.output_tokens === null);
}
function deriveCoverage(confirmed: ConfirmedBriefV2, sections: readonly DraftV2Section[], rawItems: unknown, read: LlmReadMeta): Decoded<{ coverage: DraftV2Coverage; read: LlmReadMeta }> {
  const questions = confirmed.brief.generated!.research.questions.map((item) => item.id);
  const okIds = new Set(sections.filter((section) => section.status === "ok").map((section) => section.id));
  if (okIds.size === 0) {
    if (!same(read, noCoverage) || (rawItems !== null && !same(rawItems, []))) return reference("coverage");
    const items: CoverageItem[] = [];
    for (const question of questions) {
      const owner = sections.find((section) => section.answers.includes(question));
      if (owner === undefined || owner.status === "ok") return reference("coverage.items");
      items.push({ question_id: question, status: "none", covered_in: null, gap: null, method: "heuristic", cause: owner.status === "failed" ? "section_failed" : "section_skipped" });
    }
    return ok({ coverage: availableCoverage(items, "empty_draft"), read: noCoverage });
  }
  if (read.status === "unavailable") {
    if (!failedCoverageRead(read) || rawItems !== null) return reference("run.reads.llm_coverage");
    return ok({ coverage: { status: "unavailable", reason: read.reason, attempted: read.attempted }, read });
  }
  if (read.calls !== 1 || read.temperature_requested !== 0) return reference("run.reads.llm_coverage");
  const decoded = modelCoverageItems(rawItems, "coverage.items");
  const validated = decoded.ok ? validateCoverageOutput({ items: decoded.value }, questions, okIds) : null;
  if (validated === null || !validated.ok) {
    const failed: LlmReadMeta = { status: "unavailable", reason: "validation_failed", attempted: 1, calls: 1, model_id: read.model_id, input_tokens: read.input_tokens, output_tokens: read.output_tokens };
    return ok({ coverage: { status: "unavailable", reason: "validation_failed", attempted: 1 }, read: failed });
  }
  const order = new Map(questions.map((question, index) => [question, index]));
  const items = [...validated.items].sort((left, right) => order.get(left.question_id)! - order.get(right.question_id)!);
  return ok({ coverage: availableCoverage(items, "model"), read });
}

function confirmedRef(confirmed: ConfirmedBriefV2): DraftResultV2["confirmed_ref"] {
  return { schema: CONFIRMED_BRIEF_V2_SCHEMA, fingerprint: confirmed.fingerprint, revision: confirmed.revision, brief_run_id: confirmed.brief.run.run_id, keyword: confirmed.brief.context.input.primary };
}
function checkRun(run: AssembleDraftV2Input["run"], sections: readonly DraftV2Section[]): boolean {
  return run.budget_ms === (run.rerun === null ? DRAFT_TOTAL_BUDGET_MS : SECTION_ENDPOINT_BUDGET_MS) &&
    (run.rerun === null || (run.rerun.previous_run_id !== run.run_id && sections.some((section) => section.id === run.rerun?.section_id && section.status !== "skipped")));
}

export async function fingerprintDraftV2(result: DraftResultV2): Promise<string> {
  const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = result.run;
  return fingerprintCanonical({ ...result, run });
}

export async function assembleDraftV2(input: AssembleDraftV2Input): Promise<Decoded<DraftResultV2>> {
  if (!isRecord(input)) return invalid("");
  const confirmed = await parseConfirmedBriefV2(input.confirmed);
  if (!confirmed.ok) return confirmed;
  const settings = settingsShape(input.settings, "settings");
  if (!settings.ok) return settings;
  const sections = sectionsShape(confirmed.value, settings.value)(input.sections, "sections");
  if (!sections.ok) return sections;
  const run = object(runInputShape)(input.run, "run");
  if (!run.ok) return run;
  if (!checkRun(run.value, sections.value)) return reference("run");
  const envelope = object({
    confirmed: () => confirmed, settings: () => settings, sections: () => sections, run: () => run,
    coverage: object({ items: (value) => ok(value), reads: readShape }),
  })(input, "");
  if (!envelope.ok) return envelope;
  const coverage = deriveCoverage(confirmed.value, sections.value, envelope.value.coverage.items, envelope.value.coverage.reads);
  if (!coverage.ok) return coverage;
  const derived = derive(sections.value, confirmed.value, coverage.value.coverage, run.value.rerun);
  const unsigned: DraftResultV2 = {
    schema: DRAFT_V2_SCHEMA, confirmed_ref: confirmedRef(confirmed.value), settings: settings.value, sections: sections.value,
    coverage: coverage.value.coverage, verify_before_publish: derived.verify, totals: derived.totals,
    run: { ...run.value, mode: derived.mode, reads: { sections: derived.reads, llm_sections: derived.llm, llm_coverage: coverage.value.read }, fingerprint: "0".repeat(64) },
  };
  const value = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintDraftV2(unsigned) } };
  return parseBoundDraft(value, confirmed.value);
}

async function parseBoundDraft(input: unknown, confirmed: ConfirmedBriefV2): Promise<Decoded<DraftResultV2>> {
  const bytes = byteLength(input);
  if (bytes === null || bytes > DRAFT_V2_MAX_BYTES) return invalid("draft.bytes");
  if (!isRecord(input) || input.schema !== DRAFT_V2_SCHEMA) return { ok: false, code: "brief_schema_mismatch", path: "schema" };
  const settings = settingsShape(input.settings, "settings");
  if (!settings.ok) return settings;
  const shape: Decoder<DraftResultV2> = object({
    schema: literal(DRAFT_V2_SCHEMA), confirmed_ref: object({ schema: literal(CONFIRMED_BRIEF_V2_SCHEMA), fingerprint: hash, revision: count(1_000_000, 1), brief_run_id: modelText(128), keyword: modelText(200) }),
    settings: () => settings, sections: sectionsShape(confirmed, settings.value), coverage: coverageShape,
    verify_before_publish: array(object({ sentence: modelText(SENTENCE_MAX_CHARS), section_id: id("O"), kind: oneOf(["single_source", "profile_only", "gap", "stance"] as const), support_count: count(), evidence_refs: array(id("[UP]"), { max: 100, unique: true }) }), { max: RESEARCH_OUTLINE_MAX * SECTION_MAX_SENTENCES }),
    totals: object({ value: count(), unit: oneOf(["words", "non_whitespace_characters"] as const), tokenizer: oneOf(["whitespace", "unicode_code_points"] as const) }),
    run: object({ ...runInputShape, mode: oneOf(["complete", "partial", "degraded", "unavailable"] as const), fingerprint: hash,
      reads: object({ sections: object({ requested: count(RESEARCH_OUTLINE_MAX), ok: count(RESEARCH_OUTLINE_MAX), failed: count(RESEARCH_OUTLINE_MAX), skipped: count(RESEARCH_OUTLINE_MAX) }), llm_sections: aggregateShape, llm_coverage: readShape }),
    }),
  });
  const decoded = shape(input, "");
  if (!decoded.ok) return decoded;
  const value = decoded.value;
  if (!same(value.confirmed_ref, confirmedRef(confirmed))) return reference("confirmed_ref");
  if (!checkRun(value.run, value.sections)) return reference("run");
  const modelItems = value.coverage.status === "available" && value.coverage.method === "model" ?
    value.coverage.items.map(({ question_id, status, covered_in, gap }) => ({ question_id, status, covered_in, gap })) : null;
  const coverage = deriveCoverage(confirmed, value.sections, modelItems, value.run.reads.llm_coverage);
  if (!coverage.ok) return coverage;
  if (!same(coverage.value.coverage, value.coverage) || !same(coverage.value.read, value.run.reads.llm_coverage)) return reference("coverage");
  const derived = derive(value.sections, confirmed, value.coverage, value.run.rerun);
  for (const [actual, expected, path] of [
    [value.run.reads.sections, derived.reads, "run.reads.sections"], [value.run.reads.llm_sections, derived.llm, "run.reads.llm_sections"],
    [value.verify_before_publish, derived.verify, "verify_before_publish"], [value.totals, derived.totals, "totals"], [value.run.mode, derived.mode, "run.mode"],
  ] as const) if (!same(actual, expected)) return reference(path);
  if (await fingerprintDraftV2(value) !== value.run.fingerprint) return { ok: false, code: "brief_fingerprint_mismatch", path: "run.fingerprint" };
  return decoded;
}

/** A previous result authenticates no sources; it additionally proves exact one-section continuity. */
export async function parseDraftResultV2(input: unknown, confirmedInput: unknown, previousInput?: unknown): Promise<Decoded<DraftResultV2>> {
  const confirmed = await parseConfirmedBriefV2(confirmedInput);
  if (!confirmed.ok) return confirmed;
  const parsed = await parseBoundDraft(input, confirmed.value);
  if (!parsed.ok || previousInput === undefined) return parsed;
  const rerun = parsed.value.run.rerun;
  if (rerun === null) return reference("run.rerun");
  // Parse just this previous delivery, without requiring its entire historical chain.
  const previous = await parseBoundDraft(previousInput, confirmed.value);
  if (!previous.ok) return nested(previous, "previous");
  if (previous.value.run.run_id !== rerun.previous_run_id || previous.value.run.fingerprint !== rerun.previous_fingerprint) return reference("run.rerun");
  if (!same(parsed.value.settings, previous.value.settings)) return reference("settings");
  for (const [index, section] of parsed.value.sections.entries()) {
    if (section.id !== rerun.section_id && !same(section, previous.value.sections[index])) return reference(`sections[${index}]`);
  }
  return parsed;
}
