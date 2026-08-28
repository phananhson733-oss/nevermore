// @input  -- CONTENT_BRIEF_* / CONTENT_DRAFT_* env, one ContentBriefLlmInput, an injectable KeywordLlmClient
// @output -- a strictly validated ModelBriefOutput or null, with the LlmReadMeta and derived_from the brief records
// @pos    -- the Content Brief Builder's only model call; prompt text comes from content-brief-prompts.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * One call, one strict parse, no retry, no fallback.
 *
 * The brief runs inside a 45-second budget shared with SERP, crawl and GSC,
 * so the model gets whatever is left of it (capped at `LLM_DEADLINE_MS`) and
 * exactly one attempt. Every way the call can fail is recorded as its own
 * `LlmReadMeta` branch rather than thrown: the brief must still assemble the
 * fields that did not need a model when the model is unconfigured, slow or
 * wrong.
 *
 * The parse is strict on purpose. The model is only allowed to reference ids
 * the server handed it (`Q*`, `C*`, `P*`, `G*`); any id it invents, any cap it
 * exceeds and any field it fills when it was told to return null throws the
 * whole reply away as `validation_failed`. A salvage path that kept the good
 * half of a reply is exactly how a page-injected instruction would reach the
 * visitor, so there is none.
 *
 * Configuration deliberately does NOT fall back to the `KEYWORD_MAP_*`,
 * `AZURE_OPENAI_*` or `OPENAI_*` variables the keyword tool reads. Each tool
 * on the marketing site owns a prefixed set so it can be pointed at another
 * model, or switched off, without touching the others; a missing set here is
 * "not configured", never "borrow the neighbour's key".
 */

import {
  DO_NOT_COVER_CAP,
  ENVELOPE_MS,
  INTERNAL_LINKS_CAP,
  LLM_DEADLINE_MS,
  LLM_MAX_OUTPUT_TOKENS,
  MODEL_TEXT_MAX_CHARS,
  OUTLINE_CAP,
  QUESTION_MAX_CHARS,
} from "@sf/public-tools/content-brief/constants";
import type {
  BriefGscPageRow,
  ClusterMember,
  CrawlExcerpt,
  LlmReadMeta,
  ModelBriefOutput,
  Origin,
  ProfileFact,
  UnavailableReason,
} from "@sf/public-tools/content-brief/contract";
import { boundedModelText } from "@sf/public-tools/content-brief/text";

import {
  buildContentBriefSystemPrompt,
  buildContentBriefUserPrompt,
  MODEL_BRIEF_OUTPUT_KEYS,
} from "./content-brief-prompts.ts";
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
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

type Env = Readonly<Record<string, string | undefined>>;

export const CONTENT_BRIEF_ENV_PREFIX = "CONTENT_BRIEF";
export const CONTENT_DRAFT_ENV_PREFIX = "CONTENT_DRAFT";

const OPENAI_CHAT_COMPLETIONS_URL =
  "https://api.openai.com/v1/chat/completions";

/** Chat Completions accepts sampling temperatures in this closed range. */
const MIN_PINNED_TEMPERATURE = 0;
const MAX_PINNED_TEMPERATURE = 2;

