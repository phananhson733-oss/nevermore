// @input  -- a verified Supabase user id, plus GEO knowledge-base RPCs and service-role reads
// @output -- validated knowledge bases, drafts, frozen snapshots, and stable store outcomes
// @pos    -- the only server module that reads or writes the marketing_geo_kb tables

import { createAdminSupabaseClient } from "../supabase/admin.ts";
import {
  GEO_KB_SCHEMA_VERSION,
  geoKbBlockers,
  parseGeoKbPayload,
  type GeoKbBlocker,
  type GeoKbPayload,
  type GeoKbRejection,
  type GeoKbValue,
} from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import {
  GEO_QUESTION_SET_SCHEMA_VERSION,
  buildGeoQuestionSet,
  geoQuestionSetDigest,
  type GeoQuestion,
  type GeoQuestionLayer,
  type GeoQuestionMode,
  type GeoQuestionSet,
} from "./kb-questions.ts";

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
export type GeoKbTransportOutcome =
  | { readonly kind: "ok"; readonly data: unknown }
  | { readonly kind: "error"; readonly code: string | null };

/** Which frozen version to read. */
export type GeoKbSnapshotSelector =
  | { readonly by: "current" }
  | { readonly by: "snapshotId"; readonly snapshotId: string }
  | { readonly by: "revision"; readonly revision: number };

