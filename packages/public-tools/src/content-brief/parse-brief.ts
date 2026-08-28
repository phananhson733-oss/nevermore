// @input  -- an untrusted ContentBrief or ContentBriefHandoff: pasted JSON, an uploaded .json, a sessionStorage handoff, or a brief the server has just assembled
// @output -- a freshly built ContentBrief (never the input reference) or one closed failure code with the offending path
// @pos    -- the only exact parser of handoff §5.1: shape (parse-brief-shape.ts), then every field re-derived through assemble.ts and compared, then the recomputed fingerprint
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildCrawlReadMeta,
  buildDraftReadiness,
  buildFormatField,
  buildIntentField,
  buildLengthField,
  buildMustAnswerDraft,
  buildSerpObservations,
  deriveBriefRunMode,
  modelDerivedFrom,
  planCrawlTargets,
} from "./assemble.ts";
import { MIN_DIMENSION_COVERAGE } from "../gsc-analytics/page-reader.ts";
import { briefFingerprint } from "./canonical.ts";
import { GSC_PAGE_ROWS_MAX, OUTLINE_MIN_QUESTIONS, isWhitespaceTokenizedLanguage } from "./constants.ts";
import { CONTENT_BRIEF_HANDOFF_TTL_MS } from "./contract.ts";
import { hostKey } from "./host.ts";
import type {
  ContentBrief,
  ContentBriefHandoff,
  CrawlObservation,
  LlmReadMeta,
  MustAnswerItem,
  Origin,
  SerpObservation,
  Unavailable,
  UnavailableReason,
} from "./contract.ts";
import { at, decodeBriefShape, handoffEnvelope, isRecord, ok, reference } from "./parse-brief-shape.ts";
import type { ParseBriefFailure } from "./parse-brief-shape.ts";
import { deriveVerdictFromLedger, normalizeQuery } from "./verdict.ts";

export type { ParseBriefFailure } from "./parse-brief-shape.ts";

/* ------------------------------------------------------------------ */
/* public surface                                                       */
/* ------------------------------------------------------------------ */

export type ParseBriefResult = { readonly ok: true; readonly value: ContentBrief } | ParseBriefFailure;

export type ParseBriefHandoffResult =
  | { readonly ok: true; readonly value: ContentBriefHandoff }
  | ParseBriefFailure;

export interface ParseBriefDeps {
  /** Defaults to `briefFingerprint` from canonical.ts; tests inject a stand-in. */
  readonly fingerprint?: (brief: ContentBrief) => Promise<string>;
  /** Wall clock for the handoff window (`created_at <= now < expires_at`); defaults to Date.now. */
  readonly now?: () => number;
}

type Violation = ParseBriefFailure | null;

/* ------------------------------------------------------------------ */
/* recompute-and-compare                                                */
/*                                                                      */
/* A brief whose numbers merely agree with each other is not enough:    */
/* every derived field is rebuilt from the ledger with the same         */
/* assemble.ts function the producer used and compared key by key.      */
/* ------------------------------------------------------------------ */

/** Path of the first key where `actual` departs from `expected`, in `expected`'s key order. */
export function firstDifference(expected: unknown, actual: unknown, path: string): string | null {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return path;
    for (const [index, item] of expected.entries()) {
      const difference = firstDifference(item, actual[index], `${path}[${index}]`);
      if (difference !== null) return difference;
    }
    return null;
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return path;
    for (const [key, value] of Object.entries(expected)) {
      const difference = firstDifference(value, actual[key], at(path, key));
      if (difference !== null) return difference;
    }
    for (const key of Object.keys(actual)) {
      if (!Object.hasOwn(expected, key)) return at(path, key);
    }
    return null;
  }
  return Object.is(expected, actual) ? null : path;
}

export function recomputed(expected: unknown, actual: unknown, path: string): Violation {
  const difference = firstDifference(expected, actual, path);
  return difference === null ? null : reference(difference);
}

function unavailableOf(reason: UnavailableReason, attempted: number | null): Unavailable {
  return { status: "unavailable", reason, attempted };
}

/* ------------------------------------------------------------------ */
/* ledger                                                               */
/* ------------------------------------------------------------------ */

interface Ledger {
  readonly serpById: ReadonlyMap<string, SerpObservation>;
  readonly observedById: ReadonlyMap<string, CrawlObservation>;
  readonly questionIds: ReadonlySet<string>;
  readonly factIds: ReadonlySet<string>;
  readonly pageIds: ReadonlySet<string>;
}

