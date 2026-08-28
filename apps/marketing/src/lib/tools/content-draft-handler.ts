// @input  -- an authenticated POST carrying a parsed ContentBrief, the visitor's settings and which sections to write
// @output -- a fingerprinted DraftResult that passed its own parser, or a stable error envelope
// @pos    -- the only orchestration of draft generation and single-section reruns
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { randomUUID } from "node:crypto";

import { createPublicToolError } from "@sf/public-tools/contract";
import {
  DRAFT_ACCOUNT_MAX_PER_HOUR,
  DRAFT_IP_MAX_PER_HOUR,
  DRAFT_REQUEST_MAX_BYTES,
  DRAFT_TOTAL_BUDGET_MS,
  ENVELOPE_MS,
  OUTLINE_CAP,
  QUOTA_WINDOW_SECONDS,
  SECTION_ACCOUNT_MAX_PER_HOUR,
  SECTION_ENDPOINT_BUDGET_MS,
  SECTION_IP_MAX_PER_HOUR,
  SECTION_REQUEST_MAX_BYTES,
} from "@sf/public-tools/content-brief/constants";
import {
  CONTENT_BRIEF_HANDOFF_MAX_BYTES,
  type ContentBrief,
  type ContentDraftErrorCode,
  type CoverageItem,
  type DraftResult,
  type DraftSection,
  type LlmReadMeta,
} from "@sf/public-tools/content-brief/contract";
import {
  aggregateSectionLlm,
  assembleDraftResult,
  buildCoverage,
  decideCoverage,
  gapAngleSectionId,
  planSections,
  sectionEvidenceScope,
  validateCoverageOutput,
  type PlannedSection,
  type SectionCallMeta,
} from "@sf/public-tools/content-brief/draft-assemble";
import { parseContentBrief } from "@sf/public-tools/content-brief/parse-brief";
import { parseDraftResult, parseDraftSettings } from "@sf/public-tools/content-brief/parse-draft";

import {
  getServerAuthenticatedUser,
  type ServerAuthenticatedUser,
} from "../auth/server-auth-user.ts";
import { extractClientIp } from "../rate-limit.ts";
import { resolveContentDraftLlmConfig } from "./content-brief-llm.ts";
import {
  CONTENT_DRAFT_LLM_TEMPERATURE,
  generateDraftSection,
  runDraftCoverage,
  type DraftCoverageInput,
  type DraftCoverageResult,
  type DraftSectionInput,
  type DraftSectionResult,
} from "./content-draft-llm.ts";
import {
  acquirePublicToolSlot,
  readPublicToolJson,
  type PublicToolSlot,
} from "./public-tool-request.ts";
import { SERP_LANGUAGES, SERP_MARKET_OPTIONS } from "./serp-markets.ts";
import {
  consumePublicToolQuota,
  type PublicToolQuotaOutcome,
} from "./shared-rate-limit.ts";

/**
 * Why the draft never trusts what it is handed.
 *
 * The brief arrives from the browser — pasted, uploaded or carried over in
 * sessionStorage — so before anything expensive runs it must pass the same
 * exact parser the brief tool ran before it answered. Admission comes first
 * though: login, the per-account slot and the hourly buckets are all settled
 * before the parser's hashing and invariant work, so a bad brief cannot be
 * used to burn CPU outside the slot. Sections are generated in parallel under
 * one entry deadline and every started call is drained before the slot is
 * released; a section that fails does not touch the others; the coverage
 * check is a separate call with a fresh context. A rerun returns a whole new
 * DraftResult so the client never assembles one, and the parser is handed the
 * call metadata this request actually observed so the result cannot claim a
 * different lineage.
 */

const TOOL = "content-draft";
const ADMISSION_STEP_MS = 5_000;
const SLOT_RETRY_AFTER_SECONDS = 5;
const RUN_ID_MAX_CHARS = 128;