export interface GeoKbStoreDependencies {
  readonly readList: (userId: string) => Promise<GeoKbTransportOutcome>;
  readonly readDetails: (
    userId: string,
    kbId: string,
  ) => Promise<GeoKbTransportOutcome>;
  readonly readSnapshot: (
    userId: string,
    kbId: string,
    selector: GeoKbSnapshotSelector,
  ) => Promise<GeoKbTransportOutcome>;
  readonly callRpc: (
    name: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<GeoKbTransportOutcome>;
}

/* ------------------------------------------------------------------ */
/* Shapes returned to callers                                          */
/* ------------------------------------------------------------------ */

export interface GeoKbSiteRef {
  readonly kbId: string;
  readonly origin: string;
  readonly host: string;
  readonly canonicalSiteKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GeoKbDraftSummary {
  readonly draftVersion: number;
  readonly contentHash: string;
  readonly updatedAt: string;
}

export interface GeoKbDraft extends GeoKbDraftSummary {
  readonly payload: GeoKbPayload;
}

export interface GeoKbFrozenRef {
  readonly snapshotId: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly questionSetHash: string;
  readonly frozenAt: string;
}

export interface GeoKbFrozenSummary extends GeoKbFrozenRef {
  /** Counted from the frozen set itself, because a run's cost is derived from it. */
  readonly questionCount: number;
}

export interface GeoKbSummary extends GeoKbSiteRef {
  readonly draft: GeoKbDraftSummary | null;
  readonly frozen: GeoKbFrozenRef | null;
}

export interface GeoKbDetails extends GeoKbSiteRef {
  readonly draft: GeoKbDraft | null;
  readonly frozen: GeoKbFrozenSummary | null;
}

export interface GeoKbFrozenSnapshot extends GeoKbFrozenSummary {
  readonly kbId: string;
  readonly payload: GeoKbPayload;
  readonly questionSet: GeoQuestionSet;
}

export interface GeoKbRegistration {
  readonly kbId: string;
  readonly created: boolean;
}

export interface GeoKbFreezeOutcome extends GeoKbFrozenSummary {
  /**
   * True when this call pointed at a version that already existed.
   *
   * Freezing the same text twice is idempotent by content, so a double-clicked
   * button must not read as a new revision in the interface.
   */
  readonly reusedExisting: boolean;
}

export type GeoKbInvalidCode =
  | "invalid_kb_id"
  | "invalid_site"
  | "invalid_payload"
  | "invalid_base_version"
  | "invalid_revision"
  | "context_stale"
  | "website_required"
  | "no_draft"
  | "not_freezable"
  | "question_set_stale";

export type GeoKbStoreResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "missing" }
  /**
   * Someone else saved first. The current version is returned rather than the
   * current payload: re-reading here would hand back a third state that the
   * caller never asked for and that could itself fail, and the version is what
   * an editor needs in order to reload and rebase.
   */
  | { readonly kind: "conflict"; readonly currentDraftVersion: number | null }
  | {
      readonly kind: "invalid";
      readonly code: GeoKbInvalidCode;
      readonly blockers?: readonly GeoKbBlocker[];
      /** Which part of the payload the contract refused. */
      readonly rejection?: GeoKbRejection;
    }
  /** `reason` is one of `GEO_KB_STORE_REASONS` or a provider error code. */
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The stable codes this module reports when it cannot answer.
 *
 * Exported so a caller can map them without repeating string literals: the
 * two hash rejections in particular mean something a route renders
 * differently from an outage.
 */
export const GEO_KB_STORE_REASONS = {
  unavailable: "store_unavailable",
  malformedResponse: "malformed_store_response",
  malformedPayload: "malformed_kb_payload",
  malformedQuestionSet: "malformed_question_set",
  payloadHashRejected: "payload_hash_rejected",
  questionSetHashRejected: "question_set_hash_rejected",
} as const;

/* ------------------------------------------------------------------ */
/* Supabase adapter                                                    */
/* ------------------------------------------------------------------ */

const KB_COLUMNS =
  "id,user_id,canonical_site_key,origin,host,current_frozen_snapshot_id,created_at,updated_at";
const DRAFT_SUMMARY_COLUMNS =
  "kb_id,user_id,schema_version,draft_version,content_hash,updated_at";
const DRAFT_COLUMNS = `${DRAFT_SUMMARY_COLUMNS},payload`;
const SNAPSHOT_SUMMARY_COLUMNS =
  "id,kb_id,user_id,revision,schema_version,content_hash,question_set_hash,frozen_at";
const SNAPSHOT_DETAIL_COLUMNS = `${SNAPSHOT_SUMMARY_COLUMNS},question_set`;
const SNAPSHOT_FULL_COLUMNS = `${SNAPSHOT_DETAIL_COLUMNS},payload`;

function transport(
  data: unknown,
  error: { readonly code?: string } | null | undefined,
): GeoKbTransportOutcome {
  return error === null || error === undefined
    ? { kind: "ok", data }
    : { kind: "error", code: typeof error.code === "string" ? error.code : null };
}

async function readListViaSupabase(
  userId: string,
): Promise<GeoKbTransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const knowledgeBases = await client
      .from("marketing_geo_knowledge_bases")
      .select(KB_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (knowledgeBases.error !== null) {
      return transport(null, knowledgeBases.error);
    }
    const rows = records(knowledgeBases.data);
    if (rows === null) {
      return {
        kind: "ok",
        data: { knowledgeBases: knowledgeBases.data, drafts: null, snapshots: null },
      };
    }
    const kbIds = rows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : [],
    );
    const snapshotIds = rows.flatMap((row) =>
      typeof row.current_frozen_snapshot_id === "string"
        ? [row.current_frozen_snapshot_id]
        : [],
    );
    const empty = Promise.resolve({ data: [], error: null });
    // Summary columns only: a list must not carry payloads or question sets,
    // which are capped at 128KB and 256KB per row.
    const [drafts, snapshots] = await Promise.all([
      kbIds.length === 0
        ? empty
        : client
            .from("marketing_geo_kb_drafts")
            .select(DRAFT_SUMMARY_COLUMNS)
            .eq("user_id", userId)
            .in("kb_id", kbIds),
      snapshotIds.length === 0
        ? empty
        : client
            .from("marketing_geo_kb_snapshots")
            .select(SNAPSHOT_SUMMARY_COLUMNS)
            .eq("user_id", userId)
            .in("id", snapshotIds),
    ]);
    return transport(
      {
        knowledgeBases: knowledgeBases.data,
        drafts: drafts.data,
        snapshots: snapshots.data,
      },
      drafts.error ?? snapshots.error,
    );
  } catch {
    return { kind: "error", code: null };
  }
}

