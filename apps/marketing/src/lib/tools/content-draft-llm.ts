// @input  -- CONTENT_DRAFT_* env, one DraftSectionInput or DraftCoverageInput, an injectable KeywordLlmClient
// @output -- one section's validated sentences (support_count server-derived) or a closed fail_reason; a shape-checked ModelCoverageOutput or null, each with its LlmReadMeta
// @pos    -- the Content Draft Writer's only model calls; prompt text in content-draft-prompts.ts, claim rules in validate-section.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Two calls, one shape parse each, one retry for the section, none for the
 * coverage check.
 *
 * SECTION. One call per requested H2, run by the handler concurrently. The
 * reply is parsed into the `ModelSectionOutput` shape here and then handed to
 * `validateSectionOutput`, which is the only place a claim is judged. A reply
 * that fails either step is rejected whole and asked for again once
 * (`SECTION_MAX_ATTEMPTS`); a second rejection is `validation_failed`. Nothing
 * here rewrites a claim, drops a sentence or downgrades a `bound` to a `gap`:
 * a corrected claim presented as the model's own would be a lie the page
 * cannot detect (Owner ruling 6). Transport failures and deadlines are not
 * retried — a second 20-second timeout would only spend the run's budget.
 *
 * COVERAGE. One call in a fresh context that has never seen the generation
 * prompts: only the ok sections' text and the question list. The reply is
 * shape-parsed here into `ModelCoverageOutput` and handed back; which ids are
 * legal and which status / covered_in / gap combinations are allowed is
 * `validateCoverageOutput`'s, which the handler calls with the askable set
 * and the ok section ids it owns. Any failure on this side leaves `items`
 * null so the handler renders coverage as unavailable rather than
 * defaulting to "all covered" (handoff §5.4).
 *
 * Every failure is a value, never a throw, except a non-`KeywordLlmError`
 * from the client, which is our own bug and is rethrown as in the brief, and
 * a language code outside `LANGUAGE_NAMES`, which is a caller bug the
 * handler's request validation is meant to stop earlier (`RangeError`).
 *
 * CALL LEDGER. `calls` / `attempts` count requests that left this process.
 * A request the provider never answered — timeout, 429, 5xx, network — is
 * still a call: the deadline was spent and the provider may well have
 * billed it. Only "never sent" (nothing to ask, not configured, budget gone
 * before the first attempt) is zero. Section tokens are summed over the
 * attempts that were sent, and the sum is unknown (null) as soon as any one
 * of them reported no usage: "100 + unknown" is not 100, and a retry that
 * timed out must not make the section look cheaper than the first attempt
 * alone (the shared `mergeKeywordLlmUsage` absorbs null and is not used here).
 * Configuration comes only from the `CONTENT_DRAFT_*` set resolved in
 * `content-brief-llm.ts`; there is no fallback to another tool's key.
 */

import {
  COVERAGE_MAX_OUTPUT_TOKENS,
  COVERAGE_TIMEOUT_MS,
  ENVELOPE_MS,
  MODEL_TEXT_MAX_CHARS,
  SECTION_MAX_ATTEMPTS,
  SECTION_MAX_OUTPUT_TOKENS,
  SECTION_TIMEOUT_MS,
} from "@sf/public-tools/content-brief/constants";
import type {
  ClaimState,
  DraftResult,
  LlmReadMeta,
  ModelCoverageOutput,
  ModelSectionOutput,
  ModelSentence,
  ProfileFact,
  SectionFailReason,
  Sentence,
  UnavailableReason,
} from "@sf/public-tools/content-brief/contract";
import { boundedModelText } from "@sf/public-tools/content-brief/text";
import {
  validateSectionOutput,
  type SectionEvidence,
  type SectionRule,
} from "@sf/public-tools/content-brief/validate-section";

import { resolveContentDraftLlmConfig } from "./content-brief-llm.ts";
import {
  buildDraftCoverageSystemPrompt,
  buildDraftCoverageUserPrompt,
  buildDraftSectionSystemPrompt,
  buildDraftSectionUserPrompt,
  CLAIM_STATES,
  COVERAGE_STATUSES,
  languageName,
  MODEL_COVERAGE_OUTPUT_KEYS,
  MODEL_SECTION_OUTPUT_KEYS,
} from "./content-draft-prompts.ts";
import {
  createKeywordLlmClient,
  EMPTY_KEYWORD_LLM_USAGE,
  KeywordLlmError,
  type KeywordLlmClient,
  type KeywordLlmCompletion,
  type KeywordLlmConfig,
  type KeywordLlmFailureReason,
  type KeywordLlmRequest,
  type KeywordLlmUsage,
} from "./keyword-llm-client.ts";