export interface ContentDraftHandlerDependencies {
  readonly getServerAuthenticatedUser: () => Promise<ServerAuthenticatedUser>;
  readonly readJson: typeof readPublicToolJson;
  readonly extractClientIp: (headers: Headers) => string;
  readonly acquireSlot: (key: string) => PublicToolSlot;
  readonly consumeQuota: (bucketKey: string, max: number, windowSeconds: number) => Promise<PublicToolQuotaOutcome>;
  readonly generateSection: (input: DraftSectionInput) => Promise<DraftSectionResult>;
  readonly runCoverage: (input: DraftCoverageInput) => Promise<DraftCoverageResult>;
  readonly now: () => number;
  readonly runId: () => string;
  readonly emit: (line: string) => void;
}

export const CONTENT_DRAFT_HANDLER_DEPENDENCIES: ContentDraftHandlerDependencies = {
  getServerAuthenticatedUser,
  readJson: readPublicToolJson,
  extractClientIp,
  acquireSlot: acquirePublicToolSlot,
  consumeQuota: (bucketKey, max, windowSeconds) => consumePublicToolQuota(bucketKey, max, windowSeconds),
  generateSection: (input) => generateDraftSection(input, { config: resolveContentDraftLlmConfig() }),
  runCoverage: (input) => runDraftCoverage(input, { config: resolveContentDraftLlmConfig() }),
  now: () => Date.now(),
  runId: () => randomUUID(),
  emit: (line) => console.info(line),
};

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private", ...headers } });
}

function refuse(code: ContentDraftErrorCode, status: number, headers?: Record<string, string>): Response {
  return json(createPublicToolError(code), status, headers);
}

const TIMED_OUT: unique symbol = Symbol("timed-out");
type TimedOut = typeof TIMED_OUT;

async function withBudget<T>(work: () => Promise<T>, timeoutMs: number): Promise<T | TimedOut> {
  if (timeoutMs <= 0) return TIMED_OUT;
  const pending = work();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimedOut>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    pending.catch(() => undefined);
  }
}

interface Clock {
  readonly start: number;
  readonly deadlineAt: number;
  readonly now: () => number;
}

function remaining(clock: Clock, cap: number): number {
  return Math.max(0, Math.min(cap, clock.deadlineAt - clock.now() - ENVELOPE_MS));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* admission                                                            */
/* ------------------------------------------------------------------ */

interface Admitted {
  readonly userId: string;
  readonly clientIp: string;
  readonly body: Record<string, unknown>;
  readonly clock: Clock;
}

/** Login and a bounded body read; nothing here inspects the brief. */
async function admit(
  request: Request,
  dependencies: ContentDraftHandlerDependencies,
  budgetMs: number,
  maxBytes: number,
): Promise<Admitted | Response> {
  const start = dependencies.now();
  const clock: Clock = { start, deadlineAt: start + budgetMs, now: dependencies.now };
  const authentication = await withBudget(
    () => dependencies.getServerAuthenticatedUser().catch((): ServerAuthenticatedUser => ({ status: "unavailable" })),
    remaining(clock, ADMISSION_STEP_MS),
  );
  if (authentication === TIMED_OUT || authentication.status === "unavailable") return refuse("auth_unavailable", 503);
  if (authentication.status === "unauthenticated") return refuse("auth_required", 401);
  const body = await withBudget(() => dependencies.readJson(request, maxBytes), remaining(clock, ADMISSION_STEP_MS));
  if (body === TIMED_OUT) return refuse("invalid_request", 400);
  if (!body.ok) {
    const status = body.code === "payload_too_large" ? 413 : body.code === "unsupported_media_type" ? 415 : 400;
    return refuse(body.code, status);
  }
  if (!isRecord(body.value)) return refuse("invalid_request", 400);
  return { userId: authentication.userId, clientIp: dependencies.extractClientIp(request.headers), body: body.value, clock };
}

async function consumeBuckets(
  dependencies: ContentDraftHandlerDependencies,
  clock: Clock,
  buckets: readonly (readonly [string, number])[],
): Promise<Response | null> {
  for (const [key, max] of buckets) {
    const outcome = await withBudget(() => dependencies.consumeQuota(key, max, QUOTA_WINDOW_SECONDS), remaining(clock, ADMISSION_STEP_MS));
    if (outcome === TIMED_OUT || outcome.kind === "unavailable") return refuse("quota_unavailable", 503);
    if (outcome.kind === "limited") return refuse("rate_limited", 429, { "Retry-After": String(outcome.retryAfterSeconds) });
  }
  return null;
}

/** The brief must be within the handoff byte cap on its own, before the rest of the body is looked at. */
function briefWithinCap(value: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= CONTENT_BRIEF_HANDOFF_MAX_BYTES;
}

/**
 * The brief's market and language become prompt input, so they are pinned to
 * the same closed lists the brief tool accepts; a brief that names anything
 * else cannot have come from it.
 */
function marketAndLanguageKnown(brief: ContentBrief): boolean {
  return SERP_LANGUAGES.has(brief.keyword.language) && SERP_MARKET_OPTIONS.some((option) => option.code === brief.keyword.market);
}

async function parseBriefOrRefuse(value: unknown): Promise<ContentBrief | Response> {
  if (!briefWithinCap(value)) return refuse("payload_too_large", 413);
  const parsed = await parseContentBrief(value);
  if (!parsed.ok) {
    const status = parsed.code === "brief_fingerprint_mismatch" || parsed.code === "brief_reference_invalid" || parsed.code === "brief_schema_mismatch" ? 422 : 400;
    return refuse(parsed.code, status);
  }
  if (!marketAndLanguageKnown(parsed.value)) return refuse("brief_reference_invalid", 422);
  return parsed.value;
}

function readSectionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > OUTLINE_CAP) return null;
  if (value.some((id) => typeof id !== "string" || id === "")) return null;
  const ids = value as string[];
  // Duplicates are refused rather than merged: `requested` is defined as the
  // length of this list, so a merged list would make the result lie about it.
  return new Set(ids).size === ids.length ? ids : null;
}