async function readDetailsViaSupabase(
  userId: string,
  kbId: string,
): Promise<GeoKbTransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const [knowledgeBase, draft] = await Promise.all([
      client
        .from("marketing_geo_knowledge_bases")
        .select(KB_COLUMNS)
        .eq("user_id", userId)
        .eq("id", kbId)
        .maybeSingle(),
      client
        .from("marketing_geo_kb_drafts")
        .select(DRAFT_COLUMNS)
        .eq("user_id", userId)
        .eq("kb_id", kbId)
        .maybeSingle(),
    ]);
    if (knowledgeBase.error !== null || draft.error !== null) {
      return transport(null, knowledgeBase.error ?? draft.error);
    }
    if (knowledgeBase.data === null) {
      return { kind: "ok", data: { knowledgeBases: [], drafts: [], snapshots: [] } };
    }
    // The current version is the one this knowledge base points at, which is
    // not always the highest revision: freezing text that was frozen before
    // reuses the earlier snapshot.
    const currentSnapshotId = (knowledgeBase.data as Record<string, unknown>)
      .current_frozen_snapshot_id;
    let snapshots: unknown = [];
    if (typeof currentSnapshotId === "string") {
      const snapshot = await client
        .from("marketing_geo_kb_snapshots")
        .select(SNAPSHOT_DETAIL_COLUMNS)
        .eq("user_id", userId)
        .eq("kb_id", kbId)
        .eq("id", currentSnapshotId)
        .maybeSingle();
      if (snapshot.error !== null) return transport(null, snapshot.error);
      snapshots = snapshot.data === null ? [] : [snapshot.data];
    }
    return {
      kind: "ok",
      data: {
        knowledgeBases: [knowledgeBase.data],
        drafts: draft.data === null ? [] : [draft.data],
        snapshots,
      },
    };
  } catch {
    return { kind: "error", code: null };
  }
}

async function readSnapshotViaSupabase(
  userId: string,
  kbId: string,
  selector: GeoKbSnapshotSelector,
): Promise<GeoKbTransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const snapshotQuery = () =>
      client
        .from("marketing_geo_kb_snapshots")
        .select(SNAPSHOT_FULL_COLUMNS)
        .eq("user_id", userId)
        .eq("kb_id", kbId);
    if (selector.by === "revision") {
      const byRevision = await snapshotQuery()
        .eq("revision", selector.revision)
        .maybeSingle();
      return transport(byRevision.data, byRevision.error);
    }
    if (selector.by === "snapshotId") {
      const exact = await snapshotQuery().eq("id", selector.snapshotId).maybeSingle();
      return transport(exact.data, exact.error);
    }
    const knowledgeBase = await client
      .from("marketing_geo_knowledge_bases")
      .select("id,user_id,current_frozen_snapshot_id")
      .eq("user_id", userId)
      .eq("id", kbId)
      .maybeSingle();
    if (knowledgeBase.error !== null) return transport(null, knowledgeBase.error);
    const row = record(knowledgeBase.data);
    const currentSnapshotId = row === null ? null : row.current_frozen_snapshot_id;
    if (typeof currentSnapshotId !== "string") return { kind: "ok", data: null };
    const current = await snapshotQuery()
      .eq("id", currentSnapshotId)
      .maybeSingle();
    return transport(current.data, current.error);
  } catch {
    return { kind: "error", code: null };
  }
}

async function callRpcViaSupabase(
  name: string,
  params: Readonly<Record<string, unknown>>,
): Promise<GeoKbTransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client.rpc(name, params);
    return transport(data, error);
  } catch {
    return { kind: "error", code: null };
  }
}

export const DEFAULT_GEO_KB_STORE_DEPENDENCIES: GeoKbStoreDependencies = {
  readList: readListViaSupabase,
  readDetails: readDetailsViaSupabase,
  readSnapshot: readSnapshotViaSupabase,
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

function records(value: unknown): readonly Record<string, unknown>[] | null {
  return Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry),
    )
    ? (value as readonly Record<string, unknown>[])
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function malformed(detail: string): StoredValueError {
  return new StoredValueError(GEO_KB_STORE_REASONS.malformedResponse, detail);
}

function requiredRows(value: unknown, key: string): readonly Record<string, unknown>[] {
  const rows = records(value);
  if (rows === null) throw malformed(key);
  return rows;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw malformed(key);
  return value;
}

function requiredUuid(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key);
  if (!UUID_PATTERN.test(value)) throw malformed(key);
  return value;
}

function nullableUuid(row: Record<string, unknown>, key: string): string | null {
  if (row[key] === null || row[key] === undefined) return null;
  return requiredUuid(row, key);
}

function requiredHash(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key);
  if (!HASH_PATTERN.test(value)) throw malformed(key);
  return value;
}

function requiredVersion(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isInteger(value) || (value as number) < 1) throw malformed(key);
  return value as number;
}

function requiredDbTimestamp(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key);
  if (!DB_TIMESTAMP_PATTERN.test(value)) throw malformed(key);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw malformed(key);
  return new Date(parsed).toISOString();
}

/** UUID text case is not identity, so ownership is compared case-blind. */
function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertOwned(row: Record<string, unknown>, userId: string): void {
  if (!sameUuid(requiredUuid(row, "user_id"), userId)) {
    throw malformed("user_id");
  }
}