function buildLedger(brief: ContentBrief): Ledger {
  return {
    serpById: new Map(brief.evidence.serp.map((row) => [row.id, row])),
    observedById: new Map(brief.evidence.crawl.observed.map((page) => [page.id, page])),
    questionIds: new Set(brief.must_answer.status === "available" ? brief.must_answer.items.map((item) => item.id) : []),
    factIds: new Set(brief.evidence.profile?.facts.map((fact) => fact.id) ?? []),
    pageIds: new Set(brief.evidence.gsc_pages.map((page) => page.id)),
  };
}

/** Equal as sets, and neither side may repeat a member. */
export function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const lefts = new Set(left);
  const rights = new Set(right);
  return (
    lefts.size === left.length &&
    rights.size === right.length &&
    lefts.size === rights.size &&
    left.every((value) => rights.has(value))
  );
}

function headingsAt(page: CrawlObservation, level: "h2" | "h3"): readonly string[] {
  return level === "h2" ? page.h2 : page.h3;
}

/* ------------------------------------------------------------------ */
/* SERP and crawl                                                       */
/* ------------------------------------------------------------------ */

/** Every row is re-classified from its url / title / domain; value and the ordered rules_hit must match. */
function checkSerp(brief: ContentBrief): Violation {
  const read = brief.run.reads.serp;
  const rows = brief.evidence.serp;
  if (read.status === "unavailable") return rows.length === 0 ? null : reference("evidence.serp");
  if (read.returned < 1 || read.returned > read.requested) return reference("run.reads.serp.returned");
  if ((read.status === "partial") !== (read.returned < read.requested || read.unresolved > 0)) {
    return reference("run.reads.serp.status");
  }
  if (rows.length !== read.returned) return reference("evidence.serp");
  const ranks = new Set<number>();
  for (const [index, row] of rows.entries()) {
    if (ranks.has(row.rank)) return reference(`evidence.serp[${index}].rank`);
    ranks.add(row.rank);
  }
  const rebuilt = buildSerpObservations(
    rows.map(({ rank, url, domain, title }) => ({ rank, url, domain, title })),
  );
  return recomputed(rebuilt, rows, "evidence.serp");
}

/** Every SERP id lands in exactly one of observed / failed / skipped, and each entry mirrors its row. */
function checkCrawlPartition(brief: ContentBrief, ledger: Ledger): Violation {
  const read = brief.run.reads.crawl;
  const { observed, failed, skipped } = brief.evidence.crawl;
  if (read.status === "unavailable") {
    return observed.length + failed.length + skipped.length === 0 ? null : reference("evidence.crawl");
  }
  if (brief.run.reads.serp.status === "unavailable") return reference("run.reads.crawl.status");
  const claimed = new Set<string>();
  const claim = (serpId: string, path: string): Violation => {
    if (!ledger.serpById.has(serpId) || claimed.has(serpId)) return reference(path);
    claimed.add(serpId);
    return null;
  };
  for (const [index, page] of observed.entries()) {
    const path = `evidence.crawl.observed[${index}]`;
    const violation = claim(page.serp_id, `${path}.serp_id`);
    if (violation !== null) return violation;
    if (page.id.slice(1) !== page.serp_id.slice(1)) return reference(`${path}.id`);
    if (ledger.serpById.get(page.serp_id)?.url !== page.url) return reference(`${path}.url`);
  }
  for (const [index, failure] of failed.entries()) {
    const path = `evidence.crawl.failed[${index}]`;
    const violation = claim(failure.serp_id, `${path}.serp_id`);
    if (violation !== null) return violation;
    if (ledger.serpById.get(failure.serp_id)?.url !== failure.url) return reference(`${path}.url`);
  }
  for (const [index, entry] of skipped.entries()) {
    const violation = claim(entry.serp_id, `evidence.crawl.skipped[${index}].serp_id`);
    if (violation !== null) return violation;
  }
  if (claimed.size !== ledger.serpById.size) return reference("evidence.crawl");
  // The skip list is re-planned from the SERP rows with the same host rule: order and content must match.
  return recomputed(planCrawlTargets(brief.evidence.serp, hostKey).skipped, skipped, "evidence.crawl.skipped");
}