function present(env: Env, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Read a temperature the deployment pins, or null to leave it to the task.
 *
 * Same policy as `keyword-llm-client.ts`: an unparseable or out-of-range
 * value resolves to null rather than being sent, so a typo in a dashboard
 * falls back to the task's own choice instead of a provider 400.
 */
function pinnedTemperature(env: Env, key: string): number | null {
  const raw = present(env, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) &&
    value >= MIN_PINNED_TEMPERATURE &&
    value <= MAX_PINNED_TEMPERATURE
    ? value
    : null;
}

/**
 * Resolve one prefixed variable set, or null when the key or model is absent.
 *
 * Mirrors the `KEYWORD_MAP_*` branch of `resolveKeywordLlmConfig` — the url
 * default, the auth-scheme spelling and the pinned-temperature read — and
 * stops there. Returning null rather than throwing is what lets the brief
 * render "model not configured" as one cell of its evidence grid.
 */
function resolvePrefixedLlmConfig(
  env: Env,
  prefix: string,
): KeywordLlmConfig | null {
  const apiKey = present(env, `${prefix}_API_KEY`);
  const model = present(env, `${prefix}_MODEL`);
  if (apiKey === null || model === null) return null;
  return {
    apiKey,
    model,
    url: present(env, `${prefix}_URL`) ?? OPENAI_CHAT_COMPLETIONS_URL,
    authScheme:
      present(env, `${prefix}_AUTH_SCHEME`)?.toLowerCase() === "api-key"
        ? "api-key"
        : "bearer",
    temperature: pinnedTemperature(env, `${prefix}_TEMPERATURE`),
  };
}

export function resolveContentBriefLlmConfig(
  env: Env = process.env,
): KeywordLlmConfig | null {
  return resolvePrefixedLlmConfig(env, CONTENT_BRIEF_ENV_PREFIX);
}

/** The Content Draft Writer's set. Resolved here so both tools share one shape. */
export function resolveContentDraftLlmConfig(
  env: Env = process.env,
): KeywordLlmConfig | null {
  return resolvePrefixedLlmConfig(env, CONTENT_DRAFT_ENV_PREFIX);
}

/* ------------------------------------------------------------------ */
/* Input / output shapes                                               */
/* ------------------------------------------------------------------ */

/** One excerpt quoted under a question, tagged with the page it came from. */
export interface ContentBriefLlmExcerpt extends Pick<
  CrawlExcerpt,
  "heading" | "text"
> {
  readonly observation_id: string;
}

export interface ContentBriefLlmQuestion {
  /** Server-assigned `Q1`…; the model returns it unchanged. */
  readonly id: string;
  readonly canonical_heading: string;
  readonly members: readonly ClusterMember[];
  readonly excerpts: readonly ContentBriefLlmExcerpt[];
}

/**
 * One observed competitor page as the model sees it for the gap check.
 *
 * `h2` is what the crawl read, at most `CRAWL_EXCERPTS_PER_PAGE_MAX` per page,
 * each at most `HEADING_MAX_CHARS`. Every observed page is listed — not only
 * the ones whose headings made it into a question cluster — because
 * `checked_against` must name every page, and a claim to have checked a page
 * the model never saw would be a lie the parser cannot detect.
 */
export interface ContentBriefObservedPage {
  readonly id: string;
  readonly url: string;
  readonly h2: readonly string[];
}

export interface ContentBriefLlmInput {
  readonly primary: string;
  readonly supporting: readonly string[];
  readonly language: string;
  readonly questions: readonly ContentBriefLlmQuestion[];
  /** `must_answer.items.length >= OUTLINE_MIN_QUESTIONS`; false means the outline is not requested and must come back null. */
  readonly requestOutline: boolean;
  /** null = no profile selected or unreadable; the model must then return `gap_angle: null`. */
  readonly facts: readonly ProfileFact[] | null;
  /** null = no GSC page rows; `internal_links` / `do_not_cover` must then be null. */
  readonly gscPages: readonly BriefGscPageRow[] | null;
  /** Every observed `C*` id; `gap_angle.checked_against` must equal this set. */
  readonly observedIds: readonly string[];
  /** Every observed page with its headings; rendered so the model has actually read what it claims to have checked. */
  readonly observedPages: readonly ContentBriefObservedPage[];
  /** Epoch ms the whole brief must be assembled by. */
  readonly deadlineAt: number;
}

export interface ContentBriefLlmResult {
  readonly output: ModelBriefOutput | null;
  readonly reads: LlmReadMeta;
  /** Computed from what was actually fed, not from what the model claims. */
  readonly derived_from: Origin[];
}

export interface ContentBriefLlmDependencies {
  /** Offline test seam. Defaults to a client built from `config`. */
  readonly client?: KeywordLlmClient;
  /** Explicit config; `null` means "not configured". Omitted = resolve from `env`. */
  readonly config?: KeywordLlmConfig | null;
  readonly now?: () => number;
  /** Offline test seam for the config read. Defaults to `process.env`. */
  readonly env?: Env;
}

/** Low, because the reply is a structured rewrite of given headings, not prose. */
export const CONTENT_BRIEF_LLM_TEMPERATURE = 0.2;

/* ------------------------------------------------------------------ */
/* The call                                                            */
/* ------------------------------------------------------------------ */

const BASE_DERIVED_FROM: readonly Origin[] = ["crawl", "user_input"];

function derivedFrom(input: ContentBriefLlmInput): Origin[] {
  return [
    ...BASE_DERIVED_FROM,
    ...(input.facts !== null ? (["product_profile"] as const) : []),
    ...(input.gscPages !== null ? (["gsc"] as const) : []),
  ];
}

/**
 * Transport reasons the client can raise, mapped onto the brief's closed set.
 *
 * Exhaustive by type: a new client reason fails to compile here instead of
 * silently becoming whatever the fallthrough happened to be.
 */
const FAILURE_REASONS: Readonly<
  Record<KeywordLlmFailureReason, UnavailableReason>
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

/**
 * No clusters to turn into questions, no facts for a gap angle, no owned pages
 * to link: every field would come back null or empty, so a call would only
 * buy tokens.
 */
function nothingToAsk(input: ContentBriefLlmInput): boolean {
  return (
    input.questions.length === 0 &&
    input.facts === null &&
    input.gscPages === null
  );
}

/** The result of a run that never reached the provider: nothing attempted, nothing billed. */
function withoutCall(
  reason: UnavailableReason,
  derived_from: Origin[],
): ContentBriefLlmResult {
  const reads = unavailable(reason, 0, EMPTY_KEYWORD_LLM_USAGE, null);
  return { output: null, reads, derived_from };
}

function briefRequest(
  input: ContentBriefLlmInput,
  timeoutMs: number,
): KeywordLlmRequest {
  return {
    system: buildContentBriefSystemPrompt(),
    user: buildContentBriefUserPrompt(input),
    temperature: CONTENT_BRIEF_LLM_TEMPERATURE,
    maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
    timeoutMs,
  };
}

/** Whatever the run budget has left for the model, capped, or null if nothing. */
function attemptTimeoutMs(deadlineAt: number, now: number): number | null {
  const remaining = Math.floor(deadlineAt - now - ENVELOPE_MS);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return Math.min(LLM_DEADLINE_MS, remaining);
}

/**
 * Run the brief's single model call.
 *
 * Never throws for a transport, deadline or validation failure — those are
 * the `reads` branches. A non-`KeywordLlmError` from the client is a
 * programming error and is rethrown: recording it as `provider_error` would
 * send an operator to the provider's status page for our own bug.
 */
export async function runContentBriefLlm(
  input: ContentBriefLlmInput,
  deps: ContentBriefLlmDependencies = {},
): Promise<ContentBriefLlmResult> {
  const derived_from = derivedFrom(input);
  // Checked before configuration: "nothing to ask" is the more specific fact.
  if (nothingToAsk(input)) return withoutCall("insufficient_evidence", derived_from);
  const config =
    deps.config !== undefined
      ? deps.config
      : resolveContentBriefLlmConfig(deps.env ?? process.env);
  if (config === null) return withoutCall("not_configured", derived_from);

  const now = deps.now ?? Date.now;
  const timeoutMs = attemptTimeoutMs(input.deadlineAt, now());
  if (timeoutMs === null) return withoutCall("timeout", derived_from);

  const client = deps.client ?? createKeywordLlmClient({ config });
  let completion: KeywordLlmCompletion;
  try {
    completion = await client.complete(briefRequest(input, timeoutMs));
  } catch (error) {
    if (!(error instanceof KeywordLlmError)) throw error;
    const reads = unavailable(
      FAILURE_REASONS[error.reason],
      1,
      error.usage,
      null,
    );
    return { output: null, reads, derived_from };
  }

  const modelId = completion.modelId ?? config.model;
  const output = parseModelBriefOutput(completion.content, input);
  if (output === null) {
    const reads = unavailable(
      "validation_failed",
      1,
      completion.usage,
      modelId,
    );
    return { output: null, reads, derived_from };
  }
  return {
    output,
    reads: completeReads(completion, config, modelId),
    derived_from,
  };
}

function completeReads(
  completion: KeywordLlmCompletion,
  config: KeywordLlmConfig,
  modelId: string,
): LlmReadMeta {
  return {
    status: "complete",
    calls: completion.usage.requestCount,
    model_id: modelId,
    temperature_requested: CONTENT_BRIEF_LLM_TEMPERATURE,
    // The pin is the only effective value we can vouch for. Without one the
    // provider *probably* used the requested value, but "probably" is not a
    // fact the page may print, so it stays null.
    temperature_effective: config.temperature ?? null,
    input_tokens: completion.usage.inputTokens,
    output_tokens: completion.usage.outputTokens,
  };
}

/* ------------------------------------------------------------------ */
/* Strict parse of ModelBriefOutput                                    */
/* ------------------------------------------------------------------ */

type Questions = ModelBriefOutput["questions"];
type Outline = NonNullable<ModelBriefOutput["outline"]>;
type OutlineSection = Outline[number];
type GapAngle = NonNullable<ModelBriefOutput["gap_angle"]>;
type InternalLinks = NonNullable<ModelBriefOutput["internal_links"]>;
type DoNotCover = NonNullable<ModelBriefOutput["do_not_cover"]>;

/** `null` is a legal value for four of the five fields, so "invalid" needs its own marker. */
const INVALID = Symbol("invalid");
type Parsed<T> = T | typeof INVALID;

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

/**
 * A non-empty free-text field in the one form the parser also accepts.
 *
 * The shared decoder cleans and bounds; its returned value — not the raw
 * reply — is what goes into the output, so the parser's `isBoundedModelText`
 * check on the assembled brief cannot disagree with this one.
 */
function text(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const result = boundedModelText(value, maxChars);
  return result.ok ? result.value : null;
}

/**
 * A list of known ids with no repeats.
 *
 * Every id list in the reply is a set in meaning — answered questions, facts
 * relied on, pages checked — and a repeat is either padding or a model that
 * lost track, neither of which the assembler should have to reason about.
 */
function idList(value: unknown, known: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item) || seen.has(item)) {
      return null;
    }
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