function assertKbSchemaVersion(row: Record<string, unknown>): void {
  if (requiredString(row, "schema_version") !== GEO_KB_SCHEMA_VERSION) {
    throw malformed("schema_version");
  }
}

function payloadDigest(payload: GeoKbPayload): string {
  return geoKbDigest(payload as unknown as GeoKbValue);
}

/**
 * Parse a stored payload and check it is still the text its hash describes.
 *
 * The hash was verified by the database against its own canonical form when
 * the row was written, so comparing it here to a digest computed by the same
 * function the write path uses crosses the round trip rather than restating
 * it. A row that fails is refused instead of being served under a hash that
 * no longer describes it.
 */
function payloadFromRow(row: Record<string, unknown>): GeoKbPayload {
  const parsed = parseGeoKbPayload(row.payload);
  if (!parsed.ok) throw new StoredValueError(GEO_KB_STORE_REASONS.malformedPayload, parsed.reason);
  if (payloadDigest(parsed.value) !== requiredHash(row, "content_hash")) {
    throw new StoredValueError(GEO_KB_STORE_REASONS.malformedPayload, "content_hash");
  }
  return parsed.value;
}

const QUESTION_LAYERS: ReadonlySet<string> = new Set([
  "problem",
  "discovery",
  "comparison",
  "evaluation",
  "branded",
]);
const QUESTION_MODES: ReadonlySet<string> = new Set(["retrieval", "demand"]);

function stringList(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value)) throw malformed(key);
  return value.map((entry) => {
    if (typeof entry !== "string") throw malformed(key);
    return entry;
  });
}

function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  if (row[key] === null) return null;
  return requiredString(row, key);
}

function questionFromRow(value: unknown): GeoQuestion {
  const row = record(value);
  if (row === null) throw malformed("question");
  const layer = requiredString(row, "layer");
  const mode = requiredString(row, "mode");
  if (!QUESTION_LAYERS.has(layer) || !QUESTION_MODES.has(mode)) {
    throw malformed("question");
  }
  if (typeof row.calibrated !== "boolean") throw malformed("question");
  return {
    id: requiredString(row, "id"),
    text: requiredString(row, "text"),
    layer: layer as GeoQuestionLayer,
    mode: mode as GeoQuestionMode,
    roleId: nullableStringField(row, "roleId"),
    requiredEntities: stringList(row.requiredEntities, "requiredEntities"),
    templateId: nullableStringField(row, "templateId"),
    calibrated: row.calibrated,
  };
}

/**
 * Parse a frozen question set and check it against the hash stored beside it.
 *
 * Rebuilding the set from known fields means an unknown field is dropped,
 * which the digest comparison then catches: a set written by a shape this
 * version does not understand is refused rather than silently truncated into
 * something a run would ask.
 */
