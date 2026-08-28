// @input  -- a verified Supabase user id, a finished visibility report, and service-role reads plus the record RPC
// @output -- one append-only run summary per run, and the previous run of the same frozen question set
// @pos    -- the only server module that reads or writes marketing_geo_visibility_runs

import { createAdminSupabaseClient } from "../supabase/admin.ts";
import type { GeoQuestionLayer, GeoQuestionMode } from "./kb-questions.ts";
import {
  GEO_VISIBILITY_SCHEMA_VERSION,
  type VisibilityCitedDomain,
  type VisibilityMetrics,
  type VisibilityProportion,
  type VisibilityReport,
  type VisibilityRunManifest,
  type VisibilityRunStatus,
} from "./visibility-contract.ts";

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * What one read or RPC call returned.
 *
 * The provider's error message is deliberately absent rather than carried and
 * then ignored: a message that never enters this module cannot be put into an
 * HTTP response by a later edit.
 */
export type VisibilityTransportOutcome =
  | { readonly kind: "ok"; readonly data: unknown }
  | { readonly kind: "error"; readonly code: string | null };

export interface VisibilityStoreDependencies {
  /**
   * The run a comparison is anchored to, if the caller named one.
   *
   * Read separately from the baseline because the cursor is a run id and the
   * ordering is by time: the anchor's own timestamp is what the baseline query
   * needs, and it has to be the database's spelling of it rather than a
   * re-formatted copy.
   */
  readonly readRunAnchor: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly runId: string;
  }) => Promise<VisibilityTransportOutcome>;
  readonly readLatestRun: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly questionSetHash: string;
    /** The database's own timestamp text, or null for "the newest run". */
    readonly before: string | null;
  }) => Promise<VisibilityTransportOutcome>;
  readonly callRpc: (
    name: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<VisibilityTransportOutcome>;
}

/* ------------------------------------------------------------------ */
/* Shapes returned to callers                                          */
/* ------------------------------------------------------------------ */

/**
 * One question's counts, without its answers.
 *
 * This is the whole reason `recordVisibilityRun` takes a report rather than a
 * row: the projection to these fields happens here, so the excerpts a sample
 * carries have no path into the database at all. Enforcing it by construction
 * beats enforcing it by remembering.
 */
export interface VisibilityQuestionCounts {
  readonly questionId: string;
  readonly text: string;
  readonly layer: GeoQuestionLayer;
  readonly mode: GeoQuestionMode;
  readonly answered: number;
  readonly mentioned: number;
  readonly citationEvaluable: number;
  readonly cited: number;
}

export interface VisibilityRunRef {
  readonly runId: string;
  readonly kbId: string;
  readonly snapshotId: string;
  readonly questionSetHash: string;
  readonly samplesPerQuestion: number;
  readonly createdAt: string;
}

export interface StoredVisibilityRun extends VisibilityRunRef {
  readonly manifest: VisibilityRunManifest;
  readonly metrics: VisibilityMetrics;
  readonly perQuestion: readonly VisibilityQuestionCounts[];
  readonly citedDomains: readonly VisibilityCitedDomain[];
}

export type VisibilityStoreInvalidCode =
  | "invalid_kb_id"
  | "invalid_snapshot_id"
  | "invalid_run_id"
  | "invalid_question_set_hash"
  | "invalid_manifest"
  | "run_too_large"
  | "question_set_mismatch";

export type VisibilityStoreResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** No such run, or it is not this account's. The two are not distinguished. */
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly code: VisibilityStoreInvalidCode }
  /** `reason` is one of `VISIBILITY_STORE_REASONS` or a provider error code. */
  | { readonly kind: "unavailable"; readonly reason: string };

export const VISIBILITY_STORE_REASONS = {
  unavailable: "store_unavailable",
  malformedResponse: "malformed_store_response",
  malformedRun: "malformed_visibility_run",
} as const;

/* ------------------------------------------------------------------ */
/* Column budgets                                                      */
/* ------------------------------------------------------------------ */

/**
 * The same ceilings the column checks carry.
 *
 * Checked here so an oversized run comes back as a code the caller can render
 * instead of an opaque constraint violation. The two measurements are close
 * but not identical - Postgres measures its own `jsonb::text`, which
 * renormalizes numbers and key order - so this is a guard rail and the column
 * check is still the authority.
 */
