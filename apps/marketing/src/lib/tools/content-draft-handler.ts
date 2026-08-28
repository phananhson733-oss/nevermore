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
  type ProfileFact,
} from "@sf/public-tools/content-brief/contract";
import {
  aggregateSectionLlm,
  assembleDraftResult,
  buildCoverage,
  decideCoverage,
  gapAngleSectionId,
  planSections,
  validateCoverageOutput,
  type PlannedSection,
  type SectionCallMeta,
} from "@sf/public-tools/content-brief/draft-assemble";
import { parseContentBrief } from "@sf/public-tools/content-brief/parse-brief";
import { parseDraftResult, parseDraftSections, parseDraftSettings } from "@sf/public-tools/content-brief/parse-draft";

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
import {
  consumePublicToolQuota,
  type PublicToolQuotaOutcome,
} from "./shared-rate-limit.ts";

/**
 * Why the draft never trusts what it is handed.
 *
 * The brief arrives from the browser — pasted, uploaded or carried over in
 * sessionStorage — so the first thing either endpoint does is run the same
 * exact parser the brief tool ran before it answered. Nothing downstream
 * reads a field the parser did not re-derive. Sections are generated in
 * parallel under one entry deadline; a section that fails does not touch the
 * others; the coverage check is a separate call with a fresh context. A
 * rerun returns a whole new DraftResult so the client never assembles one.
 */

const TOOL = "content-draft";
const ADMISSION_STEP_MS = 5_000;

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

async function parseBriefOrRefuse(value: unknown): Promise<ContentBrief | Response> {
  if (!briefWithinCap(value)) return refuse("payload_too_large", 413);
  const parsed = await parseContentBrief(value);
  if (!parsed.ok) {
    const status = parsed.code === "brief_fingerprint_mismatch" || parsed.code === "brief_reference_invalid" || parsed.code === "brief_schema_mismatch" ? 422 : 400;
    return refuse(parsed.code, status);
  }
  return parsed.value;
}

/* ------------------------------------------------------------------ */
/* section generation                                                   */
/* ------------------------------------------------------------------ */

interface SectionOutcome {
  readonly section: DraftSection;
  readonly call: SectionCallMeta | null;
}

function sectionInput(
  brief: ContentBrief,
  planned: PlannedSection,
  settings: DraftResult["settings"],
  clock: Clock,
): DraftSectionInput {
  const questions = brief.must_answer.status === "available" ? brief.must_answer.items.filter((item) => planned.answers.includes(item.id)) : [];
  const pageIds = new Set(questions.flatMap((item) => item.cluster.members.map((member) => member.observation_id)));
  const pages = brief.evidence.crawl.observed
    .filter((page) => pageIds.has(page.id))
    .map((page) => ({ id: page.id, url: page.final_url, excerpts: page.excerpts.map((excerpt) => ({ heading: excerpt.heading, text: excerpt.text })) }));
  const allFacts: readonly ProfileFact[] = brief.evidence.profile?.facts ?? [];
  const gapHome = gapAngleSectionId(brief);
  const gapAngle = brief.gap_angle.status === "available" && gapHome === planned.id ? { value: brief.gap_angle.value, rationale: brief.gap_angle.rationale } : null;
  const facts =
    settings.product_mention === "none"
      ? []
      : settings.product_mention === "gap_only"
        ? gapAngle !== null && brief.gap_angle.status === "available"
          ? allFacts.filter((fact) => brief.gap_angle.status === "available" && brief.gap_angle.profile_fact_refs.includes(fact.id))
          : []
        : [...allFacts];
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
  if (result.status === "ok") {
    return {
      section: {
        id: planned.id,
        h2: planned.h2,
        answers: answersOf(planned),
        status: "ok",
        body: { word_count: result.word_count, paragraphs: result.paragraphs },
        llm: { attempts: result.attempts, input_tokens: result.input_tokens, output_tokens: result.output_tokens },
      },
      call,
    };
  }
  return {
    section: {
      id: planned.id,
      h2: planned.h2,
      answers: answersOf(planned),
      status: "failed",
      fail_reason: result.fail_reason ?? "provider_error",
      llm: { attempts: result.attempts, input_tokens: result.input_tokens, output_tokens: result.output_tokens },
    },
    call,
  };
}

