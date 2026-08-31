// @input  -- an untrusted value that claims to be a DraftResult (export, paste, a result the server just assembled), or the `sections` / `settings` of a section-rerun request, plus the parsed ContentBrief it must bind to and, server-side, the call records the handler trusts
// @output -- a freshly built DraftResult / DraftSection[] / settings (never the input reference), or one closed failure code with the offending path
// @pos    -- the only exact parser of the draft side: shape and caps (parse-brief-shape.ts decoders), every derived field re-derived through draft-assemble.ts and validate-section.ts and compared, the per-section evidence scope, the brief binding, then the recomputed fingerprint
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

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
  SENTENCE_MAX_CHARS,
} from "./constants.ts";
import { CONTENT_BRIEF_SCHEMA, DRAFT_RESULT_SCHEMA } from "./contract.ts";
import type {
  ClaimState,
  Coverage,
  CoverageItem,
  DraftResult,
  DraftRunMeta,
  DraftSection,
  LlmAggregateMeta,
  LlmReadMeta,
  ModelSectionOutput,
  ProfileFact,
  RunMode,
  SectionFailReason,
  UnavailableReason,
  VerifyItem,
} from "./contract.ts";
import {
  aggregateSectionLlm,
  buildCoverage,
  decideCoverage,
  deriveDraftRunMode,
  deriveSectionReads,
  deriveTotals,
  deriveVerifyList,
  planSections,
  sectionEvidenceScope,
} from "./draft-assemble.ts";
import type { SectionCallMeta } from "./draft-assemble.ts";
import { recomputed, sameSet } from "./parse-brief.ts";
import {
  FREE_TEXT_MAX_CHARS,
  array,
  at,
  byteLength,
  finite,
  identifier,
  integer,
  invalid,
  isRecord,
  keysOf,
  literal,
  llmReadMeta,
  modelText,
  nonEmpty,
  nullable,
  object,
  ok,
  oneOf,
  reference,
  tagged,
  text,
  timestamp,
  unavailableShape,
} from "./parse-brief-shape.ts";
import type { Decoded, Decoder, Ok, ParseBriefFailure } from "./parse-brief-shape.ts";
import { validateSectionOutput } from "./validate-section.ts";
import type { SectionEvidence } from "./validate-section.ts";
import { GEO_CONTENT_BRIEF_SCHEMA, GEO_OUTLINE_CAP, isGeoContentBrief, type SharedContentBrief as ContentBrief } from "./geo-contract.ts";
import { carriedGeoSectionEvidence, geoDraftFacts, geoMissingFacts, geoOutlineSupportViolation } from "./geo-draft.ts";
import { geoOriginShape, geoEvidenceShape } from "./parse-geo-brief.ts";
/* ------------------------------------------------------------------ */
/* public surface                                                       */
/* ------------------------------------------------------------------ */

export type ParseDraftFailure = {
  readonly ok: false;
  readonly code: "brief_schema_mismatch" | "invalid_request" | "brief_reference_invalid" | "brief_fingerprint_mismatch";
  readonly path: string;
};

export type ParseDraftResult = Ok<DraftResult> | ParseDraftFailure;
export type ParseDraftSectionsResult = Ok<DraftSection[]> | ParseDraftFailure;
export type ParseDraftSettingsResult = Ok<DraftResult["settings"]> | ParseDraftFailure;

/** What the section endpoint knows first-hand about the one call it made this run. */
export interface RerunProvenance {
  readonly previousRunId: string;
  readonly sectionId: string;
  readonly call: SectionCallMeta;
}

export interface ParseDraftDeps {
  /** Defaults to `draftFingerprint` from canonical.ts; tests inject a stand-in. */
  readonly fingerprint?: (result: DraftResult) => Promise<string>;
  /** Server-side only: pins reran_from, the rewritten section's call record and the whole llm_sections aggregate. */
  readonly rerun?: RerunProvenance;
  /** Server-side only: pins run.reads.llm_coverage to the read the handler actually made. */
  readonly coverageLlm?: LlmReadMeta;
}

type Trusted = Pick<ParseDraftDeps, "rerun" | "coverageLlm">;
type Violation = ParseBriefFailure | null;

/* ------------------------------------------------------------------ */
/* closed enumerations                                                  */
/* ------------------------------------------------------------------ */