/* ------------------------------------------------------------------ */
/* Input / output shapes                                               */
/* ------------------------------------------------------------------ */

type Env = Readonly<Record<string, string | undefined>>;

/** One heading that formed a question, tagged with the page it came from. */
export interface DraftQuestionMember {
  readonly observation_id: string;
  readonly heading: string;
}

/** One must-answer question this section has to satisfy. */
export interface DraftSectionQuestion {
  /** Server-assigned `Q1`…; rendered so the model knows what the section owes. */
  readonly id: string;
  readonly q: string;
  readonly members: readonly DraftQuestionMember[];
}

export interface DraftPageExcerpt {
  readonly heading: string;
  readonly text: string;
}

/**
 * One competitor page the questions' members point at.
 *
 * Only a page that carries at least one excerpt can be cited by a `bound`
 * sentence; a page listed without excerpts is rendered as uncitable and
 * `validateSectionOutput` refuses a reference to it (`ref_not_citable`).
 */
export interface DraftSectionPage {
  readonly id: string;
  readonly url: string;
  readonly excerpts: readonly DraftPageExcerpt[];
}

export interface DraftGapAngle {
  readonly value: string;
  readonly rationale: string;
}

export interface DraftSectionInput {
  readonly section: {
    readonly id: string;
    readonly h2: string;
    readonly h3: readonly string[];
    readonly answers: readonly string[];
  };
  readonly questions: readonly DraftSectionQuestion[];
  readonly pages: readonly DraftSectionPage[];
  /** Already trimmed by the handler per `settings.product_mention`; may be empty. */
  readonly facts: readonly ProfileFact[];
  /** Only the section the gap angle is mounted on gets one; null everywhere else. */
  readonly gapAngle: DraftGapAngle | null;
  readonly settings: DraftResult["settings"];
  readonly language: string;
  readonly primary: string;
  /** Epoch ms the whole draft must be assembled by. */
  readonly deadlineAt: number;
}

export interface DraftSectionResult {
  readonly status: "ok" | "failed";
  readonly fail_reason: SectionFailReason | null;
  /** From `validateSectionOutput` when ok; empty when failed. */
  readonly paragraphs: { sentences: Sentence[] }[];
  readonly word_count: number;
  /** Calls actually made, including the rejected one before a retry. */
  readonly attempts: number;
  readonly model_id: string | null;
  readonly temperature_requested: number;
  readonly temperature_effective: number | null;
  /** Summed over the attempts sent; null when none was sent or any one of them reported no usage. */
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
}

/**
 * Why the previous reply was thrown away, fed back into the retry prompt.
 *
 * `rule` is a closed enum and `path` is a string this module built, so the
 * note cannot carry model or page text back into the next call.
 */
export interface SectionRejection {
  readonly rule: SectionRule | "shape";
  readonly path: string;
}

export interface DraftCoverageQuestion {
  readonly id: string;
  readonly q: string;
}

export interface DraftCoverageSection {
  readonly id: string;
  readonly h2: string;
  /** The section's sentences joined as prose; the only text the judge reads. */
  readonly text: string;
}

/**
 * `questions` is the askable set (`decideCoverage().askable`) and `sections`
 * the ok sections, in the handler's own words: the model may only name what
 * is quoted here, and the handler validates the reply against the same two
 * sets. `primary` and each section's `h2` are accepted so the handler's
 * input shape stays whole, but the prompt never renders them (§5.4: the
 * judge sees section text and questions only).
 */
export interface DraftCoverageInput {
  readonly primary: string;
  readonly language: string;
  readonly questions: readonly DraftCoverageQuestion[];
  readonly sections: readonly DraftCoverageSection[];
  readonly deadlineAt: number;
}