function questionSetFromRow(row: Record<string, unknown>): GeoQuestionSet {
  const raw = record(row.question_set);
  if (raw === null) throw new StoredValueError(GEO_KB_STORE_REASONS.malformedQuestionSet, "shape");
  if (raw.schemaVersion !== GEO_QUESTION_SET_SCHEMA_VERSION) {
    throw new StoredValueError(GEO_KB_STORE_REASONS.malformedQuestionSet, "schema_version");
  }
  if (!Array.isArray(raw.questions)) {
    throw new StoredValueError(GEO_KB_STORE_REASONS.malformedQuestionSet, "questions");
  }
  let set: GeoQuestionSet;
  try {
    set = {
      schemaVersion: GEO_QUESTION_SET_SCHEMA_VERSION,
      registryVersion: requiredString(raw, "registryVersion"),
      language: requiredString(raw, "language"),
      country: requiredString(raw, "country"),
      questions: raw.questions.map((entry) => questionFromRow(entry)),
    };
  } catch {
    throw new StoredValueError(GEO_KB_STORE_REASONS.malformedQuestionSet, "questions");
  }
  if (geoQuestionSetDigest(set) !== requiredHash(row, "question_set_hash")) {
    throw new StoredValueError(GEO_KB_STORE_REASONS.malformedQuestionSet, "question_set_hash");
  }
  return set;
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

interface GeoKbReadBundle {
  readonly knowledgeBases: readonly Record<string, unknown>[];
  readonly drafts: readonly Record<string, unknown>[];
  readonly snapshots: readonly Record<string, unknown>[];
}

function readBundle(value: unknown): GeoKbReadBundle {
  const bundle = record(value);
  if (bundle === null) throw malformed("bundle");
  return {
    knowledgeBases: requiredRows(bundle.knowledgeBases, "knowledgeBases"),
    drafts: requiredRows(bundle.drafts, "drafts"),
    snapshots: requiredRows(bundle.snapshots, "snapshots"),
  };
}

function siteRefFromRow(
  row: Record<string, unknown>,
  userId: string,
): GeoKbSiteRef {
  assertOwned(row, userId);
  return {
    kbId: requiredUuid(row, "id"),
    origin: requiredString(row, "origin"),
    host: requiredString(row, "host"),
    canonicalSiteKey: requiredString(row, "canonical_site_key"),
    createdAt: requiredDbTimestamp(row, "created_at"),
    updatedAt: requiredDbTimestamp(row, "updated_at"),
  };
}

function draftSummaryFromRow(row: Record<string, unknown>): GeoKbDraftSummary {
  assertKbSchemaVersion(row);
  return {
    draftVersion: requiredVersion(row, "draft_version"),
    contentHash: requiredHash(row, "content_hash"),
    updatedAt: requiredDbTimestamp(row, "updated_at"),
  };
}

function frozenRefFromRow(row: Record<string, unknown>): GeoKbFrozenRef {
  assertKbSchemaVersion(row);
  return {
    snapshotId: requiredUuid(row, "id"),
    revision: requiredVersion(row, "revision"),
    contentHash: requiredHash(row, "content_hash"),
    questionSetHash: requiredHash(row, "question_set_hash"),
    frozenAt: requiredDbTimestamp(row, "frozen_at"),
  };
}

/** Index owned child rows by the knowledge base they belong to. */
function indexChildren(
  rows: readonly Record<string, unknown>[],
  userId: string,
  key: "kb_id" | "id",
): ReadonlyMap<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    assertOwned(row, userId);
    const identity = requiredUuid(row, key);
    if (indexed.has(identity)) throw malformed(key);
    indexed.set(identity, row);
  }
  return indexed;
}

function mapSummaries(
  bundle: GeoKbReadBundle,
  userId: string,
): readonly GeoKbSummary[] {
  const drafts = indexChildren(bundle.drafts, userId, "kb_id");
  const snapshots = indexChildren(bundle.snapshots, userId, "id");
  const seen = new Set<string>();
  const consumedSnapshots = new Set<string>();
  const summaries = bundle.knowledgeBases.map((row) => {
    const site = siteRefFromRow(row, userId);
    if (seen.has(site.kbId)) throw malformed("id");
    seen.add(site.kbId);
    const draftRow = drafts.get(site.kbId);
    const frozenId = nullableUuid(row, "current_frozen_snapshot_id");
    const snapshotRow = frozenId === null ? undefined : snapshots.get(frozenId);
    // A knowledge base that points at a version this read did not return is a
    // broken read, not an unfrozen knowledge base.
    if (frozenId !== null && snapshotRow === undefined) {
      throw malformed("current_frozen_snapshot_id");
    }
    if (
      snapshotRow !== undefined &&
      requiredUuid(snapshotRow, "kb_id") !== site.kbId
    ) {
      throw malformed("kb_id");
    }
    if (frozenId !== null) consumedSnapshots.add(frozenId);
    return {
      ...site,
      draft: draftRow === undefined ? null : draftSummaryFromRow(draftRow),
      frozen: snapshotRow === undefined ? null : frozenRefFromRow(snapshotRow),
    };
  });
  // Every child row has to belong to a knowledge base this read returned;
  // otherwise the read reached rows it was not scoped to.
  for (const kbId of drafts.keys()) {
    if (!seen.has(kbId)) throw malformed("kb_id");
  }
  if (consumedSnapshots.size !== snapshots.size) throw malformed("snapshots");
  return summaries;
}