/** Only an up-front budget exhaustion leaves a reachable SERP without a crawl read. */
const CRAWL_BUDGET_EXHAUSTED: Unavailable = { status: "unavailable", reason: "timeout", attempted: 0 };

function checkCrawlRead(brief: ContentBrief): Violation {
  const read = brief.run.reads.crawl;
  const serp = brief.run.reads.serp;
  const { observed, failed, skipped } = brief.evidence.crawl;
  if (read.status === "unavailable") {
    const expected =
      serp.status === "unavailable"
        ? buildCrawlReadMeta({ serpReturned: 0, observed: [], failed: [], skipped: [], started: false })
        : CRAWL_BUDGET_EXHAUSTED;
    return recomputed(expected, read, "run.reads.crawl");
  }
  const serpReturned = serp.status === "unavailable" ? 0 : serp.returned;
  return recomputed(
    buildCrawlReadMeta({ serpReturned, observed, failed, skipped, started: true }),
    read,
    "run.reads.crawl",
  );
}

function checkObservations(brief: ContentBrief): Violation {
  const whitespace = isWhitespaceTokenizedLanguage(brief.keyword.language);
  const seen = new Set<string>();
  for (const [index, page] of brief.evidence.crawl.observed.entries()) {
    const path = `evidence.crawl.observed[${index}]`;
    if (seen.has(page.id)) return reference(`${path}.id`);
    seen.add(page.id);
    if (!whitespace && page.word_count !== null) return reference(`${path}.word_count`);
    for (const [position, excerpt] of page.excerpts.entries()) {
      if (!headingsAt(page, excerpt.level).includes(excerpt.heading)) {
        return reference(`${path}.excerpts[${position}].heading`);
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* GSC, profile, verdict                                                */
/* ------------------------------------------------------------------ */

function checkGsc(brief: ContentBrief): Violation {
  const read = brief.run.reads.gsc;
  const { gsc_query_page: queryRows, gsc_pages: pages } = brief.evidence;
  if (read.status === "unavailable") {
    if (queryRows.length > 0) return reference("evidence.gsc_query_page");
    return pages.length === 0 ? null : reference("evidence.gsc_pages");
  }
  const unreadable = read.unreadable_rows;
  const partial = read.truncated.length > 0 || unreadable.query > 0 || unreadable.query_page > 0 || unreadable.page > 0;
  if ((read.status === "partial") !== partial) return reference("run.reads.gsc.status");
  const notInSample = read.primary_coverage.ratio === null && read.primary_coverage.reason === "query_not_in_sample";
  if ((read.matched_queries === 0) !== notInSample) return reference("run.reads.gsc.primary_coverage");
  // Rows first: a query that is not the primary keyword is a ledger error before it is a count error.
  const target = normalizeQuery(brief.keyword.primary);
  const pairs = new Set<string>();
  for (const [index, row] of queryRows.entries()) {
    if (normalizeQuery(row.query) !== target) return reference(`evidence.gsc_query_page[${index}].query`);
    const pair = JSON.stringify([row.query, row.page]);
    if (pairs.has(pair)) return reference(`evidence.gsc_query_page[${index}]`);
    pairs.add(pair);
  }
  if (new Set(queryRows.map((row) => row.query)).size > read.matched_queries) {
    return reference("run.reads.gsc.matched_queries");
  }
  if (read.rows.page < pages.length || pages.length > Math.min(read.rows.page, GSC_PAGE_ROWS_MAX)) {
    return reference("run.reads.gsc.rows.page");
  }
  if (read.rows.query_page < queryRows.length) return reference("run.reads.gsc.rows.query_page");
  const ids = new Set<string>();
  for (const [index, page] of pages.entries()) {
    if (ids.has(page.id)) return reference(`evidence.gsc_pages[${index}].id`);
    ids.add(page.id);
  }
  return null;
}

function checkProfile(brief: ContentBrief): Violation {
  const complete = brief.run.reads.product_profile.status === "complete";
  if ((brief.evidence.profile !== null) !== complete) return reference("evidence.profile");
  const ids = new Set<string>();
  for (const [index, fact] of (brief.evidence.profile?.facts ?? []).entries()) {
    if (ids.has(fact.id)) return reference(`evidence.profile.facts[${index}].id`);
    ids.add(fact.id);
  }
  return null;
}

/** The whole verdict is re-derived from reads.gsc and the ledger rows through verdict.ts's decision table. */
function checkVerdict(brief: ContentBrief): Violation {
  const expected = deriveVerdictFromLedger({
    reads: brief.run.reads.gsc,
    rows: brief.evidence.gsc_query_page,
    minDimensionCoverage: MIN_DIMENSION_COVERAGE,
  });
  return recomputed(expected, brief.verdict, "verdict");
}

/* ------------------------------------------------------------------ */
/* derived fields                                                       */
/* ------------------------------------------------------------------ */

function checkDerivedFields(brief: ContentBrief): Violation {
  const { serp, crawl } = brief.run.reads;
  const rows = brief.evidence.serp;
  const observed = brief.evidence.crawl.observed;
  return (
    recomputed(buildIntentField(rows, serp, brief.keyword.primary), brief.intent, "intent") ??
    recomputed(buildFormatField(rows, serp), brief.format, "format") ??
    recomputed(buildLengthField(observed, crawl, brief.keyword.language), brief.length, "length")
  );
}

/** assemble.ts computes what the model was fed from the same ledger the brief carries. */
function expectedDerivedFrom(brief: ContentBrief): readonly Origin[] {
  return modelDerivedFrom(brief.evidence.profile?.facts ?? null, brief.evidence.gsc_pages);
}

function checkModelProvenance(
  brief: ContentBrief,
  provenance: { readonly method: "model"; readonly derived_from: readonly Origin[] },
  path: string,
): Violation {
  if (brief.run.reads.llm.status !== "complete") return reference(path);
  return recomputed(expectedDerivedFrom(brief), provenance.derived_from, `${path}.derived_from`);
}

function skeletonOf(item: MustAnswerItem): Pick<MustAnswerItem, "id" | "cluster" | "covered_by"> {
  return { id: item.id, cluster: item.cluster, covered_by: item.covered_by };
}

function checkQuestion(brief: ContentBrief, item: MustAnswerItem, path: string): Violation {
  if (item.q_provenance.method === "heuristic") {
    return item.q === item.cluster.canonical_heading ? null : reference(`${path}.q`);
  }
  return checkModelProvenance(brief, item.q_provenance, `${path}.q_provenance`);
}

/** Clusters are re-derived from the observed headings; only q / q_provenance are the model's to change. */
function checkMustAnswer(brief: ContentBrief): Violation {
  const draft = buildMustAnswerDraft({
    serp: brief.evidence.serp,
    observed: brief.evidence.crawl.observed,
    crawlReads: brief.run.reads.crawl,
    language: brief.keyword.language,
  });
  const field = brief.must_answer;
  const expectedBudget = {
    must_answer_candidates: draft.candidates,
    must_answer_shown: draft.field.status === "available" ? draft.field.items.length : 0,
    must_answer_hidden: draft.hidden,
  };
  const actualBudget = {
    must_answer_candidates: brief.budget.must_answer_candidates,
    must_answer_shown: brief.budget.must_answer_shown,
    must_answer_hidden: brief.budget.must_answer_hidden,
  };
  if (draft.field.status === "unavailable" || field.status === "unavailable") {
    return recomputed(draft.field, field, "must_answer") ?? recomputed(expectedBudget, actualBudget, "budget");
  }
  const skeleton =
    recomputed(
      { status: "available", items: draft.field.items.map(skeletonOf) },
      { status: "available", items: field.items.map(skeletonOf) },
      "must_answer",
    ) ?? recomputed(expectedBudget, actualBudget, "budget");
  if (skeleton !== null) return skeleton;
  for (const [index, item] of field.items.entries()) {
    const violation = checkQuestion(brief, item, `must_answer.items[${index}]`);
    if (violation !== null) return violation;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* model-written fields: the unavailable gates of applyModelOutput      */
/* ------------------------------------------------------------------ */

type Gate = Unavailable | null;

function llmGate(llm: LlmReadMeta): Unavailable {
  return llm.status === "unavailable"
    ? unavailableOf(llm.reason, llm.attempted)
    : unavailableOf("validation_failed", llm.calls);
}

function outlineGate(brief: ContentBrief): Gate {
  const questions = brief.must_answer;
  if (questions.status === "unavailable") return unavailableOf(questions.reason, questions.attempted);
  if (questions.items.length < OUTLINE_MIN_QUESTIONS) return unavailableOf("insufficient_evidence", questions.items.length);
  return null;
}

function gapAngleGate(brief: ContentBrief): Gate {
  const profile = brief.run.reads.product_profile;
  if (profile.status === "unavailable") return unavailableOf(profile.reason, profile.attempted);
  if ((brief.evidence.profile?.facts.length ?? 0) === 0) return unavailableOf("insufficient_evidence", 0);
  // "Competitors do not cover this" needs competitors: no observed page, no claim (applyModelOutput).
  return brief.evidence.crawl.observed.length === 0 ? unavailableOf("insufficient_evidence", 0) : null;
}

function pagesGate(brief: ContentBrief): Gate {
  const gsc = brief.run.reads.gsc;
  if (gsc.status === "unavailable") return unavailableOf(gsc.reason, gsc.attempted);
  if (brief.evidence.gsc_pages.length > 0) return null;
  return gsc.unreadable_rows.page > 0
    ? unavailableOf("provider_error", gsc.unreadable_rows.page)
    : unavailableOf("insufficient_evidence", 0);
}

type ModelField = { readonly status: "available" } | Unavailable;

/** A closed gate fixes the exact Unavailable; an open gate allows available or exactly the LLM read's failure. */
function checkModelField(brief: ContentBrief, name: string, field: ModelField, gate: Gate): Violation {
  if (gate !== null) return recomputed(gate, field, name);
  if (field.status === "unavailable") return recomputed(llmGate(brief.run.reads.llm), field, name);
  return brief.run.reads.llm.status === "complete" ? null : reference(`${name}.status`);
}

function checkOutline(brief: ContentBrief, ledger: Ledger): Violation {
  const { outline } = brief;
  const gated = checkModelField(brief, "outline", outline, outlineGate(brief));
  if (gated !== null || outline.status === "unavailable") return gated;
  const answered = new Set<string>();
  for (const [index, item] of outline.items.entries()) {
    const path = `outline.items[${index}]`;
    if (item.id !== `O${index + 1}`) return reference(`${path}.id`);
    for (const [position, answer] of item.answers.entries()) {
      if (!ledger.questionIds.has(answer) || answered.has(answer)) return reference(`${path}.answers[${position}]`);
      answered.add(answer);
    }
    const provenance = checkModelProvenance(brief, item.provenance, `${path}.provenance`);
    if (provenance !== null) return provenance;
  }
  // Every question is answered by exactly one section: a dropped Q would silently leave the draft uncovered.
  return answered.size === ledger.questionIds.size ? null : reference("outline.items");
}

function checkGapAngle(brief: ContentBrief, ledger: Ledger): Violation {
  const field = brief.gap_angle;
  const gated = checkModelField(brief, "gap_angle", field, gapAngleGate(brief));
  if (gated !== null || field.status === "unavailable") return gated;
  const refs = new Set<string>();
  for (const [index, ref] of field.profile_fact_refs.entries()) {
    if (!ledger.factIds.has(ref) || refs.has(ref)) return reference(`gap_angle.profile_fact_refs[${index}]`);
    refs.add(ref);
  }
  if (!sameSet(field.checked_against, [...ledger.observedById.keys()])) return reference("gap_angle.checked_against");
  return checkModelProvenance(brief, field.provenance, "gap_angle.provenance");
}

type PageRefField =
  | {
      readonly status: "available";
      readonly items: readonly {
        readonly page_ref: string;
        readonly why_provenance?: { readonly method: "model"; readonly derived_from: readonly Origin[] };
        readonly topic_provenance?: { readonly method: "model"; readonly derived_from: readonly Origin[] };
      }[];
    }
  | Unavailable;

function checkPageRefs(brief: ContentBrief, ledger: Ledger, name: string, field: PageRefField): Violation {
  const gated = checkModelField(brief, name, field, pagesGate(brief));
  if (gated !== null || field.status === "unavailable") return gated;
  const seen = new Set<string>();
  for (const [index, item] of field.items.entries()) {
    const path = `${name}.items[${index}]`;
    if (!ledger.pageIds.has(item.page_ref) || seen.has(item.page_ref)) return reference(`${path}.page_ref`);
    seen.add(item.page_ref);
    const provenance = item.why_provenance ?? item.topic_provenance;
    const key = item.why_provenance !== undefined ? "why_provenance" : "topic_provenance";
    if (provenance === undefined) return reference(`${path}.${key}`);
    const violation = checkModelProvenance(brief, provenance, `${path}.${key}`);
    if (violation !== null) return violation;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* readiness and mode                                                   */
/* ------------------------------------------------------------------ */

function checkReadiness(brief: ContentBrief): Violation {
  const { product_profile: profile, gsc, llm } = brief.run.reads;
  return recomputed(
    buildDraftReadiness({ outline: brief.outline, profile, gsc, llm }),
    brief.draft_readiness,
    "draft_readiness",
  );
}

function checkMode(brief: ContentBrief): Violation {
  const mode = deriveBriefRunMode({
    reads: brief.run.reads,
    fields: [
      brief.intent,
      brief.format,
      brief.length,
      brief.must_answer,
      brief.outline,
      brief.gap_angle,
      brief.internal_links,
      brief.do_not_cover,
    ],
  });
  return mode === brief.run.mode ? null : reference("run.mode");
}

function firstViolation(brief: ContentBrief): Violation {
  const ledger = buildLedger(brief);
  return (
    checkSerp(brief) ??
    checkCrawlPartition(brief, ledger) ??
    checkCrawlRead(brief) ??
    checkObservations(brief) ??
    checkGsc(brief) ??
    checkProfile(brief) ??
    checkVerdict(brief) ??
    checkDerivedFields(brief) ??
    checkMustAnswer(brief) ??
    checkOutline(brief, ledger) ??
    checkGapAngle(brief, ledger) ??
    checkPageRefs(brief, ledger, "internal_links", brief.internal_links) ??
    checkPageRefs(brief, ledger, "do_not_cover", brief.do_not_cover) ??
    checkReadiness(brief) ??
    checkMode(brief)
  );
}

/* ------------------------------------------------------------------ */
/* entry points                                                         */
/* ------------------------------------------------------------------ */

function prefixed(failure: ParseBriefFailure, path: string): ParseBriefFailure {
  return path === "" ? failure : { ...failure, path: at(path, failure.path) };
}

function decodeBrief(input: unknown, path: string): ParseBriefResult {
  const shaped = decodeBriefShape(input, path);
  if (!shaped.ok) return shaped;
  const violation = firstViolation(shaped.value);
  return violation === null ? shaped : prefixed(violation, path);
}

async function verifyFingerprint(brief: ContentBrief, path: string, deps: ParseBriefDeps): Promise<ParseBriefResult> {
  const expected = await (deps.fingerprint ?? briefFingerprint)(brief);
  return expected === brief.run.fingerprint
    ? ok(brief)
    : { ok: false, code: "brief_fingerprint_mismatch", path: at(path, "run.fingerprint") };
}

/**
 * Shape, caps and every invariant, without recomputing the fingerprint. For
 * a server checking the brief it has just assembled; the three client
 * entrances must use `parseContentBrief`.
 */
export function parseContentBriefShape(input: unknown): ParseBriefResult {
  return decodeBrief(input, "");
}

/** The exact parser of handoff §5.1: shape, invariants, then the recomputed fingerprint. */
export async function parseContentBrief(input: unknown, deps: ParseBriefDeps = {}): Promise<ParseBriefResult> {
  const shaped = decodeBrief(input, "");
  return shaped.ok ? verifyFingerprint(shaped.value, "", deps) : shaped;
}

/** sessionStorage handoff: envelope, TTL pin, then the full brief parse under the `brief.` path. */
export async function parseContentBriefHandoff(
  input: unknown,
  deps: ParseBriefDeps = {},
): Promise<ParseBriefHandoffResult> {
  const envelope = handoffEnvelope(input, "");
  if (!envelope.ok) return envelope;
  const { version, created_at, expires_at } = envelope.value;
  if (expires_at !== created_at + CONTENT_BRIEF_HANDOFF_TTL_MS) return reference("expires_at");
  const now = (deps.now ?? Date.now)();
  if (created_at > now) return reference("created_at");
  if (now >= expires_at) return reference("expires_at");
  const shaped = decodeBrief(envelope.value.brief, "brief");
  if (!shaped.ok) return shaped;
  const verified = await verifyFingerprint(shaped.value, "brief", deps);
  return verified.ok ? ok({ version, created_at, expires_at, brief: verified.value }) : verified;
}