const RUN_MODES = keysOf<RunMode>({ complete: null, partial: null, degraded: null, unavailable: null });
const SECTION_FAIL_REASONS = keysOf<SectionFailReason>({ timeout: null, provider_error: null, not_configured: null, validation_failed: null });
const CLAIMS = keysOf<ClaimState>({ bound: null, gap: null, no_claim: null, stance: null });
const VERIFY_KINDS = keysOf<VerifyItem["kind"]>({ single_source: null, profile_only: null, gap: null, stance: null });
const TONES = keysOf<DraftResult["settings"]["tone"]>({ explanatory: null, conversational: null, technical: null });
const PERSONS = keysOf<DraftResult["settings"]["person"]>({ second: null, third: null });
const PRODUCT_MENTIONS = keysOf<DraftResult["settings"]["product_mention"]>({ none: null, gap_only: null, throughout: null });
const AVAILABLE_STATUSES = ["complete", "partial"] as const;

/** Reasons a coverage call that had questions to ask can never report. */
const NOT_A_COVERAGE_FAILURE: ReadonlySet<UnavailableReason> = new Set<UnavailableReason>([
  "not_requested",
  "quota_exhausted",
  "unsupported_language",
  "insufficient_evidence",
]);

/* ------------------------------------------------------------------ */
/* reads                                                                */
/* ------------------------------------------------------------------ */

const tokens = { input_tokens: nullable(integer()), output_tokens: nullable(integer()) };

/** One entry per failed section (aggregateSectionLlm), so never more than the outline cap. */
const failedReasons = array(oneOf(SECTION_FAIL_REASONS), { max: GEO_OUTLINE_CAP });
const aggregateAvailable = object({
  status: oneOf(AVAILABLE_STATUSES),
  calls: integer(),
  model_id: text(FREE_TEXT_MAX_CHARS, 1),
  temperature_requested: finite(),
  temperature_effective: nullable(finite()),
  ...tokens,
  failed_reasons: failedReasons,
});
const llmAggregateMeta: Decoder<LlmAggregateMeta> = tagged("status", {
  complete: aggregateAvailable,
  partial: aggregateAvailable,
  unavailable: object({ ...unavailableShape, calls: integer(), model_id: nullable(text()), ...tokens, failed_reasons: failedReasons }),
});

/* ------------------------------------------------------------------ */
/* sections                                                             */
/* ------------------------------------------------------------------ */

const evidenceRef = identifier("[KCP]");

const seoSentence = object({
  text: modelText(SENTENCE_MAX_CHARS),
  claim: oneOf(CLAIMS),
  evidence_refs: array(evidenceRef, { unique: true }),
  support_count: integer(),
});
const sentence: Decoder<import("./contract.ts").Sentence> = (value, path) => {
  if (!isRecord(value) || !("sources" in value)) return seoSentence(value, path);
  return object({ text: modelText(SENTENCE_MAX_CHARS), claim: oneOf(CLAIMS), evidence_refs: array(evidenceRef, { unique: true }), support_count: integer(), sources: nonEmpty(oneOf(["kb", "crawl", "product_profile", "model"] as const), { max: 4, unique: true }) })(value, path);
};

const sectionBase = {
  id: identifier("O"),
  h2: modelText(MODEL_TEXT_MAX_CHARS),
  answers: array(identifier("Q"), { max: MUST_ANSWER_CAP, unique: true }),
};

/** The toolkit's integer(min), capped at the retry limit. */
function attempts(min: number): Decoder<number> {
  const inner = integer(min);
  return (input, path) => {
    const decoded = inner(input, path);
    return decoded.ok && decoded.value > SECTION_MAX_ATTEMPTS ? invalid(path) : decoded;
  };
}

/** An ok section made at least one call; a failed one may have made none (not_configured). */
function sectionLlm(minAttempts: number) {
  return object({ attempts: attempts(minAttempts), ...tokens });
}

// validate-section.ts drops empty paragraphs, so a rebuilt body never carries
// one; the per-section sentence total is capped below, after decoding.
const draftSectionShape: Decoder<DraftSection> = tagged("status", {
  ok: object({
    ...sectionBase,
    status: literal("ok"),
    body: object({
      word_count: integer(),
      paragraphs: array(object({ sentences: nonEmpty(sentence) }), { max: SECTION_MAX_SENTENCES }),
    }),
    llm: sectionLlm(1),
  }),
  failed: object({ ...sectionBase, status: literal("failed"), fail_reason: oneOf(SECTION_FAIL_REASONS), llm: sectionLlm(0) }),
  skipped: object({ ...sectionBase, status: literal("skipped") }),
});

function sentenceCount(section: DraftSection): number {
  if (section.status !== "ok") return 0;
  return section.body.paragraphs.reduce((sum, paragraph) => sum + paragraph.sentences.length, 0);
}

/**
 * A failed section's attempts follow from why it failed: nothing was sent
 * when the model is not configured, at least one call came back to be
 * rejected or to error, and a call that never went out has no usage.
 */