function readId(value: unknown): string | null {
  return typeof value === "string" && value !== "" && value.length <= RUN_ID_MAX_CHARS ? value : null;
}

/* ------------------------------------------------------------------ */
/* section generation                                                   */
/* ------------------------------------------------------------------ */

interface SectionOutcome {
  readonly section: DraftSection;
  readonly call: SectionCallMeta;
}

function answersOf(planned: PlannedSection): [string, ...string[]] {
  const [first, ...rest] = planned.answers;
  return [first, ...rest];
}

function sectionInput(brief: ContentBrief, planned: PlannedSection, settings: DraftResult["settings"], clock: Clock): DraftSectionInput {
  const scope = sectionEvidenceScope(brief, planned.id, settings);
  const questions = brief.must_answer.status === "available" ? brief.must_answer.items.filter((item) => planned.answers.includes(item.id)) : [];
  const memberIds = new Set(questions.flatMap((item) => item.cluster.members.map((member) => member.observation_id)));
  const pages = brief.evidence.crawl.observed
    .filter((page) => memberIds.has(page.id))
    .map((page) => ({ id: page.id, url: page.final_url, excerpts: page.excerpts.map((excerpt) => ({ heading: excerpt.heading, text: excerpt.text })) }));
  const facts = (brief.evidence.profile?.facts ?? []).filter((fact) => scope.profileFactIds.has(fact.id));
  const gapAngle =
    brief.gap_angle.status === "available" && gapAngleSectionId(brief) === planned.id
      ? { value: brief.gap_angle.value, rationale: brief.gap_angle.rationale }
      : null;
  return {
    section: { id: planned.id, h2: planned.h2, h3: planned.h3, answers: planned.answers },
    questions: questions.map((item) => ({ id: item.id, q: item.q, members: item.cluster.members.map((member) => ({ observation_id: member.observation_id, heading: member.heading })) })),
    pages,
    facts,
    gapAngle,
    settings,
    language: brief.keyword.language,
    primary: brief.keyword.primary,
    deadlineAt: clock.deadlineAt,
  };
}