function skippedSection(planned: PlannedSection): DraftSection {
  return { id: planned.id, h2: planned.h2, answers: answersOf(planned), status: "skipped" };
}

function answersOf(planned: PlannedSection): [string, ...string[]] {
  const [first, ...rest] = planned.answers;
  return [first, ...rest];
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

interface AssembledRun {
  readonly result: DraftResult | null;
  readonly selfCheck: "ok" | "failed";
}

async function assembleAndCheck(
  brief: ContentBrief,
  settings: DraftResult["settings"],
  sections: readonly DraftSection[],
  calls: readonly SectionCallMeta[],
  dependencies: ContentDraftHandlerDependencies,
  clock: Clock,
  reranFrom: string | null,
  budgetMs: number,
): Promise<AssembledRun> {
  const coverage = await checkCoverage(brief, sections, dependencies, clock);
  const runId = dependencies.runId();
  const result = await assembleDraftResult({
    run: { run_id: runId, reran_from: reranFrom, collected_at: new Date(clock.start).toISOString(), elapsed_ms: Math.max(0, clock.now() - clock.start), budget_ms: budgetMs },
    brief,
    settings,
    sections,
    coverage: coverage.coverage,
    llmSections: aggregateSectionLlm(calls, CONTENT_DRAFT_LLM_TEMPERATURE),
    llmCoverage: coverage.llm,
  });
  const check = await parseDraftResult(result, brief);
  if (!check.ok) {
    dependencies.emit(JSON.stringify({ tool: TOOL, run_id: runId, self_check_failed: check.path, code: check.code }));
    return { result: null, selfCheck: "failed" };
  }
  dependencies.emit(
    JSON.stringify({
      tool: TOOL,
      run_id: runId,
      reran_from: reranFrom,
      mode: result.run.mode,
      elapsed_ms: result.run.elapsed_ms,
      sections: result.run.reads.sections,
      llm_calls: result.run.reads.llm_sections.calls + result.run.reads.llm_coverage.calls,
      coverage: result.coverage.status === "available" ? { total: result.coverage.total, covered: result.coverage.covered, partial: result.coverage.partial, none: result.coverage.none } : null,
      self_check: "ok",
    }),
  );
  return { result, selfCheck: "ok" };
}

/* ------------------------------------------------------------------ */
/* POST /api/tools/content-draft/run                                    */
/* ------------------------------------------------------------------ */

export async function handleContentDraftRunRequest(
  request: Request,
  dependencies: ContentDraftHandlerDependencies = CONTENT_DRAFT_HANDLER_DEPENDENCIES,
): Promise<Response> {
  const admitted = await admit(request, dependencies, DRAFT_TOTAL_BUDGET_MS, DRAFT_REQUEST_MAX_BYTES);
  if (admitted instanceof Response) return admitted;
  const { userId, clientIp, body, clock } = admitted;

  const settings = parseDraftSettings(body["settings"]);
  if (!settings.ok) return refuse("invalid_request", 400);
  const sectionIdsRaw = body["section_ids"];
  if (!Array.isArray(sectionIdsRaw) || sectionIdsRaw.some((id) => typeof id !== "string") || sectionIdsRaw.length === 0) {
    return refuse("invalid_request", 400);
  }
  const brief = await parseBriefOrRefuse(body["brief"]);
  if (brief instanceof Response) return brief;
  const plan = planSections(brief, sectionIdsRaw as string[]);
  if ("ok" in plan) return refuse(plan.code, 422);

  const slot = dependencies.acquireSlot(`${TOOL}:account:${userId}`);
  if (!slot.acquired) return refuse("rate_limited", 409, { "Retry-After": "5" });
  try {
    const refusal = await consumeBuckets(dependencies, clock, [
      [`public-${TOOL}:account:${userId}`, DRAFT_ACCOUNT_MAX_PER_HOUR],
      [`public-${TOOL}:ip:${clientIp}`, DRAFT_IP_MAX_PER_HOUR],
    ]);
    if (refusal !== null) return refusal;

    const outcomes = await Promise.all(plan.requested.map((planned) => generateOne(brief, planned, settings.value, dependencies, clock)));
    const byId = new Map(outcomes.map((outcome) => [outcome.section.id, outcome] as const));
    const sections: DraftSection[] = [];
    const calls: SectionCallMeta[] = [];
    for (const planned of [...plan.requested, ...plan.skipped].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
      const outcome = byId.get(planned.id);
      if (outcome === undefined) {
        sections.push(skippedSection(planned));
      } else {
        sections.push(outcome.section);
        if (outcome.call !== null) calls.push(outcome.call);
      }
    }
    orderByOutline(brief, sections);
    const assembled = await assembleAndCheck(brief, settings.value, sections, calls, dependencies, clock, null, DRAFT_TOTAL_BUDGET_MS);
    return assembled.result === null ? refuse("draft_unavailable", 503) : json(assembled.result, 200);
  } catch (error: unknown) {
    dependencies.emit(JSON.stringify({ tool: TOOL, unhandled: error instanceof Error ? error.name : typeof error }));
    return refuse("draft_unavailable", 503);
  } finally {
    slot.release();
  }
}

/** Sections are always in outline order, whatever order they were requested or generated in. */
function orderByOutline(brief: ContentBrief, sections: DraftSection[]): void {
  const order = new Map((brief.outline.status === "available" ? brief.outline.items : []).map((item, index) => [item.id, index] as const));
  sections.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/* ------------------------------------------------------------------ */
/* POST /api/tools/content-draft/section                                */
/* ------------------------------------------------------------------ */

export async function handleContentDraftSectionRequest(
  request: Request,
  dependencies: ContentDraftHandlerDependencies = CONTENT_DRAFT_HANDLER_DEPENDENCIES,
): Promise<Response> {
  const admitted = await admit(request, dependencies, SECTION_ENDPOINT_BUDGET_MS, SECTION_REQUEST_MAX_BYTES);
  if (admitted instanceof Response) return admitted;
  const { userId, clientIp, body, clock } = admitted;

  const settings = parseDraftSettings(body["settings"]);
  if (!settings.ok) return refuse("invalid_request", 400);
  const sectionId = body["section_id"];
  if (typeof sectionId !== "string" || sectionId === "") return refuse("invalid_request", 400);
  const brief = await parseBriefOrRefuse(body["brief"]);
  if (brief instanceof Response) return brief;
  const existing = parseDraftSections(body["sections"], brief);
  if (!existing.ok) return refuse(existing.code, existing.code === "invalid_request" ? 400 : 422);
  if (!brief.draft_readiness.writable.includes(sectionId)) return refuse("section_not_writable", 422);
  const target = existing.value.find((section) => section.id === sectionId);
  if (target === undefined || target.status === "skipped") return refuse("section_not_writable", 422);
  const previousRunId = typeof body["previous_run_id"] === "string" ? (body["previous_run_id"] as string) : null;

  const slot = dependencies.acquireSlot(`${TOOL}:account:${userId}`);
  if (!slot.acquired) return refuse("rate_limited", 409, { "Retry-After": "5" });
  try {
    const refusal = await consumeBuckets(dependencies, clock, [
      [`public-${TOOL}-section:account:${userId}`, SECTION_ACCOUNT_MAX_PER_HOUR],
      [`public-${TOOL}-section:ip:${clientIp}`, SECTION_IP_MAX_PER_HOUR],
    ]);
    if (refusal !== null) return refusal;

    const outline = brief.outline.status === "available" ? brief.outline.items.find((item) => item.id === sectionId) : undefined;
    if (outline === undefined) return refuse("section_not_writable", 422);
    const planned: PlannedSection = { id: outline.id, h2: outline.h2, h3: outline.h3, answers: outline.answers };
    const outcome = await generateOne(brief, planned, settings.value, dependencies, clock);
    const sections = existing.value.map((section) => (section.id === sectionId ? outcome.section : section));
    // Only this request's call is known here; the earlier sections' calls are not re-reported.
    const calls: SectionCallMeta[] = outcome.call === null ? [] : [outcome.call];
    const assembled = await assembleAndCheck(brief, settings.value, sections, calls, dependencies, clock, previousRunId, SECTION_ENDPOINT_BUDGET_MS);
    return assembled.result === null ? refuse("draft_unavailable", 503) : json(assembled.result, 200);
  } catch (error: unknown) {
    dependencies.emit(JSON.stringify({ tool: TOOL, unhandled: error instanceof Error ? error.name : typeof error }));
    return refuse("draft_unavailable", 503);
  } finally {
    slot.release();
  }
}