function checkSectionLlm(section: DraftSection, path: string): Violation {
  if (section.status === "skipped") return null;
  const { attempts: made, input_tokens, output_tokens } = section.llm;
  if (section.status === "failed") {
    const reason = section.fail_reason;
    if (reason === "not_configured" && made !== 0) return reference(at(path, "llm.attempts"));
    if ((reason === "validation_failed" || reason === "provider_error") && made === 0) return reference(at(path, "llm.attempts"));
  }
  if (made === 0 && input_tokens !== null) return reference(at(path, "llm.input_tokens"));
  if (made === 0 && output_tokens !== null) return reference(at(path, "llm.output_tokens"));
  return null;
}

/** handoff §6: each section's JSON <= SECTION_BODY_MAX_BYTES and its sentences <= SECTION_MAX_SENTENCES. */
const draftSection: Decoder<DraftSection> = (input, path) => {
  const decoded = draftSectionShape(input, path);
  if (!decoded.ok) return decoded;
  const bytes = byteLength(decoded.value);
  if (bytes === null || bytes > SECTION_BODY_MAX_BYTES) return invalid(path);
  if (sentenceCount(decoded.value) > SECTION_MAX_SENTENCES) return invalid(at(path, "body.paragraphs"));
  return checkSectionLlm(decoded.value, path) ?? decoded;
};

const sections = array(draftSection, { max: GEO_OUTLINE_CAP });

/* ------------------------------------------------------------------ */
/* coverage, verify list, settings, run                                 */
/* ------------------------------------------------------------------ */

// Key order follows validateCoverageOutput / decideCoverage so a parsed copy
// re-exports byte-for-byte like the producer's JSON.
const coverageItem: Decoder<CoverageItem> = tagged("status", {
  covered: object({
    question_id: identifier("Q"),
    status: literal("covered"),
    covered_in: identifier("O"),
    gap: literal(null),
    method: literal("model"),
    cause: literal(null),
  }),
  partial: object({
    question_id: identifier("Q"),
    status: literal("partial"),
    covered_in: identifier("O"),
    gap: modelText(MODEL_TEXT_MAX_CHARS),
    method: literal("model"),
    cause: literal("content"),
  }),
  none: tagged("method", {
    model: object({
      question_id: identifier("Q"),
      status: literal("none"),
      covered_in: literal(null),
      gap: modelText(MODEL_TEXT_MAX_CHARS),
      method: literal("model"),
      cause: literal("content"),
    }),
    heuristic: object({
      question_id: identifier("Q"),
      status: literal("none"),
      covered_in: literal(null),
      gap: literal(null),
      method: literal("heuristic"),
      cause: oneOf(["section_failed", "section_skipped"]),
    }),
  }),
});

const emptyDerivedFrom: Decoder<[]> = (input, path) =>
  Array.isArray(input) && input.length === 0 ? ok<[]>([]) : invalid(path);

const coverage: Decoder<Coverage> = tagged("status", {
  available: object({
    status: literal("available"),
    items: array(coverageItem, { max: MUST_ANSWER_CAP }),
    total: integer(),
    covered: integer(),
    partial: integer(),
    none: integer(),
    provenance: object({ method: literal("model"), derived_from: emptyDerivedFrom }),
  }),
  unavailable: object(unavailableShape),
});

const verifyItem: Decoder<VerifyItem> = object({
  sentence: modelText(SENTENCE_MAX_CHARS),
  section_id: identifier("O"),
  kind: oneOf(VERIFY_KINDS),
  support_count: integer(),
  evidence_refs: array(evidenceRef, { unique: true }),
});

const settings: Decoder<DraftResult["settings"]> = object({
  tone: oneOf(TONES),
  person: oneOf(PERSONS),
  product_mention: oneOf(PRODUCT_MENTIONS),
});

/** Exactly the two budgets the contract names; which one applies is pinned to reran_from below. */
const budgetMs: Decoder<number> = (input, path) =>
  input === DRAFT_TOTAL_BUDGET_MS || input === SECTION_ENDPOINT_BUDGET_MS ? ok(input) : invalid(path);

const draftRunMeta: Decoder<DraftRunMeta> = object({
  run_id: text(FREE_TEXT_MAX_CHARS, 1),
  reran_from: nullable(text(FREE_TEXT_MAX_CHARS, 1)),
  collected_at: timestamp,
  elapsed_ms: integer(),
  budget_ms: budgetMs,
  mode: oneOf(RUN_MODES),
  reads: object({
    sections: object({ requested: integer(), ok: integer(), failed: integer(), skipped: integer() }),
    llm_sections: llmAggregateMeta,
    llm_coverage: llmReadMeta,
  }),
  // Empty is a shape-valid placeholder (assembleDraftResult self-checks before
  // stamping); parseDraftResult still rejects it because sha256 hex never equals "".
  fingerprint: text(),
});