async function generateOne(
  brief: ContentBrief,
  planned: PlannedSection,
  settings: DraftResult["settings"],
  dependencies: ContentDraftHandlerDependencies,
  clock: Clock,
): Promise<SectionOutcome> {
  const result = await dependencies.generateSection(sectionInput(brief, planned, settings, clock));
  const call: SectionCallMeta = {
    status: result.status,
    attempts: result.attempts,
    fail_reason: result.fail_reason,
    model_id: result.model_id,
    temperature_requested: result.temperature_requested,
    temperature_effective: result.temperature_effective,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  };
  const base = { id: planned.id, h2: planned.h2, answers: answersOf(planned) };
  const llm = { attempts: result.attempts, input_tokens: result.input_tokens, output_tokens: result.output_tokens };
  const section: DraftSection =
    result.status === "ok"
      ? { ...base, status: "ok", body: { word_count: result.word_count, paragraphs: result.paragraphs }, llm }
      : { ...base, status: "failed", fail_reason: result.fail_reason ?? "provider_error", llm };
  return { section, call };
}

function skippedSection(planned: PlannedSection): DraftSection {
  return { id: planned.id, h2: planned.h2, answers: answersOf(planned), status: "skipped" };
}

/**
 * Every started section call is awaited, success or not: rejecting early on
 * the first unexpected error would release the account slot while the other
 * paid calls were still running. The first rejection is rethrown afterwards.
 */
async function generateAll(
  brief: ContentBrief,
  planned: readonly PlannedSection[],
  settings: DraftResult["settings"],
  dependencies: ContentDraftHandlerDependencies,
  clock: Clock,
): Promise<SectionOutcome[]> {
  const settled = await Promise.allSettled(planned.map((item) => generateOne(brief, item, settings, dependencies, clock)));
  const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (rejected !== undefined) throw rejected.reason;
  return settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
}