function mapDetails(
  bundle: GeoKbReadBundle,
  userId: string,
): GeoKbDetails | null {
  // One knowledge base, so the rows picked for the payload and the question
  // set below belong to the summary above rather than to whichever came first.
  // The children need no such check: every one of them has to be claimed by a
  // knowledge base in this read, and one knowledge base claims at most one of
  // each.
  if (bundle.knowledgeBases.length > 1) throw malformed("knowledgeBases");
  const summaries = mapSummaries(bundle, userId);
  const summary = summaries[0];
  if (summary === undefined) return null;
  const draftRow = bundle.drafts[0];
  const snapshotRow = bundle.snapshots[0];
  return {
    kbId: summary.kbId,
    origin: summary.origin,
    host: summary.host,
    canonicalSiteKey: summary.canonicalSiteKey,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    draft:
      draftRow === undefined || summary.draft === null
        ? null
        : { ...summary.draft, payload: payloadFromRow(draftRow) },
    frozen:
      snapshotRow === undefined || summary.frozen === null
        ? null
        : {
            ...summary.frozen,
            questionCount: questionSetFromRow(snapshotRow).questions.length,
          },
  };
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

function unavailable(reason: string, detail: string | null): GeoKbStoreResult<never> {
  console.error("[geo-kb-store] unavailable", { reason, detail });
  return { kind: "unavailable", reason };
}

function transportFailure(
  outcome: { readonly code: string | null },
): GeoKbStoreResult<never> {
  return unavailable(outcome.code ?? GEO_KB_STORE_REASONS.unavailable, null);
}

function storedValueFailure(error: unknown): GeoKbStoreResult<never> {
  return error instanceof StoredValueError
    ? unavailable(error.reason, error.detail)
    : unavailable(GEO_KB_STORE_REASONS.malformedResponse, null);
}

/**
 * Run one dependency call without letting it throw.
 *
 * The rejection value is not bound: a provider stack trace cannot become part
 * of a result that a route will serialize.
 */
async function attempt(
  run: () => Promise<GeoKbTransportOutcome>,
): Promise<GeoKbTransportOutcome> {
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

function isBoundedText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && value.trim() === value;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Register a site so it has a knowledge base to edit.
 *
 * Idempotent by site key, so this is safe to call on every visit to the tool.
 */
export async function ensureGeoKnowledgeBase(
  input: {
    readonly userId: string;
    readonly origin: string;
    readonly host: string;
    readonly canonicalSiteKey: string;
  },
  dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES,
): Promise<GeoKbStoreResult<GeoKbRegistration>> {
  // Checked here rather than left to the column constraints, so a caller that
  // sends an unnormalized site gets a code it can act on instead of an opaque
  // database failure.
  if (
    !isBoundedText(input.origin, 2_048) ||
    !isBoundedText(input.host, 255) ||
    !isBoundedText(input.canonicalSiteKey, 255)
  ) {
    return { kind: "invalid", code: "invalid_site" };
  }
  const outcome = await attempt(() =>
    dependencies.callRpc("marketing_geo_upsert_kb", {
      p_user_id: input.userId,
      p_origin: input.origin,
      p_host: input.host,
      p_canonical_site_key: input.canonicalSiteKey,
    }),
  );
  if (outcome.kind === "error") return transportFailure(outcome);
  const row = rpcRow(outcome.data);
  if (row === null || typeof row.created !== "boolean") {
    return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "upsert_kb");
  }
  try {
    return {
      kind: "ok",
      value: { kbId: requiredUuid(row, "kb_id"), created: row.created },
    };
  } catch (error) {
    return storedValueFailure(error);
  }
}

export async function listGeoKnowledgeBases(
  input: { readonly userId: string },
  dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES,
): Promise<GeoKbStoreResult<readonly GeoKbSummary[]>> {
  const outcome = await attempt(() => dependencies.readList(input.userId));
  if (outcome.kind === "error") return transportFailure(outcome);
  try {
    return { kind: "ok", value: mapSummaries(readBundle(outcome.data), input.userId) };
  } catch (error) {
    return storedValueFailure(error);
  }
}

export async function readGeoKnowledgeBase(
  input: { readonly userId: string; readonly kbId: string },
  dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES,
): Promise<GeoKbStoreResult<GeoKbDetails>> {
  if (!UUID_PATTERN.test(input.kbId)) {
    return { kind: "invalid", code: "invalid_kb_id" };
  }
  const outcome = await attempt(() =>
    dependencies.readDetails(input.userId, input.kbId),
  );
  if (outcome.kind === "error") return transportFailure(outcome);
  try {
    const details = mapDetails(readBundle(outcome.data), input.userId);
    if (details === null) return { kind: "missing" };
    // A read scoped to one knowledge base that answers with another one is a
    // scoping failure, and saying so is cheaper than trusting the filter.
    if (!sameUuid(details.kbId, input.kbId)) {
      return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "kb_id");
    }
    return { kind: "ok", value: details };
  } catch (error) {
    return storedValueFailure(error);
  }
}