const COLUMN_BYTE_LIMITS = {
  manifest: 8_192,
  metrics: 32_768,
  perQuestion: 262_144,
  citedDomains: 262_144,
} as const;

const MAX_SAMPLES_PER_QUESTION = 50;

/* ------------------------------------------------------------------ */
/* Supabase adapter                                                    */
/* ------------------------------------------------------------------ */

const RUN_COLUMNS =
  "id,user_id,kb_id,snapshot_id,question_set_hash,samples_per_question,manifest,metrics,per_question,cited_domains,created_at";
const ANCHOR_COLUMNS = "id,user_id,kb_id,question_set_hash,created_at";

function transport(
  data: unknown,
  error: { readonly code?: string } | null | undefined,
): VisibilityTransportOutcome {
  return error === null || error === undefined
    ? { kind: "ok", data }
    : { kind: "error", code: typeof error.code === "string" ? error.code : null };
}

async function readRunAnchorViaSupabase(input: {
  readonly userId: string;
  readonly kbId: string;
  readonly runId: string;
}): Promise<VisibilityTransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("marketing_geo_visibility_runs")
      .select(ANCHOR_COLUMNS)
      .eq("user_id", input.userId)
      .eq("kb_id", input.kbId)
      .eq("id", input.runId)
      .maybeSingle();
    return transport(data, error);
  } catch {
    return { kind: "error", code: null };
  }
}

async function readLatestRunViaSupabase(input: {
  readonly userId: string;
  readonly kbId: string;
  readonly questionSetHash: string;
  readonly before: string | null;
}): Promise<VisibilityTransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const scoped = client
      .from("marketing_geo_visibility_runs")
      .select(RUN_COLUMNS)
      .eq("user_id", input.userId)
      .eq("kb_id", input.kbId)
      .eq("question_set_hash", input.questionSetHash);
    // Strictly earlier, so the anchor cannot be its own baseline. Two runs
    // written in the same microsecond would hide each other here; a run takes
    // minutes and the daily cap is five, so that tie cannot arise, and if it
    // somehow did the page would show no baseline rather than a wrong one.
    const filtered =
      input.before === null ? scoped : scoped.lt("created_at", input.before);
    const { data, error } = await filtered
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    return transport(data, error);
  } catch {
    return { kind: "error", code: null };
  }
}

async function callRpcViaSupabase(
  name: string,
  params: Readonly<Record<string, unknown>>,
): Promise<VisibilityTransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client.rpc(name, params);
    return transport(data, error);
  } catch {
    return { kind: "error", code: null };
  }
}

export const DEFAULT_VISIBILITY_STORE_DEPENDENCIES: VisibilityStoreDependencies =
  {
    readRunAnchor: readRunAnchorViaSupabase,
    readLatestRun: readLatestRunViaSupabase,
    callRpc: callRpcViaSupabase,
  };

/* ------------------------------------------------------------------ */
/* Reading rows nobody is allowed to trust                             */
/* ------------------------------------------------------------------ */

/**
 * A stored value this module refuses to hand on.
 *
 * Carries a code of this module's own vocabulary; the value that failed is
 * never attached, so nothing here can end up in a response or a log line.
 */
class StoredValueError extends Error {
  readonly reason: string;
  readonly detail: string;

  constructor(reason: string, detail: string) {
    super("stored value rejected");
    this.reason = reason;
    this.detail = detail;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
/**
 * PostgREST spells `timestamptz` with an offset and up to six fractional
 * digits, which `Date.prototype.toISOString` does not produce. Reading the
 * database format and writing the JSON one are two different jobs, so the
 * shape is checked before the value is converted rather than after.
 */
const DB_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;

const RUN_STATUSES: ReadonlySet<string> = new Set([
  "ok",
  "partial",
  "insufficient",
]);
const QUESTION_LAYERS: ReadonlySet<string> = new Set([
  "problem",
  "discovery",
  "comparison",
  "evaluation",
  "branded",
]);
const QUESTION_MODES: ReadonlySet<string> = new Set(["retrieval", "demand"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): readonly Record<string, unknown>[] | null {
  return Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry),
    )
    ? (value as readonly Record<string, unknown>[])
    : null;
}

function malformed(detail: string): StoredValueError {
  return new StoredValueError(
    VISIBILITY_STORE_REASONS.malformedResponse,
    detail,
  );
}

function badRun(detail: string): StoredValueError {
  return new StoredValueError(VISIBILITY_STORE_REASONS.malformedRun, detail);
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw malformed(key);
  return value;
}

function requiredUuid(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key);
  if (!UUID_PATTERN.test(value)) throw malformed(key);
  return value;
}