/** Sections are always in outline order, whatever order they were requested or generated in. */
function inOutlineOrder(brief: ContentBrief, sections: readonly DraftSection[]): DraftSection[] {
  const order = new Map((brief.outline.status === "available" ? brief.outline.items : []).map((item, index) => [item.id, index] as const));
  return [...sections].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/* ------------------------------------------------------------------ */
/* coverage + assembly                                                  */
/* ------------------------------------------------------------------ */

async function checkCoverage(
  brief: ContentBrief,
  sections: readonly DraftSection[],
  dependencies: ContentDraftHandlerDependencies,
  clock: Clock,
): Promise<{ coverage: DraftResult["coverage"]; llm: LlmReadMeta }> {
  const decision = decideCoverage(brief, sections);
  const okSections = sections.filter((section): section is Extract<DraftSection, { status: "ok" }> => section.status === "ok");
  const okIds = new Set(okSections.map((section) => section.id));
  const questions = brief.must_answer.status === "available" ? brief.must_answer.items.filter((item) => decision.askable.includes(item.id)) : [];
  const noCall: LlmReadMeta = { status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null };
  if (questions.length === 0) {
    // Nothing to judge: every question belongs to a failed or skipped section.
    return { coverage: buildCoverage(brief, decision.heuristic, [], noCall), llm: noCall };
  }
  const result = await dependencies.runCoverage({
    primary: brief.keyword.primary,
    language: brief.keyword.language,
    questions: questions.map((item) => ({ id: item.id, q: item.q })),
    sections: okSections.map((section) => ({
      id: section.id,
      h2: section.h2,
      text: section.body.paragraphs.map((paragraph) => paragraph.sentences.map((sentence) => sentence.text).join(" ")).join("\n\n"),
    })),
    deadlineAt: clock.deadlineAt,
  });
  let modelItems: CoverageItem[] | null = null;
  let llm = result.reads;
  if (result.items !== null) {
    const validated = validateCoverageOutput({ items: result.items }, decision.askable, okIds);
    if (validated.ok) {
      modelItems = validated.items;
    } else if (llm.status === "complete") {
      llm = { status: "unavailable", reason: "validation_failed", attempted: 1, calls: llm.calls, model_id: llm.model_id, input_tokens: llm.input_tokens, output_tokens: llm.output_tokens };
    }
  }
  return { coverage: buildCoverage(brief, decision.heuristic, modelItems, llm), llm };
}

interface Rerun {
  readonly previousRunId: string;
  readonly sectionId: string;
  readonly call: SectionCallMeta;
}

async function assembleAndRespond(input: {
  readonly brief: ContentBrief;
  readonly settings: DraftResult["settings"];
  readonly sections: readonly DraftSection[];
  readonly calls: readonly SectionCallMeta[];
  readonly dependencies: ContentDraftHandlerDependencies;
  readonly clock: Clock;
  readonly budgetMs: number;
  readonly rerun: Rerun | null;
}): Promise<Response> {
  const { brief, settings, sections, calls, dependencies, clock, budgetMs, rerun } = input;
  const coverage = await checkCoverage(brief, sections, dependencies, clock);
  const runId = dependencies.runId();
  const result = await assembleDraftResult({
    run: { run_id: runId, reran_from: rerun?.previousRunId ?? null, collected_at: new Date(clock.start).toISOString(), elapsed_ms: Math.max(0, clock.now() - clock.start), budget_ms: budgetMs },
    brief,
    settings,
    sections,
    coverage: coverage.coverage,
    llmSections: aggregateSectionLlm(calls, CONTENT_DRAFT_LLM_TEMPERATURE),
    llmCoverage: coverage.llm,
  });
  // The parser is told what this request actually observed, so a result that
  // claims a different rerun lineage or coverage call cannot leave the server.
  const check = await parseDraftResult(result, brief, { ...(rerun === null ? {} : { rerun }), coverageLlm: coverage.llm });
  if (!check.ok) {
    dependencies.emit(JSON.stringify({ tool: TOOL, run_id: runId, self_check_failed: check.path, code: check.code }));
    return refuse("draft_unavailable", 503);
  }
  dependencies.emit(
    JSON.stringify({
      tool: TOOL,
      run_id: runId,
      reran_from: result.run.reran_from,
      mode: result.run.mode,
      elapsed_ms: result.run.elapsed_ms,
      sections: result.run.reads.sections,
      llm_calls: result.run.reads.llm_sections.calls + result.run.reads.llm_coverage.calls,
      coverage: result.coverage.status === "available" ? { total: result.coverage.total, covered: result.coverage.covered, partial: result.coverage.partial, none: result.coverage.none } : null,
      self_check: "ok",
    }),
  );
  return json(result, 200);
}

/* ------------------------------------------------------------------ */
/* the two endpoints                                                    */
/* ------------------------------------------------------------------ */

interface EndpointShape {
  readonly budgetMs: number;
  readonly maxBytes: number;
  readonly bucketPrefix: string;
  readonly accountMax: number;
  readonly ipMax: number;
}

const RUN_ENDPOINT: EndpointShape = {
  budgetMs: DRAFT_TOTAL_BUDGET_MS,
  maxBytes: DRAFT_REQUEST_MAX_BYTES,
  bucketPrefix: `public-${TOOL}`,
  accountMax: DRAFT_ACCOUNT_MAX_PER_HOUR,
  ipMax: DRAFT_IP_MAX_PER_HOUR,
};

const SECTION_ENDPOINT: EndpointShape = {
  budgetMs: SECTION_ENDPOINT_BUDGET_MS,
  maxBytes: SECTION_REQUEST_MAX_BYTES,
  bucketPrefix: `public-${TOOL}-section`,
  accountMax: SECTION_ACCOUNT_MAX_PER_HOUR,
  ipMax: SECTION_IP_MAX_PER_HOUR,
};

/**
 * Admission in the mandated order — login, the per-account slot, the hourly
 * buckets — and only then the brief's parser and the paid work, all inside one
 * try/finally so every exit releases the slot and every unexpected error
 * becomes the closed `draft_unavailable` envelope.
 */
async function handle(
  request: Request,
  dependencies: ContentDraftHandlerDependencies,
  shape: EndpointShape,
  work: (admitted: Admitted) => Promise<Response>,
): Promise<Response> {
  let slot: PublicToolSlot | null = null;
  try {
    const admitted = await admit(request, dependencies, shape.budgetMs, shape.maxBytes);
    if (admitted instanceof Response) return admitted;
    slot = dependencies.acquireSlot(`${TOOL}:account:${admitted.userId}`);
    if (!slot.acquired) return refuse("run_in_progress", 409, { "Retry-After": String(SLOT_RETRY_AFTER_SECONDS) });
    const refusal = await consumeBuckets(dependencies, admitted.clock, [
      [`${shape.bucketPrefix}:account:${admitted.userId}`, shape.accountMax],
      [`${shape.bucketPrefix}:ip:${admitted.clientIp}`, shape.ipMax],
    ]);
    if (refusal !== null) return refusal;
    return await work(admitted);
  } catch (error: unknown) {
    dependencies.emit(JSON.stringify({ tool: TOOL, unhandled: error instanceof Error ? error.name : typeof error }));
    return refuse("draft_unavailable", 503);
  } finally {
    if (slot?.acquired === true) slot.release();
  }
}

export async function handleContentDraftRunRequest(
  request: Request,
  dependencies: ContentDraftHandlerDependencies = CONTENT_DRAFT_HANDLER_DEPENDENCIES,
): Promise<Response> {
  return handle(request, dependencies, RUN_ENDPOINT, async ({ body, clock }) => {
    const settings = parseDraftSettings(body["settings"]);
    if (!settings.ok) return refuse("invalid_request", 400);
    const sectionIds = readSectionIds(body["section_ids"]);
    if (sectionIds === null) return refuse("invalid_request", 400);
    const brief = await parseBriefOrRefuse(body["brief"]);
    if (brief instanceof Response) return brief;
    const plan = planSections(brief, sectionIds);
    if ("ok" in plan) return refuse(plan.code, 422);

    const outcomes = await generateAll(brief, plan.requested, settings.value, dependencies, clock);
    const sections = inOutlineOrder(brief, [...outcomes.map((outcome) => outcome.section), ...plan.skipped.map(skippedSection)]);
    return assembleAndRespond({
      brief,
      settings: settings.value,
      sections,
      calls: outcomes.map((outcome) => outcome.call),
      dependencies,
      clock,
      budgetMs: DRAFT_TOTAL_BUDGET_MS,
      rerun: null,
    });
  });
}

export async function handleContentDraftSectionRequest(
  request: Request,
  dependencies: ContentDraftHandlerDependencies = CONTENT_DRAFT_HANDLER_DEPENDENCIES,
): Promise<Response> {
  return handle(request, dependencies, SECTION_ENDPOINT, async ({ body, clock }) => {
    const sectionId = readId(body["section_id"]);
    if (sectionId === null) return refuse("invalid_request", 400);
    const brief = await parseBriefOrRefuse(body["brief"]);
    if (brief instanceof Response) return brief;
    // The result being reworked is carried whole and must pass the same exact
    // parser it passed on the way out (fingerprint included), so its settings,
    // sections and run id are verified facts rather than loose client fields.
    const previous = await parseDraftResult(body["previous"], brief);
    if (!previous.ok) return refuse(previous.code, previous.code === "invalid_request" ? 400 : 422);
    const settings = previous.value.settings;
    // A skipped section is still writable: the visitor unchecked it on the first
    // run and may ask for it now; this endpoint is how it gets written.
    const outline = brief.outline.status === "available" ? brief.outline.items.find((item) => item.id === sectionId) : undefined;
    if (outline === undefined || !brief.draft_readiness.writable.includes(sectionId) || !previous.value.sections.some((section) => section.id === sectionId)) {
      return refuse("section_not_writable", 422);
    }

    const planned: PlannedSection = { id: outline.id, h2: outline.h2, h3: outline.h3, answers: outline.answers };
    const outcome = await generateOne(brief, planned, settings, dependencies, clock);
    const sections = previous.value.sections.map((section) => (section.id === sectionId ? outcome.section : section));
    // Only this request's call is known here; the earlier sections' calls are not re-reported.
    return assembleAndRespond({
      brief,
      settings,
      sections,
      calls: [outcome.call],
      dependencies,
      clock,
      budgetMs: SECTION_ENDPOINT_BUDGET_MS,
      rerun: { previousRunId: previous.value.run.run_id, sectionId, call: outcome.call },
    });
  });
}