/**
 * Save the working copy.
 *
 * The payload is parsed before it is sent: the digest has to describe the
 * normalized text the database will store, and an editor is free to send
 * whitespace, duplicates, or a shape that was never valid.
 */
export async function saveGeoKbDraft(
  input: {
    readonly userId: string;
    readonly kbId: string;
    readonly payload: unknown;
    readonly baseVersion: number;
  },
  dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES,
): Promise<GeoKbStoreResult<GeoKbDraftSummary>> {
  if (!UUID_PATTERN.test(input.kbId)) {
    return { kind: "invalid", code: "invalid_kb_id" };
  }
  // Zero is the version of a knowledge base that has never been saved.
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0) {
    return { kind: "invalid", code: "invalid_base_version" };
  }
  const parsed = parseGeoKbPayload(input.payload);
  if (!parsed.ok) {
    return { kind: "invalid", code: "invalid_payload", rejection: parsed.reason };
  }
  const outcome = await attempt(() =>
    dependencies.callRpc("marketing_geo_save_kb_draft", {
      p_user_id: input.userId,
      p_kb_id: input.kbId,
      p_schema_version: GEO_KB_SCHEMA_VERSION,
      p_payload: parsed.value,
      p_content_hash: payloadDigest(parsed.value),
      p_base_version: input.baseVersion,
    }),
  );
  if (outcome.kind === "error") return transportFailure(outcome);
  const row = rpcRow(outcome.data);
  if (row === null || typeof row.outcome !== "string") {
    return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "save_kb_draft");
  }
  if (row.outcome === "not_found") return { kind: "missing" };
  if (row.outcome === "conflict") {
    return {
      kind: "conflict",
      currentDraftVersion:
        typeof row.draft_version === "number" && Number.isInteger(row.draft_version)
          ? row.draft_version
          : null,
    };
  }
  // The database recomputed the digest from its own canonical form and got
  // something else. Nobody can fix that by editing, so it is reported as the
  // integrity failure it is rather than as invalid input.
  if (row.outcome === "hash_mismatch") {
    return unavailable(GEO_KB_STORE_REASONS.payloadHashRejected, "save_kb_draft");
  }
  if (row.outcome !== "saved") {
    return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "save_kb_draft");
  }
  try {
    const saved: GeoKbDraftSummary = {
      draftVersion: requiredVersion(row, "draft_version"),
      contentHash: requiredHash(row, "content_hash"),
      updatedAt: requiredDbTimestamp(row, "updated_at"),
    };
    // The saved row has to be the text this call sent. A `saved` answer that
    // describes something else is a wrong row, not a successful write.
    if (saved.contentHash !== payloadDigest(parsed.value)) {
      return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "save_kb_draft");
    }
    return { kind: "ok", value: saved };
  } catch (error) {
    return storedValueFailure(error);
  }
}

/**
 * Freeze the working copy into an immutable version.
 *
 * The question set is checked against the draft this freeze will actually
 * store. The database can only prove that the hash describes the set; it
 * cannot know whether the set describes the payload, so a tab that built its
 * questions before the last edit would otherwise freeze wording that was never
 * derived from the frozen text, and every later run would cite a set that does
 * not match its own knowledge base.
 */