function parseQuestions(
  value: unknown,
  known: ReadonlySet<string>,
): Questions | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const questions: Questions = [];
  for (const item of value) {
    const record = asRecord(item);
    if (
      record === null ||
      !hasExactKeys(record, MODEL_BRIEF_OUTPUT_KEYS.question)
    ) {
      return null;
    }
    const id = record["id"];
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) return null;
    const q = text(record["q"], QUESTION_MAX_CHARS);
    if (q === null) return null;
    seen.add(id);
    questions.push({ id, q });
  }
  return questions;
}

function parseSection(
  value: unknown,
  known: ReadonlySet<string>,
  answered: Set<string>,
): OutlineSection | null {
  const record = asRecord(value);
  if (
    record === null ||
    !hasExactKeys(record, MODEL_BRIEF_OUTPUT_KEYS.section)
  ) {
    return null;
  }
  const h2 = text(record["h2"], MODEL_TEXT_MAX_CHARS);
  if (h2 === null || !Array.isArray(record["h3"])) return null;
  const h3: string[] = [];
  for (const item of record["h3"]) {
    const heading = text(item, MODEL_TEXT_MAX_CHARS);
    if (heading === null) return null;
    h3.push(heading);
  }
  const answers = idList(record["answers"], known);
  if (answers === null || answers.length === 0) return null;
  // "Each Q is answered by exactly one section" — `idList` already refused a
  // repeat inside this section; this refuses one across sections.
  for (const id of answers) {
    if (answered.has(id)) return null;
    answered.add(id);
  }
  return { h2, h3, answers };
}