function requiredHash(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key);
  if (!HASH_PATTERN.test(value)) throw malformed(key);
  return value;
}

function requiredDbTimestamp(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key);
  if (!DB_TIMESTAMP_PATTERN.test(value)) throw malformed(key);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw malformed(key);
  return new Date(parsed).toISOString();
}

function requiredCount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isInteger(value) || (value as number) < 0) throw badRun(key);
  return value as number;
}

function requiredInstant(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw badRun(key);
  }
  return value;
}

function nullableFinite(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw badRun(key);
  return value;
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") throw badRun(key);
  return value;
}

function stringList(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value)) throw badRun(key);
  return value.map((entry) => {
    if (typeof entry !== "string") throw badRun(key);
    return entry;
  });
}

/** UUID text case is not identity, so ownership is compared case-blind. */
function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function proportionFrom(value: unknown, key: string): VisibilityProportion {
  const row = record(value);
  if (row === null) throw badRun(key);
  const successes = requiredCount(row, "successes");
  const trials = requiredCount(row, "trials");
  // A proportion whose numerator exceeds its denominator is not a rounding
  // problem; it is a number that would render as more than 100% next to a
  // confidence interval that says otherwise.
  if (successes > trials) throw badRun(key);
  return {
    successes,
    trials,
    point: nullableFinite(row, "point"),
    lo: nullableFinite(row, "lo"),
    hi: nullableFinite(row, "hi"),
  };
}

function manifestFrom(value: unknown): VisibilityRunManifest {
  const row = record(value);
  if (row === null) throw badRun("manifest");
  if (row.schemaVersion !== GEO_VISIBILITY_SCHEMA_VERSION) {
    throw badRun("schemaVersion");
  }
  const status = requiredString(row, "status");
  if (!RUN_STATUSES.has(status)) throw badRun("status");
  return {
    schemaVersion: GEO_VISIBILITY_SCHEMA_VERSION,
    kbId: requiredUuid(row, "kbId"),
    snapshotId: requiredUuid(row, "snapshotId"),
    snapshotRevision: requiredCount(row, "snapshotRevision"),
    questionSetHash: requiredHash(row, "questionSetHash"),
    questionCount: requiredCount(row, "questionCount"),
    samplesPerQuestion: requiredCount(row, "samplesPerQuestion"),
    marketCode: requiredString(row, "marketCode"),
    model: requiredString(row, "model"),
    startedAt: requiredInstant(row, "startedAt"),
    finishedAt: requiredInstant(row, "finishedAt"),
    calls: requiredCount(row, "calls"),
    answered: requiredCount(row, "answered"),
    successRatio: nullableFinite(row, "successRatio") ?? 0,
    costUsd: nullableFinite(row, "costUsd"),
    status: status as VisibilityRunStatus,
  };
}

function metricsFrom(value: unknown): VisibilityMetrics {
  const row = record(value);
  if (row === null) throw badRun("metrics");
  const layers = records(row.byLayer);
  if (layers === null) throw badRun("byLayer");
  return {
    unpromptedMention: proportionFrom(row.unpromptedMention, "unpromptedMention"),
    promptedMention: proportionFrom(row.promptedMention, "promptedMention"),
    citation: proportionFrom(row.citation, "citation"),
    questionsMentioned: proportionFrom(
      row.questionsMentioned,
      "questionsMentioned",
    ),
    byLayer: layers.map((entry) => {
      const layer = requiredString(entry, "layer");
      if (!QUESTION_LAYERS.has(layer)) throw badRun("layer");
      return {
        layer: layer as GeoQuestionLayer,
        mention: proportionFrom(entry.mention, "mention"),
        citation: proportionFrom(entry.citation, "citation"),
      };
    }),
  };
}