/**
 * `items` is the reply in `ModelCoverageOutput` shape — exact keys, closed
 * status, `gap` cleaned through the shared decoder — and nothing more. The
 * handler runs `validateCoverageOutput(items, askable, okSectionIds)` before
 * `buildCoverage`. Null means the call could not be made or the reply was not
 * that shape; `reads` says which.
 */
export interface DraftCoverageResult {
  readonly items: ModelCoverageOutput["items"] | null;
  readonly reads: LlmReadMeta;
}

export interface ContentDraftLlmDependencies {
  /** Offline test seam. Defaults to a client built from `config`. */
  readonly client?: KeywordLlmClient;
  /** Explicit config; `null` means "not configured". Omitted = resolve from `env`. */
  readonly config?: KeywordLlmConfig | null;
  readonly now?: () => number;
  /** Offline test seam for the config read. Defaults to `process.env`. */
  readonly env?: Env;
}

/**
 * Prose needs some variety; a claim-labelled section does not need much.
 * A deployment pin (`CONTENT_DRAFT_TEMPERATURE`) overrides it in the client.
 */
export const CONTENT_DRAFT_LLM_TEMPERATURE = 0.4;

/** A judgement, not a composition: the coverage check asks for determinism (handoff §5.4). */
export const CONTENT_DRAFT_COVERAGE_TEMPERATURE = 0;

/* ------------------------------------------------------------------ */
/* Shared plumbing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Transport reasons the client can raise, mapped onto the section's closed
 * set. `SectionFailReason` is a subset of `UnavailableReason`, so the same
 * table serves the coverage read. Exhaustive by type.
 */
const FAILURE_REASONS: Readonly<
  Record<KeywordLlmFailureReason, SectionFailReason>
> = {
  not_configured: "not_configured",
  timeout: "timeout",
  network_error: "provider_error",
  auth_failed: "provider_error",
  rate_limited: "provider_error",
  server_error: "provider_error",
  bad_request: "provider_error",
  invalid_response: "provider_error",
  schema_invalid: "validation_failed",
};

/**
 * Usage for a request that was sent but not answered. The client only
 * reports `requestCount` when the provider replied; a timed-out or refused
 * request is still one call on the ledger.
 */
function sentButUnanswered(usage: KeywordLlmUsage): KeywordLlmUsage {
  return { ...usage, requestCount: Math.max(usage.requestCount, 1) };
}

function resolveConfig(
  deps: ContentDraftLlmDependencies,
): KeywordLlmConfig | null {
  return deps.config !== undefined
    ? deps.config
    : resolveContentDraftLlmConfig(deps.env ?? process.env);
}