const draftResult: Decoder<DraftResult> = object({
  schema: literal(DRAFT_RESULT_SCHEMA),
  run: draftRunMeta,
  brief_ref: tagged("schema", { [CONTENT_BRIEF_SCHEMA]: object({
    schema: literal(CONTENT_BRIEF_SCHEMA),
    run_id: text(FREE_TEXT_MAX_CHARS, 1),
    fingerprint: text(FREE_TEXT_MAX_CHARS, 1),
    keyword: text(FREE_TEXT_MAX_CHARS, 1),
  }), [GEO_CONTENT_BRIEF_SCHEMA]: object({ schema: literal(GEO_CONTENT_BRIEF_SCHEMA), run_id: text(FREE_TEXT_MAX_CHARS, 1), fingerprint: text(FREE_TEXT_MAX_CHARS, 1), keyword: text(FREE_TEXT_MAX_CHARS, 1), geo_origin: geoOriginShape, evidence: geoEvidenceShape }) }),
  settings,
  sections,
  coverage,
  verify_before_publish: array(verifyItem, { max: GEO_OUTLINE_CAP * SECTION_MAX_SENTENCES }),
  totals: object({ word_count: integer() }),
});

/** Record check, byte cap, schema literal, then the exact shape. No cross-field invariants. */
function decodeDraftShape(input: unknown, path: string): Decoded<DraftResult> {
  if (!isRecord(input)) return invalid(path);
  const bytes = byteLength(input);
  if (bytes === null || bytes > DRAFT_RESULT_MAX_BYTES) return invalid(path);
  if (input["schema"] !== DRAFT_RESULT_SCHEMA) {
    return { ok: false, code: "brief_schema_mismatch", path: at(path, "schema") };
  }
  return draftResult(input, path);
}

/* ------------------------------------------------------------------ */
/* recompute-and-compare                                                */
/*                                                                      */
/* A draft whose numbers merely agree with each other is not enough:    */
/* every derived field is rebuilt from the sections with the same       */
/* draft-assemble.ts function the producer used and compared key by key */
/* (parse-brief.ts's `recomputed`).                                     */
/* ------------------------------------------------------------------ */

type OkSection = Extract<DraftSection, { status: "ok" }>;
type FailedSection = Extract<DraftSection, { status: "failed" }>;

/* ------------------------------------------------------------------ */
/* section bodies: validate-section.ts is the one implementation of     */
/* the claim rules; the body is turned back into the model's output    */
/* and everything the validator derives is compared exactly against    */
/* the evidence that section was actually given                        */
/* ------------------------------------------------------------------ */

interface Ledger {
  readonly brief: ContentBrief;
  readonly settings: DraftResult["settings"];
}

/**
 * The evidence one section may cite: what the handler put in its prompt
 * (sectionEvidenceScope), as validate-section.ts consumes it. A page from
 * another section's cluster or a fact outside product_mention is unknown
 * here even though the brief carries it.
 */
export function sectionEvidenceFor(brief: ContentBrief, sectionId: string, settings: DraftResult["settings"]): SectionEvidence {
  if (isGeoContentBrief(brief)) return { citableCrawlIds: new Set<string>(), profileFacts: new Map(), stanceAllowed: false, geoFacts: new Map(geoDraftFacts(brief, sectionId, settings).map(fact => [fact.id, fact])), geoMissingFacts: geoMissingFacts(brief) };
  const scope = sectionEvidenceScope(brief, sectionId, settings);
  const facts = (brief.evidence.profile?.facts ?? []).filter((fact) => scope.profileFactIds.has(fact.id));
  return {
    citableCrawlIds: scope.citableCrawlIds,
    profileFacts: new Map(facts.map((fact) => [fact.id, fact] as const)),
    stanceAllowed: scope.stanceAllowed,
  };
}

/** Shape-only checks do not authenticate carried receipts; exact ledger checking requires the brief. */
function permissiveEvidenceOf(section: OkSection): SectionEvidence {
  const refs = section.body.paragraphs.flatMap((paragraph) => paragraph.sentences.flatMap((item) => item.evidence_refs));
  const geo = carriedGeoSectionEvidence(section);
  if (geo !== null) return geo;
  const facts = refs
    .filter((ref) => ref.startsWith("P"))
    .map((id): ProfileFact => ({ id, field: "", text: "", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } }));
  return {
    citableCrawlIds: new Set(refs.filter((ref) => ref.startsWith("C"))),
    profileFacts: new Map(facts.map((fact) => [fact.id, fact] as const)),
    stanceAllowed: true,
  };
}