function questionCountsFrom(value: unknown): readonly VisibilityQuestionCounts[] {
  const rows = records(value);
  if (rows === null) throw badRun("per_question");
  const seen = new Set<string>();
  return rows.map((row) => {
    const layer = requiredString(row, "layer");
    const mode = requiredString(row, "mode");
    if (!QUESTION_LAYERS.has(layer) || !QUESTION_MODES.has(mode)) {
      throw badRun("per_question");
    }
    const questionId = requiredString(row, "questionId");
    // Two rows for one question would let a comparison count the same question
    // twice, which is exactly the denominator error the question-level rate
    // exists to avoid.
    if (seen.has(questionId)) throw badRun("questionId");
    seen.add(questionId);
    const answered = requiredCount(row, "answered");
    const mentioned = requiredCount(row, "mentioned");
    const citationEvaluable = requiredCount(row, "citationEvaluable");
    const cited = requiredCount(row, "cited");
    if (
      mentioned > answered ||
      citationEvaluable > answered ||
      cited > citationEvaluable
    ) {
      throw badRun("per_question");
    }
    return {
      questionId,
      text: requiredString(row, "text"),
      layer: layer as GeoQuestionLayer,
      mode: mode as GeoQuestionMode,
      answered,
      mentioned,
      citationEvaluable,
      cited,
    };
  });
}