function parseOutline(
  value: unknown,
  requested: boolean,
  known: ReadonlySet<string>,
): Parsed<ModelBriefOutput["outline"]> {
  if (!requested) return value === null ? null : INVALID;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > OUTLINE_CAP
  ) {
    return INVALID;
  }
  const answered = new Set<string>();
  const outline: Outline = [];
  for (const item of value) {
    const section = parseSection(item, known, answered);
    if (section === null) return INVALID;
    outline.push(section);
  }
  // Exactly one section per question, in both directions: `parseSection`
  // refused a second section for any question, and `answered` only ever holds
  // known ids, so a size match means no question was left out.
  if (answered.size !== known.size) return INVALID;
  return outline;
}

/** Set equality; `ids` is already known-only and repeat-free, so size is enough. */
function coversExactly(
  ids: readonly string[],
  observed: ReadonlySet<string>,
): boolean {
  return ids.length === observed.size;
}

function parseGapAngle(
  value: unknown,
  factIds: ReadonlySet<string> | null,
  observed: ReadonlySet<string>,
): Parsed<ModelBriefOutput["gap_angle"]> {
  if (factIds === null) return value === null ? null : INVALID;
  const record = asRecord(value);
  if (
    record === null ||
    !hasExactKeys(record, MODEL_BRIEF_OUTPUT_KEYS.gapAngle)
  ) {
    return INVALID;
  }
  const angle = text(record["value"], MODEL_TEXT_MAX_CHARS);
  const rationale = text(record["rationale"], MODEL_TEXT_MAX_CHARS);
  const refs = idList(record["profile_fact_refs"], factIds);
  const checked = idList(record["checked_against"], observed);
  if (angle === null || rationale === null) return INVALID;
  if (refs === null || refs.length === 0) return INVALID;
  if (checked === null || !coversExactly(checked, observed)) return INVALID;
  const gapAngle: GapAngle = {
    value: angle,
    rationale,
    profile_fact_refs: refs,
    checked_against: checked,
  };
  return gapAngle;
}