function modelOutputOf(section: OkSection): ModelSectionOutput {
  return {
    paragraphs: section.body.paragraphs.map((paragraph) => ({
      sentences: paragraph.sentences.map(({ text: value, claim, evidence_refs }) => ({ text: value, claim, evidence_refs: [...evidence_refs] })),
    })),
  };
}

function checkSectionBody(section: OkSection, evidence: SectionEvidence, path: string): Violation {
  const validated = validateSectionOutput(modelOutputOf(section), evidence);
  if (!validated.ok) return reference(at(path, `body.${validated.path}`));
  return recomputed({ word_count: validated.word_count, paragraphs: validated.paragraphs }, section.body, at(path, "body"));
}

function checkSections(list: readonly DraftSection[], ledger: Ledger | null, path: string): Violation {
  const seen = new Set<string>();
  for (const [index, section] of list.entries()) {
    const sectionPath = at(path, index);
    if (seen.has(section.id)) return reference(at(sectionPath, "id"));
    seen.add(section.id);
    if (section.status !== "ok") continue;
    const evidence = ledger === null ? permissiveEvidenceOf(section) : sectionEvidenceFor(ledger.brief, section.id, ledger.settings);
    const violation = checkSectionBody(section, evidence, sectionPath);
    if (violation !== null) return violation;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* binding to the brief                                                 */
/* ------------------------------------------------------------------ */

function checkBriefRef(result: DraftResult, brief: ContentBrief): Violation {
  const expected: DraftResult["brief_ref"] = {
    schema: brief.schema,
    run_id: brief.run.run_id,
    fingerprint: brief.run.fingerprint,
    keyword: brief.keyword.primary,
    ...(isGeoContentBrief(brief) ? { geo_origin: brief.geo_origin, evidence: brief.evidence } : {}),
  };
  return recomputed(expected, result.brief_ref, "brief_ref");
}

/** Every writable outline section, in outline order, with the outline's own h2 and answers. */
function checkPlan(list: readonly DraftSection[], brief: ContentBrief, path: string): Violation {
  const headingFailure = isGeoContentBrief(brief) ? geoOutlineSupportViolation(brief) : null;
  if (headingFailure !== null) return reference(`brief.${headingFailure}`);
  const plan = planSections(brief, brief.draft_readiness.writable);
  if ("ok" in plan || list.length !== plan.requested.length) return reference(path);
  for (const [index, expected] of plan.requested.entries()) {
    const section = list[index];
    const sectionPath = at(path, index);
    if (section === undefined || section.id !== expected.id) return reference(at(sectionPath, "id"));
    if (section.h2 !== expected.h2) return reference(at(sectionPath, "h2"));
    const answers = recomputed([...expected.answers], [...section.answers], at(sectionPath, "answers"));
    if (answers !== null) return answers;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* run metadata                                                         */
/* ------------------------------------------------------------------ */

const LLM_SECTIONS = "run.reads.llm_sections";

/** A rerun runs under the section endpoint's budget and points at a different run. */
function checkRun(run: DraftRunMeta): Violation {
  const rerun = run.reran_from !== null;
  if (rerun && run.reran_from === run.run_id) return reference("run.reran_from");
  const budget = rerun ? SECTION_ENDPOINT_BUDGET_MS : DRAFT_TOTAL_BUDGET_MS;
  return run.budget_ms === budget ? null : reference("run.budget_ms");
}

function checkDerived(result: DraftResult): Violation {
  const reads = deriveSectionReads(result.sections);
  return (
    recomputed(reads, result.run.reads.sections, "run.reads.sections") ??
    // The draft endpoint refuses an empty section_ids and a rerun always writes one section.
    (reads.requested === 0 ? reference("run.reads.sections.requested") : null) ??
    recomputed(deriveVerifyList(result.sections), result.verify_before_publish, "verify_before_publish") ??
    recomputed(deriveTotals(result.sections), result.totals, "totals") ??
    (deriveDraftRunMode({ sections: reads, coverage: result.coverage }) === result.run.mode ? null : reference("run.mode"))
  );
}

function callOf(section: DraftSection): SectionCallMeta | null {
  if (section.status === "skipped") return null;
  return {
    status: section.status,
    attempts: section.llm.attempts,
    fail_reason: section.status === "failed" ? section.fail_reason : null,
    model_id: null,
    temperature_requested: 0,
    temperature_effective: null,
    input_tokens: section.llm.input_tokens,
    output_tokens: section.llm.output_tokens,
  };
}

/** The part of an aggregate the sections' own call records determine (model id and temperatures are the provider's). */
function aggregateSubset(meta: LlmAggregateMeta): Record<string, unknown> {
  const shared = {
    status: meta.status,
    calls: meta.calls,
    input_tokens: meta.input_tokens,
    output_tokens: meta.output_tokens,
    failed_reasons: meta.failed_reasons,
  };
  return meta.status === "unavailable" ? { ...shared, reason: meta.reason, attempted: meta.attempted } : shared;
}

/** First run: every non-skipped section was called this run, so the aggregate is re-derived from their records. */
function checkFirstRunLlm(list: readonly DraftSection[], actual: LlmAggregateMeta): Violation {
  const calls = list.flatMap((section) => {
    const call = callOf(section);
    return call === null ? [] : [call];
  });
  const temperature = actual.status === "unavailable" ? 0 : actual.temperature_requested;
  return recomputed(aggregateSubset(aggregateSectionLlm(calls, temperature)), aggregateSubset(actual), LLM_SECTIONS);
}

/**
 * Rerun seen from a client (handoff §5.2): the aggregate reflects only the
 * one section this run wrote, whose identity the result does not record.
 * What still holds: one call is never partial, and its outcome must match a
 * section carrying the same attempts and, when it failed, the same reason.
 */
function checkRerunLlm(list: readonly DraftSection[], actual: LlmAggregateMeta): Violation {
  if (actual.status !== "unavailable") {
    if (actual.status === "partial") return reference(`${LLM_SECTIONS}.status`);
    if (actual.failed_reasons.length !== 0) return reference(`${LLM_SECTIONS}.failed_reasons`);
    const matched = list.some((section) => section.status === "ok" && section.llm.attempts === actual.calls);
    return matched ? null : reference(`${LLM_SECTIONS}.calls`);
  }
  if (actual.attempted !== 1) return reference(`${LLM_SECTIONS}.attempted`);
  if (actual.failed_reasons.length !== 1 || actual.failed_reasons[0] !== actual.reason) {
    return reference(`${LLM_SECTIONS}.failed_reasons`);
  }
  const failed = list.filter(
    (section): section is FailedSection => section.status === "failed" && section.fail_reason === actual.reason,
  );
  if (failed.length === 0) return reference(`${LLM_SECTIONS}.reason`);
  return failed.some((section) => section.llm.attempts === actual.calls) ? null : reference(`${LLM_SECTIONS}.calls`);
}

/** What a section must look like after the call the handler recorded for it. */
function sectionFromCall(call: SectionCallMeta): Record<string, unknown> {
  const llm = { attempts: call.attempts, input_tokens: call.input_tokens, output_tokens: call.output_tokens };
  return call.status === "ok" ? { status: "ok", llm } : { status: "failed", fail_reason: call.fail_reason ?? "provider_error", llm };
}

function sectionCallView(section: DraftSection): Record<string, unknown> {
  if (section.status === "skipped") return { status: "skipped" };
  return section.status === "ok"
    ? { status: "ok", llm: section.llm }
    : { status: "failed", fail_reason: section.fail_reason, llm: section.llm };
}

/**
 * Rerun seen from the server: the handler knows which section it rewrote and
 * what the call cost, so the section and the whole aggregate are exact.
 */
function checkTrustedRerun(result: DraftResult, rerun: RerunProvenance): Violation {
  if (result.run.reran_from !== rerun.previousRunId) return reference("run.reran_from");
  const index = result.sections.findIndex((section) => section.id === rerun.sectionId);
  const section = result.sections[index];
  if (section === undefined) return reference("sections");
  return (
    recomputed(sectionFromCall(rerun.call), sectionCallView(section), `sections[${index}]`) ??
    recomputed(aggregateSectionLlm([rerun.call], rerun.call.temperature_requested), result.run.reads.llm_sections, LLM_SECTIONS)
  );
}

function checkLlmSections(result: DraftResult, trusted: Trusted): Violation {
  if (trusted.rerun !== undefined) return checkTrustedRerun(result, trusted.rerun);
  const actual = result.run.reads.llm_sections;
  return result.run.reran_from === null ? checkFirstRunLlm(result.sections, actual) : checkRerunLlm(result.sections, actual);
}

/* ------------------------------------------------------------------ */
/* coverage                                                             */
/* ------------------------------------------------------------------ */

const LLM_COVERAGE = "run.reads.llm_coverage";

function ownerMap(list: readonly DraftSection[]): Map<string, DraftSection[]> {
  const owner = new Map<string, DraftSection[]>();
  for (const section of list) {
    for (const question of section.answers) owner.set(question, [...(owner.get(question) ?? []), section]);
  }
  return owner;
}

function checkCoverageItem(item: CoverageItem, owners: readonly DraftSection[] | undefined, okIds: ReadonlySet<string>, path: string): Violation {
  const owner = owners?.find(section => section.status === "ok") ?? owners?.find(section => section.status === "failed") ?? owners?.[0];
  if (item.method === "heuristic") {
    if (owner === undefined || owner.status === "ok") return reference(at(path, "method"));
    const cause = owner.status === "failed" ? "section_failed" : "section_skipped";
    return item.cause === cause ? null : reference(at(path, "cause"));
  }
  if (owner !== undefined && owner.status !== "ok") return reference(at(path, "method"));
  if (item.covered_in !== null && !okIds.has(item.covered_in)) return reference(at(path, "covered_in"));
  return null;
}

/** A model verdict exists only because one coverage call, at temperature 0, came back. */
function checkCoverageCall(llm: LlmReadMeta): Violation {
  if (llm.status !== "complete") return reference(`${LLM_COVERAGE}.status`);
  if (llm.calls !== 1) return reference(`${LLM_COVERAGE}.calls`);
  return llm.temperature_requested === 0 ? null : reference(`${LLM_COVERAGE}.temperature_requested`);
}

/** What the sections alone decide: who owns each question, which sections can be named, the call, and the four counts. */
function checkCoverageLocal(result: DraftResult): Violation {
  const { coverage: field } = result;
  if (field.status === "unavailable") return null;
  const owner = ownerMap(result.sections);
  const okIds = new Set(result.sections.filter((section) => section.status === "ok").map((section) => section.id));
  const seen = new Set<string>();
  for (const [index, item] of field.items.entries()) {
    const path = `coverage.items[${index}]`;
    if (seen.has(item.question_id)) return reference(at(path, "question_id"));
    seen.add(item.question_id);
    const violation = checkCoverageItem(item, owner.get(item.question_id), okIds, path);
    if (violation !== null) return violation;
  }
  if (field.items.some((item) => item.method === "model")) {
    const call = checkCoverageCall(result.run.reads.llm_coverage);
    if (call !== null) return call;
  }
  const counts = {
    total: field.items.length,
    covered: field.items.filter((item) => item.status === "covered").length,
    partial: field.items.filter((item) => item.status === "partial").length,
    none: field.items.filter((item) => item.status === "none").length,
  };
  return recomputed(counts, { total: field.total, covered: field.covered, partial: field.partial, none: field.none }, "coverage");
}

/** The read a coverage step that had nothing to ask leaves behind: no call, no usage, no deployment. */
const COVERAGE_NOT_ASKED: LlmReadMeta = {
  status: "unavailable",
  reason: "insufficient_evidence",
  attempted: 0,
  calls: 0,
  model_id: null,
  input_tokens: null,
  output_tokens: null,
};

/**
 * A failed coverage read with questions to ask. The coverage step makes at
 * most one call and never retries: a missing configuration sends nothing;
 * a provider error or a rejected answer means the one call went out; a
 * timeout either sent it or ran out of budget before it. A read that never
 * called has no deployment and no usage to report.
 */
function checkFailedCoverageRead(llm: Extract<LlmReadMeta, { status: "unavailable" }>): Violation {
  const noCall = llm.attempted === 0 && llm.calls === 0;
  const oneCall = llm.attempted === 1 && llm.calls === 1;
  if (llm.reason === "not_configured") {
    if (llm.attempted !== 0) return reference(`${LLM_COVERAGE}.attempted`);
    if (llm.calls !== 0) return reference(`${LLM_COVERAGE}.calls`);
  } else if (llm.reason === "provider_error" || llm.reason === "validation_failed") {
    if (llm.attempted !== 1) return reference(`${LLM_COVERAGE}.attempted`);
    if (llm.calls !== 1) return reference(`${LLM_COVERAGE}.calls`);
  } else if (!noCall && !oneCall) {
    return reference(`${LLM_COVERAGE}.calls`);
  }
  if (llm.calls === 0) {
    if (llm.model_id !== null) return reference(`${LLM_COVERAGE}.model_id`);
    if (llm.input_tokens !== null) return reference(`${LLM_COVERAGE}.input_tokens`);
    if (llm.output_tokens !== null) return reference(`${LLM_COVERAGE}.output_tokens`);
  }
  return null;
}

/**
 * The coverage ledger against what there was to ask: with nothing askable
 * the call never went out; with questions to ask, a missing verdict can only
 * be the call's own failure, never a reason that says it was not needed,
 * and the read must describe that failure consistently.
 */
function checkCoverageLedger(result: DraftResult, askable: readonly string[]): Violation {
  const llm = result.run.reads.llm_coverage;
  if (askable.length === 0) return recomputed(COVERAGE_NOT_ASKED, llm, LLM_COVERAGE);
  const { coverage: field } = result;
  if (field.status === "available") return null;
  if (NOT_A_COVERAGE_FAILURE.has(field.reason)) return reference("coverage.reason");
  // buildCoverage has already tied coverage.reason / attempted to this read.
  return llm.status === "complete" ? checkCoverageCall(llm) : checkFailedCoverageRead(llm);
}

/** With the brief the whole field is rebuilt: heuristic set, askable set, must_answer order, total, the unavailable gate, then the ledger. */
function checkCoverageBound(result: DraftResult, brief: ContentBrief): Violation {
  const decided = decideCoverage(brief, result.sections);
  const llm = result.run.reads.llm_coverage;
  const { coverage: field } = result;
  const rebuilt =
    field.status === "unavailable"
      ? recomputed(buildCoverage(brief, decided.heuristic, null, llm), field, "coverage")
      : (() => {
          const modelItems = field.items.filter((item) => item.method === "model");
          if (!sameSet(modelItems.map((item) => item.question_id), decided.askable)) return reference("coverage.items");
          return recomputed(buildCoverage(brief, decided.heuristic, modelItems, llm), field, "coverage");
        })();
  return rebuilt ?? checkCoverageLedger(result, decided.askable);
}

/* ------------------------------------------------------------------ */
/* entry points                                                         */
/* ------------------------------------------------------------------ */

function firstViolation(result: DraftResult, brief: ContentBrief | null, trusted: Trusted): Violation {
  const geo = result.brief_ref.schema === GEO_CONTENT_BRIEF_SCHEMA;
  if (!geo && result.sections.length > OUTLINE_CAP) return invalid("sections");
  if (!geo) { const empty = result.sections.findIndex(section => section.answers.length === 0); if (empty >= 0) return invalid(`sections[${empty}].answers`); }
  for (const section of result.sections) if (section.status === "ok") {
    if (section.body.paragraphs.some(paragraph => paragraph.sentences.some(sentence => (sentence.sources !== undefined) !== geo))) return reference("sections.body.sources");
  }
  const ledger: Ledger | null = brief === null ? null : { brief, settings: result.settings };
  return (
    // A draft written against another brief, or a section outside its outline, is refused
    // before any sentence is judged against a scope it was never given.
    (brief === null ? null : (checkBriefRef(result, brief) ?? checkPlan(result.sections, brief, "sections"))) ??
    checkSections(result.sections, ledger, "sections") ??
    checkRun(result.run) ??
    checkDerived(result) ??
    checkLlmSections(result, trusted) ??
    (trusted.coverageLlm === undefined ? null : recomputed(trusted.coverageLlm, result.run.reads.llm_coverage, LLM_COVERAGE)) ??
    checkCoverageLocal(result) ??
    (brief === null ? null : checkCoverageBound(result, brief))
  );
}

function decodeDraft(input: unknown, brief: ContentBrief | null, trusted: Trusted): ParseDraftResult {
  const shaped = decodeDraftShape(input, "");
  if (!shaped.ok) return shaped;
  return firstViolation(shaped.value, brief, trusted) ?? shaped;
}

/**
 * Shape, caps and every invariant the result alone can prove, without the
 * brief and without recomputing the fingerprint. For a server checking the
 * result it has just assembled; every client entrance uses `parseDraftResult`.
 */
export function parseDraftResultShape(input: unknown): ParseDraftResult {
  return decodeDraft(input, null, {});
}

/**
 * The exact parser: shape, invariants, the binding to `brief` (each section
 * judged against the evidence it was given), what the server knows
 * first-hand (`deps.rerun`, `deps.coverageLlm`), then the recomputed fingerprint.
 */
export async function parseDraftResult(input: unknown, brief: ContentBrief, deps: ParseDraftDeps = {}): Promise<ParseDraftResult> {
  const decoded = decodeDraft(input, brief, deps);
  if (!decoded.ok) return decoded;
  const expected = await (deps.fingerprint ?? draftFingerprint)(decoded.value);
  return expected === decoded.value.run.fingerprint
    ? decoded
    : { ok: false, code: "brief_fingerprint_mismatch", path: "run.fingerprint" };
}

/** The `sections` of a section-rerun request: shape and caps, then bound to `brief` under `settings` like a result's sections. */
export function parseDraftSections(input: unknown, brief: ContentBrief, settings: DraftResult["settings"]): ParseDraftSectionsResult {
  if (!isGeoContentBrief(brief) && Array.isArray(input) && input.length > OUTLINE_CAP) return invalid("sections");
  const decoded = sections(input, "sections");
  if (!decoded.ok) return decoded;
  return checkPlan(decoded.value, brief, "sections") ?? checkSections(decoded.value, { brief, settings }, "sections") ?? decoded;
}

/** The `settings` of a draft or section-rerun request: three closed enumerations, exact key set. */
export function parseDraftSettings(input: unknown): ParseDraftSettingsResult {
  return settings(input, "settings");
}