function citedDomainsFrom(value: unknown): readonly VisibilityCitedDomain[] {
  const rows = records(value);
  if (rows === null) throw badRun("cited_domains");
  return rows.map((row) => ({
    domain: requiredString(row, "domain"),
    answers: requiredCount(row, "answers"),
    isOwn: requiredBoolean(row, "isOwn"),
    isCompetitor: requiredBoolean(row, "isCompetitor"),
    sampleUrls: stringList(row.sampleUrls, "sampleUrls"),
  }));
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

function unavailable(
  reason: string,
  detail: string | null,
): VisibilityStoreResult<never> {
  console.error("[geo-visibility-store] unavailable", { reason, detail });
  return { kind: "unavailable", reason };
}

function transportFailure(outcome: {
  readonly code: string | null;
}): VisibilityStoreResult<never> {
  return unavailable(outcome.code ?? VISIBILITY_STORE_REASONS.unavailable, null);
}

function storedValueFailure(error: unknown): VisibilityStoreResult<never> {
  return error instanceof StoredValueError
    ? unavailable(error.reason, error.detail)
    : unavailable(VISIBILITY_STORE_REASONS.malformedResponse, null);
}

/**
 * Run one dependency call without letting it throw.
 *
 * The rejection value is not bound: a provider stack trace cannot become part
 * of a result that a route will serialize.
 */
async function attempt(
  run: () => Promise<VisibilityTransportOutcome>,
): Promise<VisibilityTransportOutcome> {
  try {
    return await run();
  } catch {
    return { kind: "error", code: null };
  }
}

/** `returns table` reaches PostgREST as an array, so anything else is malformed. */
function rpcRow(data: unknown): Record<string, unknown> | null {
  return records(data)?.[0] ?? null;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Store the summary of a finished run.
 *
 * The identity of the run is read out of the manifest rather than passed
 * alongside it, so the row and the manifest inside it cannot disagree about
 * which knowledge base and which frozen version were asked.
 */
export async function recordVisibilityRun(
  input: {
    readonly userId: string;
    readonly report: VisibilityReport;
  },
  dependencies: VisibilityStoreDependencies = DEFAULT_VISIBILITY_STORE_DEPENDENCIES,
): Promise<VisibilityStoreResult<VisibilityRunRef>> {
  const { manifest, metrics, questions, citedDomains } = input.report;
  if (manifest.schemaVersion !== GEO_VISIBILITY_SCHEMA_VERSION) {
    return { kind: "invalid", code: "invalid_manifest" };
  }
  if (!UUID_PATTERN.test(manifest.kbId)) {
    return { kind: "invalid", code: "invalid_kb_id" };
  }
  if (!UUID_PATTERN.test(manifest.snapshotId)) {
    return { kind: "invalid", code: "invalid_snapshot_id" };
  }
  if (!HASH_PATTERN.test(manifest.questionSetHash)) {
    return { kind: "invalid", code: "invalid_question_set_hash" };
  }
  if (
    !Number.isInteger(manifest.samplesPerQuestion) ||
    manifest.samplesPerQuestion < 1 ||
    manifest.samplesPerQuestion > MAX_SAMPLES_PER_QUESTION
  ) {
    return { kind: "invalid", code: "invalid_manifest" };
  }

  // The projection that keeps answer text out of the database. `samples` -
  // which carries the excerpt each mention was found in - is dropped here and
  // has no other path to a column.
  const perQuestion: readonly VisibilityQuestionCounts[] = questions.map(
    (question) => ({
      questionId: question.questionId,
      text: question.text,
      layer: question.layer,
      mode: question.mode,
      answered: question.answered,
      mentioned: question.mentioned,
      citationEvaluable: question.citationEvaluable,
      cited: question.cited,
    }),
  );

  const sizes = {
    manifest: byteLength(manifest),
    metrics: byteLength(metrics),
    perQuestion: byteLength(perQuestion),
    citedDomains: byteLength(citedDomains),
  } as const;
  for (const key of ["manifest", "metrics", "perQuestion", "citedDomains"] as const) {
    if (sizes[key] > COLUMN_BYTE_LIMITS[key]) {
      return { kind: "invalid", code: "run_too_large" };
    }
  }

  const outcome = await attempt(() =>
    dependencies.callRpc("marketing_geo_record_visibility_run", {
      p_user_id: input.userId,
      p_kb_id: manifest.kbId,
      p_snapshot_id: manifest.snapshotId,
      p_question_set_hash: manifest.questionSetHash,
      p_samples_per_question: manifest.samplesPerQuestion,
      p_manifest: manifest,
      p_metrics: metrics,
      p_per_question: perQuestion,
      p_cited_domains: citedDomains,
    }),
  );
  if (outcome.kind === "error") return transportFailure(outcome);
  const row = rpcRow(outcome.data);
  if (row === null || typeof row.outcome !== "string") {
    return unavailable(
      VISIBILITY_STORE_REASONS.malformedResponse,
      "record_visibility_run",
    );
  }
  if (row.outcome === "not_found") return { kind: "missing" };
  if (row.outcome === "question_set_mismatch") {
    return { kind: "invalid", code: "question_set_mismatch" };
  }
  if (row.outcome !== "recorded") {
    return unavailable(
      VISIBILITY_STORE_REASONS.malformedResponse,
      "record_visibility_run",
    );
  }
  try {
    return {
      kind: "ok",
      value: {
        runId: requiredUuid(row, "run_id"),
        kbId: manifest.kbId,
        snapshotId: manifest.snapshotId,
        questionSetHash: manifest.questionSetHash,
        samplesPerQuestion: manifest.samplesPerQuestion,
        createdAt: requiredDbTimestamp(row, "recorded_at"),
      },
    };
  } catch (error) {
    return storedValueFailure(error);
  }
}

function storedRunFromRow(
  row: Record<string, unknown>,
  input: { readonly userId: string; readonly kbId: string; readonly questionSetHash: string },
): StoredVisibilityRun {
  if (!sameUuid(requiredUuid(row, "user_id"), input.userId)) {
    throw malformed("user_id");
  }
  if (!sameUuid(requiredUuid(row, "kb_id"), input.kbId)) {
    throw malformed("kb_id");
  }
  const questionSetHash = requiredHash(row, "question_set_hash");
  // A read scoped to one question set that answers with another one is a
  // scoping failure, and saying so is cheaper than trusting the filter.
  if (questionSetHash !== input.questionSetHash) throw malformed("question_set_hash");
  const samplesPerQuestion = requiredCount(row, "samples_per_question");
  if (samplesPerQuestion < 1 || samplesPerQuestion > MAX_SAMPLES_PER_QUESTION) {
    throw malformed("samples_per_question");
  }
  const manifest = manifestFrom(row.manifest);
  // The row's own columns and the manifest inside it describe the same run, so
  // a disagreement means one of them was written by something this version
  // cannot reason about.
  if (
    !sameUuid(manifest.kbId, input.kbId) ||
    manifest.questionSetHash !== questionSetHash ||
    manifest.samplesPerQuestion !== samplesPerQuestion ||
    !sameUuid(manifest.snapshotId, requiredUuid(row, "snapshot_id"))
  ) {
    throw badRun("manifest");
  }
  return {
    runId: requiredUuid(row, "id"),
    kbId: manifest.kbId,
    snapshotId: manifest.snapshotId,
    questionSetHash,
    samplesPerQuestion,
    createdAt: requiredDbTimestamp(row, "created_at"),
    manifest,
    metrics: metricsFrom(row.metrics),
    perQuestion: questionCountsFrom(row.per_question),
    citedDomains: citedDomainsFrom(row.cited_domains),
  };
}

/**
 * The run a new one should be compared against.
 *
 * Scoped to one frozen question set: editing the knowledge base changes the
 * hash, and a diff computed across two different question sets would be a
 * number about the questions rather than about the site. When that happens
 * there is simply no baseline, which is the honest answer.
 *
 * `beforeRunId` names an already-stored run to anchor on, for re-opening a
 * past report. Without it the newest run is returned, which is what the run
 * that is about to be written needs.
 */
export async function readPreviousVisibilityRun(
  input: {
    readonly userId: string;
    readonly kbId: string;
    readonly questionSetHash: string;
    readonly beforeRunId?: string | null | undefined;
  },
  dependencies: VisibilityStoreDependencies = DEFAULT_VISIBILITY_STORE_DEPENDENCIES,
): Promise<VisibilityStoreResult<StoredVisibilityRun>> {
  if (!UUID_PATTERN.test(input.kbId)) {
    return { kind: "invalid", code: "invalid_kb_id" };
  }
  if (!HASH_PATTERN.test(input.questionSetHash)) {
    return { kind: "invalid", code: "invalid_question_set_hash" };
  }
  const beforeRunId = input.beforeRunId ?? null;
  if (beforeRunId !== null && !UUID_PATTERN.test(beforeRunId)) {
    return { kind: "invalid", code: "invalid_run_id" };
  }

  let before: string | null = null;
  if (beforeRunId !== null) {
    const anchor = await attempt(() =>
      dependencies.readRunAnchor({
        userId: input.userId,
        kbId: input.kbId,
        runId: beforeRunId,
      }),
    );
    if (anchor.kind === "error") return transportFailure(anchor);
    const anchorRow = record(anchor.data);
    // An anchor that is not this account's is not an error: there is no run to
    // compare against, and answering anything else would confirm it exists.
    if (anchorRow === null) return { kind: "missing" };
    try {
      if (!sameUuid(requiredUuid(anchorRow, "user_id"), input.userId)) {
        throw malformed("user_id");
      }
      if (!sameUuid(requiredUuid(anchorRow, "kb_id"), input.kbId)) {
        throw malformed("kb_id");
      }
      // The anchor has to have asked the same questions, or "the run before
      // it" is being picked off a timeline the anchor is not on.
      if (requiredHash(anchorRow, "question_set_hash") !== input.questionSetHash) {
        return { kind: "missing" };
      }
      const raw = anchorRow.created_at;
      if (typeof raw !== "string" || !DB_TIMESTAMP_PATTERN.test(raw)) {
        throw malformed("created_at");
      }
      // The database's own spelling, not a re-formatted copy: `toISOString`
      // drops microseconds, and a cursor rounded down to the millisecond would
      // exclude runs that really are earlier than the anchor.
      before = raw;
    } catch (error) {
      return storedValueFailure(error);
    }
  }

  const outcome = await attempt(() =>
    dependencies.readLatestRun({
      userId: input.userId,
      kbId: input.kbId,
      questionSetHash: input.questionSetHash,
      before,
    }),
  );
  if (outcome.kind === "error") return transportFailure(outcome);
  const row = record(outcome.data);
  if (row === null) return { kind: "missing" };
  try {
    return { kind: "ok", value: storedRunFromRow(row, input) };
  } catch (error) {
    // A row whose manifest belongs to a schema version this build does not
    // speak is not an outage and not corruption - the numbers simply mean
    // something else now. There is no baseline, and the run still reports.
    if (
      error instanceof StoredValueError &&
      error.reason === VISIBILITY_STORE_REASONS.malformedRun &&
      error.detail === "schemaVersion"
    ) {
      console.error("[geo-visibility-store] baseline not comparable", {
        reason: error.reason,
        detail: error.detail,
      });
      return { kind: "missing" };
    }
    return storedValueFailure(error);
  }
}