export async function freezeGeoKb(
  input: {
    readonly userId: string;
    readonly kbId: string;
    readonly baseVersion: number;
    readonly questionSet: GeoQuestionSet;
  },
  dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES,
): Promise<GeoKbStoreResult<GeoKbFreezeOutcome>> {
  if (!UUID_PATTERN.test(input.kbId)) {
    return { kind: "invalid", code: "invalid_kb_id" };
  }
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 1) {
    return { kind: "invalid", code: "invalid_base_version" };
  }
  const details = await readGeoKnowledgeBase(
    { userId: input.userId, kbId: input.kbId },
    dependencies,
  );
  if (details.kind !== "ok") return details;
  const draft = details.value.draft;
  if (draft === null) return { kind: "invalid", code: "no_draft" };
  if (draft.draftVersion !== input.baseVersion) {
    return { kind: "conflict", currentDraftVersion: draft.draftVersion };
  }
  const blockers = geoKbBlockers(draft.payload);
  if (blockers.length > 0) {
    return { kind: "invalid", code: "not_freezable", blockers };
  }
  const questionSetHash = geoQuestionSetDigest(input.questionSet);
  if (questionSetHash !== geoQuestionSetDigest(buildGeoQuestionSet(draft.payload))) {
    return { kind: "invalid", code: "question_set_stale" };
  }

  const outcome = await attempt(() =>
    dependencies.callRpc("marketing_geo_freeze_kb", {
      p_user_id: input.userId,
      p_kb_id: input.kbId,
      p_schema_version: GEO_KB_SCHEMA_VERSION,
      p_base_version: input.baseVersion,
      p_question_set: input.questionSet,
      p_question_set_hash: questionSetHash,
    }),
  );
  if (outcome.kind === "error") return transportFailure(outcome);
  const row = rpcRow(outcome.data);
  if (row === null || typeof row.outcome !== "string") {
    return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "freeze_kb");
  }
  if (row.outcome === "not_found") return { kind: "missing" };
  if (row.outcome === "no_draft") return { kind: "invalid", code: "no_draft" };
  if (row.outcome === "conflict") {
    return {
      kind: "conflict",
      currentDraftVersion:
        typeof row.revision === "number" && Number.isInteger(row.revision)
          ? row.revision
          : null,
    };
  }
  if (row.outcome === "hash_mismatch") {
    return unavailable(GEO_KB_STORE_REASONS.questionSetHashRejected, "freeze_kb");
  }
  if (row.outcome !== "frozen" || typeof row.reused_existing !== "boolean") {
    return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "freeze_kb");
  }
  try {
    return {
      kind: "ok",
      value: {
        snapshotId: requiredUuid(row, "snapshot_id"),
        revision: requiredVersion(row, "revision"),
        contentHash: requiredHash(row, "content_hash"),
        questionSetHash,
        frozenAt: requiredDbTimestamp(row, "frozen_at"),
        questionCount: input.questionSet.questions.length,
        reusedExisting: row.reused_existing,
      },
    };
  } catch (error) {
    return storedValueFailure(error);
  }
}

/**
 * Read one frozen version whole - payload and question set.
 *
 * Without a revision this reads the version the knowledge base currently
 * points at, which is not always the highest one: freezing text that was
 * frozen before reuses the earlier snapshot.
 */
export async function readFrozenGeoKb(
  input: {
    readonly userId: string;
    readonly kbId: string;
    readonly revision?: number | undefined;
    readonly snapshotId?: string | undefined;
  },
  dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES,
): Promise<GeoKbStoreResult<GeoKbFrozenSnapshot>> {
  if (!UUID_PATTERN.test(input.kbId)) {
    return { kind: "invalid", code: "invalid_kb_id" };
  }
  if (input.snapshotId !== undefined && (!UUID_PATTERN.test(input.snapshotId) || input.revision !== undefined)) {
    return { kind: "invalid", code: "invalid_revision" };
  }
  if (
    input.revision !== undefined &&
    (!Number.isInteger(input.revision) || input.revision < 1)
  ) {
    return { kind: "invalid", code: "invalid_revision" };
  }
  const selector: GeoKbSnapshotSelector =
    input.snapshotId !== undefined
      ? { by: "snapshotId", snapshotId: input.snapshotId }
      : input.revision === undefined
      ? { by: "current" }
      : { by: "revision", revision: input.revision };
  const outcome = await attempt(() =>
    dependencies.readSnapshot(input.userId, input.kbId, selector),
  );
  if (outcome.kind === "error") return transportFailure(outcome);
  if (outcome.data === null || outcome.data === undefined) {
    return { kind: "missing" };
  }
  const row = record(outcome.data);
  if (row === null) return unavailable(GEO_KB_STORE_REASONS.malformedResponse, "snapshot");
  try {
    assertOwned(row, input.userId);
    if (!sameUuid(requiredUuid(row, "kb_id"), input.kbId)) {
      throw malformed("kb_id");
    }
    const reference = frozenRefFromRow(row);
    if (input.snapshotId !== undefined && !sameUuid(reference.snapshotId, input.snapshotId)) {
      throw malformed("snapshot_id");
    }
    if (input.revision !== undefined && reference.revision !== input.revision) {
      throw malformed("revision");
    }
    const questionSet = questionSetFromRow(row);
    return {
      kind: "ok",
      value: {
        ...reference,
        kbId: requiredUuid(row, "kb_id"),
        questionCount: questionSet.questions.length,
        payload: payloadFromRow(row),
        questionSet,
      },
    };
  } catch (error) {
    return storedValueFailure(error);
  }
}