/** Whatever the run budget has left for one call, capped, or null if nothing. */
function attemptTimeoutMs(
  deadlineAt: number,
  now: number,
  cap: number,
): number | null {
  const remaining = Math.floor(deadlineAt - now - ENVELOPE_MS);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return Math.min(cap, remaining);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && keys.every((key) => key in record);
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

type ShapeResult<T> =
  | { readonly ok: true; readonly output: T }
  | { readonly ok: false; readonly path: string };

const CLAIM_SET: ReadonlySet<string> = new Set<ClaimState>(CLAIM_STATES);

function parseSentenceShape(
  value: unknown,
  path: string,
): ShapeResult<ModelSentence> {
  const record = asRecord(value);
  if (record === null || !hasExactKeys(record, MODEL_SECTION_OUTPUT_KEYS.sentence)) {
    return { ok: false, path };
  }
  const text = record["text"];
  const claim = record["claim"];
  const refs = record["evidence_refs"];
  if (typeof text !== "string") return { ok: false, path: `${path}.text` };
  if (typeof claim !== "string" || !CLAIM_SET.has(claim)) {
    return { ok: false, path: `${path}.claim` };
  }
  if (!isStringArray(refs)) return { ok: false, path: `${path}.evidence_refs` };
  return {
    ok: true,
    output: { text, claim: claim as ClaimState, evidence_refs: refs },
  };
}

/**
 * The `ModelSectionOutput` shape and nothing more: exact keys, at least one
 * paragraph, at least one sentence per paragraph, strings where strings are
 * due. Text bounds, claim rules and reference checks are
 * `validateSectionOutput`'s and are not repeated here.
 */
export function parseModelSectionShape(
  content: string,
): ShapeResult<ModelSectionOutput> {
  const record = asRecord(parseJson(content));
  if (record === null || !hasExactKeys(record, MODEL_SECTION_OUTPUT_KEYS.root)) {
    return { ok: false, path: "" };
  }
  const rawParagraphs = record["paragraphs"];
  if (!Array.isArray(rawParagraphs) || rawParagraphs.length === 0) {
    return { ok: false, path: "paragraphs" };
  }
  const paragraphs: ModelSectionOutput["paragraphs"] = [];
  for (const [pIndex, rawParagraph] of rawParagraphs.entries()) {
    const path = `paragraphs[${pIndex}]`;
    const paragraph = asRecord(rawParagraph);
    if (
      paragraph === null ||
      !hasExactKeys(paragraph, MODEL_SECTION_OUTPUT_KEYS.paragraph)
    ) {
      return { ok: false, path };
    }
    const rawSentences = paragraph["sentences"];
    if (!Array.isArray(rawSentences) || rawSentences.length === 0) {
      return { ok: false, path: `${path}.sentences` };
    }
    const sentences: ModelSentence[] = [];
    for (const [sIndex, rawSentence] of rawSentences.entries()) {
      const parsed = parseSentenceShape(rawSentence, `${path}.sentences[${sIndex}]`);
      if (!parsed.ok) return parsed;
      sentences.push(parsed.output);
    }
    paragraphs.push({ sentences });
  }
  return { ok: true, output: { paragraphs } };
}

type SectionOutcome =
  | {
      readonly ok: true;
      readonly paragraphs: { sentences: Sentence[] }[];
      readonly word_count: number;
    }
  | { readonly ok: false; readonly rejection: SectionRejection };

/**
 * Only pages that brought an excerpt are citable, and only the section that
 * received the gap angle may take a stance; the validator enforces both.
 */
function sectionEvidence(input: DraftSectionInput): SectionEvidence {
  return {
    citableCrawlIds: new Set(
      input.pages
        .filter((page) => page.excerpts.length > 0)
        .map((page) => page.id),
    ),
    profileFacts: new Map(input.facts.map((fact) => [fact.id, fact] as const)),
    stanceAllowed: input.gapAngle !== null,
  };
}

interface SectionTokens {
  readonly input: number | null;
  readonly output: number | null;
}

/**
 * Strict sum over the attempts that were sent: one unknown makes the total
 * unknown. No attempt sent is null too — there is nothing to report, not a
 * known zero — which is how the brief records a call that never went out.
 */
function sectionTokens(sent: readonly KeywordLlmUsage[]): SectionTokens {
  const strictSum = (values: readonly (number | null)[]): number | null => {
    if (values.length === 0 || values.some((value) => value === null)) return null;
    return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  };
  return {
    input: strictSum(sent.map((usage) => usage.inputTokens)),
    output: strictSum(sent.map((usage) => usage.outputTokens)),
  };
}

function checkSectionReply(
  content: string,
  evidence: SectionEvidence,
): SectionOutcome {
  const shape = parseModelSectionShape(content);
  if (!shape.ok) return { ok: false, rejection: { rule: "shape", path: shape.path } };
  const validation = validateSectionOutput(shape.output, evidence);
  if (!validation.ok) {
    return { ok: false, rejection: { rule: validation.rule, path: validation.path } };
  }
  return {
    ok: true,
    paragraphs: validation.paragraphs,
    word_count: validation.word_count,
  };
}

function sectionRequest(
  input: DraftSectionInput,
  rejection: SectionRejection | null,
  timeoutMs: number,
): KeywordLlmRequest {
  return {
    system: buildDraftSectionSystemPrompt(),
    user: buildDraftSectionUserPrompt(input, rejection),
    temperature: CONTENT_DRAFT_LLM_TEMPERATURE,
    maxOutputTokens: SECTION_MAX_OUTPUT_TOKENS,
    timeoutMs,
  };
}

function sectionFailure(
  reason: SectionFailReason,
  sent: readonly KeywordLlmUsage[],
  modelId: string | null,
  config: KeywordLlmConfig | null,
): DraftSectionResult {
  const attempts = sent.length;
  const tokens = sectionTokens(sent);
  return {
    status: "failed",
    fail_reason: reason,
    paragraphs: [],
    word_count: 0,
    attempts,
    model_id: modelId,
    temperature_requested: CONTENT_DRAFT_LLM_TEMPERATURE,
    // The pin is what the client sent on every attempt made; before any
    // attempt there is no effective value to report.
    temperature_effective: attempts > 0 ? (config?.temperature ?? null) : null,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
  };
}

/**
 * Write one section.
 *
 * Never throws for a transport, deadline or validation failure — those are
 * `status: "failed"` with a closed `fail_reason`. A non-`KeywordLlmError`
 * from the client is a programming error and is rethrown.
 */
export async function generateDraftSection(
  input: DraftSectionInput,
  deps: ContentDraftLlmDependencies = {},
): Promise<DraftSectionResult> {
  languageName(input.language); // throws RangeError on a code outside the table
  const config = resolveConfig(deps);
  if (config === null) return sectionFailure("not_configured", [], null, null);
  const now = deps.now ?? Date.now;
  const client = deps.client ?? createKeywordLlmClient({ config });
  const evidence = sectionEvidence(input);

  /** One usage record per request that left the process, in order. */
  const sent: KeywordLlmUsage[] = [];
  let modelId: string | null = null;
  let rejection: SectionRejection | null = null;
  while (sent.length < SECTION_MAX_ATTEMPTS) {
    const timeoutMs = attemptTimeoutMs(input.deadlineAt, now(), SECTION_TIMEOUT_MS);
    if (timeoutMs === null) {
      // No budget for this attempt. Before any call the section timed out;
      // after a rejected reply the rejection is the fact about this section
      // and the retry is simply unaffordable.
      return sectionFailure(
        rejection === null ? "timeout" : "validation_failed",
        sent,
        modelId,
        config,
      );
    }
    let completion: KeywordLlmCompletion;
    try {
      completion = await client.complete(sectionRequest(input, rejection, timeoutMs));
    } catch (error) {
      if (!(error instanceof KeywordLlmError)) throw error;
      sent.push(sentButUnanswered(error.usage));
      return sectionFailure(FAILURE_REASONS[error.reason], sent, modelId, config);
    }
    sent.push(completion.usage);
    modelId = completion.modelId ?? config.model;
    const outcome = checkSectionReply(completion.content, evidence);
    if (outcome.ok) {
      const tokens = sectionTokens(sent);
      return {
        status: "ok",
        fail_reason: null,
        paragraphs: outcome.paragraphs,
        word_count: outcome.word_count,
        attempts: sent.length,
        model_id: modelId,
        temperature_requested: CONTENT_DRAFT_LLM_TEMPERATURE,
        temperature_effective: config.temperature ?? null,
        input_tokens: tokens.input,
        output_tokens: tokens.output,
      };
    }
    rejection = outcome.rejection;
  }
  return sectionFailure("validation_failed", sent, modelId, config);
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

type CoverageStatus = ModelCoverageOutput["items"][number]["status"];
const COVERAGE_STATUS_SET: ReadonlySet<string> = new Set<CoverageStatus>(COVERAGE_STATUSES);

/**
 * A free-text field in the one form the parser also accepts: cleaned and
 * bounded by the shared decoder, so the value stored is the value checked.
 */
function text(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const result = boundedModelText(value, maxChars);
  return result.ok ? result.value : null;
}

function parseCoverageItemShape(
  value: unknown,
  path: string,
): ShapeResult<ModelCoverageOutput["items"][number]> {
  const record = asRecord(value);
  if (record === null || !hasExactKeys(record, MODEL_COVERAGE_OUTPUT_KEYS.item)) {
    return { ok: false, path };
  }
  const questionId = record["question_id"];
  const status = record["status"];
  const coveredIn = record["covered_in"];
  const rawGap = record["gap"];
  if (typeof questionId !== "string") return { ok: false, path: `${path}.question_id` };
  if (typeof status !== "string" || !COVERAGE_STATUS_SET.has(status)) {
    return { ok: false, path: `${path}.status` };
  }
  if (coveredIn !== null && typeof coveredIn !== "string") {
    return { ok: false, path: `${path}.covered_in` };
  }
  const gap = rawGap === null ? null : text(rawGap, MODEL_TEXT_MAX_CHARS);
  if (rawGap !== null && gap === null) return { ok: false, path: `${path}.gap` };
  return {
    ok: true,
    output: {
      question_id: questionId,
      status: status as CoverageStatus,
      covered_in: coveredIn,
      gap,
    },
  };
}

/**
 * The `ModelCoverageOutput` shape: exact keys, closed status, `gap` cleaned
 * through the shared decoder. Which ids are legal and which combinations of
 * status / covered_in / gap are allowed is `validateCoverageOutput`'s.
 */
export function parseModelCoverageShape(
  content: string,
): ShapeResult<ModelCoverageOutput> {
  const record = asRecord(parseJson(content));
  if (record === null || !hasExactKeys(record, MODEL_COVERAGE_OUTPUT_KEYS.root)) {
    return { ok: false, path: "" };
  }
  const rawItems = record["items"];
  if (!Array.isArray(rawItems)) return { ok: false, path: "items" };
  const items: ModelCoverageOutput["items"] = [];
  for (const [index, rawItem] of rawItems.entries()) {
    const parsed = parseCoverageItemShape(rawItem, `items[${index}]`);
    if (!parsed.ok) return parsed;
    items.push(parsed.output);
  }
  return { ok: true, output: { items } };
}

function unavailable(
  reason: UnavailableReason,
  attempted: number,
  usage: KeywordLlmUsage,
  modelId: string | null,
): LlmReadMeta {
  return {
    status: "unavailable",
    reason,
    attempted,
    calls: usage.requestCount,
    model_id: modelId,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  };
}

function coverageRequest(
  input: DraftCoverageInput,
  timeoutMs: number,
): KeywordLlmRequest {
  return {
    system: buildDraftCoverageSystemPrompt(),
    user: buildDraftCoverageUserPrompt(input),
    temperature: CONTENT_DRAFT_COVERAGE_TEMPERATURE,
    maxOutputTokens: COVERAGE_MAX_OUTPUT_TOKENS,
    timeoutMs,
  };
}

/**
 * Judge coverage of the askable questions against the ok sections.
 *
 * With no askable question there is nothing to judge: no call is made and
 * `items` is the empty list, which validates against an empty askable set.
 * Everything else that goes wrong leaves `items` null.
 */
export async function runDraftCoverage(
  input: DraftCoverageInput,
  deps: ContentDraftLlmDependencies = {},
): Promise<DraftCoverageResult> {
  languageName(input.language); // throws RangeError on a code outside the table
  if (input.questions.length === 0) {
    return {
      items: [],
      reads: unavailable("insufficient_evidence", 0, EMPTY_KEYWORD_LLM_USAGE, null),
    };
  }
  const config = resolveConfig(deps);
  if (config === null) {
    return {
      items: null,
      reads: unavailable("not_configured", 0, EMPTY_KEYWORD_LLM_USAGE, null),
    };
  }
  const now = deps.now ?? Date.now;
  const timeoutMs = attemptTimeoutMs(input.deadlineAt, now(), COVERAGE_TIMEOUT_MS);
  if (timeoutMs === null) {
    return {
      items: null,
      reads: unavailable("timeout", 0, EMPTY_KEYWORD_LLM_USAGE, null),
    };
  }

  const client = deps.client ?? createKeywordLlmClient({ config });
  let completion: KeywordLlmCompletion;
  try {
    completion = await client.complete(coverageRequest(input, timeoutMs));
  } catch (error) {
    if (!(error instanceof KeywordLlmError)) throw error;
    return {
      items: null,
      reads: unavailable(
        FAILURE_REASONS[error.reason],
        1,
        sentButUnanswered(error.usage),
        null,
      ),
    };
  }

  const modelId = completion.modelId ?? config.model;
  const shape = parseModelCoverageShape(completion.content);
  if (!shape.ok) {
    return {
      items: null,
      reads: unavailable("validation_failed", 1, completion.usage, modelId),
    };
  }
  return {
    items: shape.output.items,
    reads: {
      status: "complete",
      calls: completion.usage.requestCount,
      model_id: modelId,
      temperature_requested: CONTENT_DRAFT_COVERAGE_TEMPERATURE,
      // Same policy as the brief: the pin is the only effective value we can
      // vouch for; without one the page prints null, not "probably 0".
      temperature_effective: config.temperature ?? null,
      input_tokens: completion.usage.inputTokens,
      output_tokens: completion.usage.outputTokens,
    },
  };
}