/** `internal_links` and `do_not_cover` share one shape: a page id plus one sentence. */
interface PageRefItem {
  readonly page_ref: string;
  readonly text: string;
}

function parsePageRefs(
  value: unknown,
  pageIds: ReadonlySet<string> | null,
  cap: number,
  textKey: "why" | "topic",
): Parsed<PageRefItem[] | null> {
  if (pageIds === null) return value === null ? null : INVALID;
  if (!Array.isArray(value) || value.length > cap) return INVALID;
  const keys =
    textKey === "why"
      ? MODEL_BRIEF_OUTPUT_KEYS.link
      : MODEL_BRIEF_OUTPUT_KEYS.cover;
  const items: PageRefItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    if (record === null || !hasExactKeys(record, keys)) return INVALID;
    const pageRef = record["page_ref"];
    const sentence = text(record[textKey], MODEL_TEXT_MAX_CHARS);
    if (
      typeof pageRef !== "string" ||
      !pageIds.has(pageRef) ||
      seen.has(pageRef) ||
      sentence === null
    ) {
      return INVALID;
    }
    seen.add(pageRef);
    items.push({ page_ref: pageRef, text: sentence });
  }
  return items;
}

function parseInternalLinks(
  value: unknown,
  pageIds: ReadonlySet<string> | null,
): Parsed<InternalLinks | null> {
  const parsed = parsePageRefs(value, pageIds, INTERNAL_LINKS_CAP, "why");
  if (parsed === INVALID || parsed === null) return parsed;
  return parsed.map((item) => ({ page_ref: item.page_ref, why: item.text }));
}

function parseDoNotCover(
  value: unknown,
  pageIds: ReadonlySet<string> | null,
): Parsed<DoNotCover | null> {
  const parsed = parsePageRefs(value, pageIds, DO_NOT_COVER_CAP, "topic");
  if (parsed === INVALID || parsed === null) return parsed;
  return parsed.map((item) => ({ page_ref: item.page_ref, topic: item.text }));
}

function idSet<T extends { readonly id: string }>(
  items: readonly T[] | null,
): ReadonlySet<string> | null {
  return items === null ? null : new Set(items.map((item) => item.id));
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Turn the raw reply into a `ModelBriefOutput`, or null if any rule fails.
 *
 * Exported for the assembler's tests; production only reaches it through
 * `runContentBriefLlm`.
 */
export function parseModelBriefOutput(
  content: string,
  input: ContentBriefLlmInput,
): ModelBriefOutput | null {
  const record = asRecord(parseJson(content));
  if (record === null || !hasExactKeys(record, MODEL_BRIEF_OUTPUT_KEYS.root)) {
    return null;
  }
  const questionIds = new Set(input.questions.map((question) => question.id));
  const questions = parseQuestions(record["questions"], questionIds);
  if (questions === null) return null;
  const outline = parseOutline(
    record["outline"],
    input.requestOutline,
    questionIds,
  );
  const gapAngle = parseGapAngle(
    record["gap_angle"],
    idSet(input.facts),
    new Set(input.observedIds),
  );
  const pageIds = idSet(input.gscPages);
  const internalLinks = parseInternalLinks(record["internal_links"], pageIds);
  const doNotCover = parseDoNotCover(record["do_not_cover"], pageIds);
  if (
    outline === INVALID ||
    gapAngle === INVALID ||
    internalLinks === INVALID ||
    doNotCover === INVALID
  ) {
    return null;
  }
  return {
    questions,
    outline,
    gap_angle: gapAngle,
    internal_links: internalLinks,
    do_not_cover: doNotCover,
  };
}
