// @input  -- an untrusted value that claims to be a ContentBrief or ContentBriefHandoff
// @output -- a freshly built, shape-exact ContentBrief (or handoff envelope), or one closed failure code with the offending path
// @pos    -- the decoder toolkit and every per-field shape pin of the content-brief contract; parse-brief.ts adds the cross-field invariants on top
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  CRAWL_EXCERPTS_PER_PAGE_MAX,
  CRAWL_EXCERPT_MAX_CHARS,
  CRAWL_HEADINGS_PER_PAGE_MAX,
  DO_NOT_COVER_CAP,
  FORMAT_PLURALITY_MIN,
  GSC_LOOKBACK_DAYS,
  GSC_PAGE_ROWS_MAX,
  HEADING_MAX_CHARS,
  INTERNAL_LINKS_CAP,
  MODEL_TEXT_MAX_CHARS,
  MUST_ANSWER_CAP,
  MUST_ANSWER_MIN_PAGES,
  OUTLINE_CAP,
  PROFILE_FACT_MAX_CHARS,
  QUESTION_MAX_CHARS,
  RUN_BUDGET_MS,
  SERP_DEPTH,
  SUPPORTING_KEYWORDS_MAX,
} from "./constants.ts";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES, CONTENT_BRIEF_SCHEMA } from "./contract.ts";
import { isBoundedModelText } from "./text.ts";
import type {
  ClassifiedSerpFormat,
  ContentBrief,
  CrawlObservation,
  CrawlSkipped,
  DoNotCoverField,
  FormatField,
  GapAngleField,
  GapKind,
  GscReadMeta,
  IntentField,
  InternalLinksField,
  LengthField,
  LlmReadMeta,
  MustAnswerField,
  MustAnswerItem,
  Origin,
  OutlineField,
  ProfileFact,
  ProfileReadMeta,
  RunMode,
  SerpFormat,
  SerpReadMeta,
  UnavailableReason,
  Verdict,
} from "./contract.ts";

/* ------------------------------------------------------------------ */
/* results                                                              */
/* ------------------------------------------------------------------ */

export type ParseBriefFailure =
  | { readonly ok: false; readonly code: "brief_schema_mismatch"; readonly path: string }
  | { readonly ok: false; readonly code: "invalid_request"; readonly path: string }
  | { readonly ok: false; readonly code: "brief_reference_invalid"; readonly path: string }
  | { readonly ok: false; readonly code: "brief_fingerprint_mismatch"; readonly path: string };

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Decoded<T> = Ok<T> | ParseBriefFailure;
type Decoder<T> = (input: unknown, path: string) => Decoded<T>;
type Infer<D> = D extends Decoder<infer T> ? T : never;
type Shape = Record<string, Decoder<unknown>>;
type ObjectOf<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

/** Non-model free text (ids, titles, domains, hashes, provider strings). Model text reads MODEL_TEXT_MAX_CHARS. */
const FREE_TEXT_MAX_CHARS = 2000;
const URL_MAX_CHARS = 2048;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function invalid(path: string): ParseBriefFailure {
  return { ok: false, code: "invalid_request", path };
}

export function reference(path: string): ParseBriefFailure {
  return { ok: false, code: "brief_reference_invalid", path };
}

export function at(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path === "" ? key : `${path}.${key}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* decoder toolkit: every decoder validates AND rebuilds, so the        */
/* returned value never shares a reference with the input               */
/* ------------------------------------------------------------------ */

function text(max = FREE_TEXT_MAX_CHARS, min = 0): Decoder<string> {
  return (input, path) =>
    typeof input === "string" && input.length >= min && input.length <= max ? ok(input) : invalid(path);
}

/** Model-written text: non-empty, no control characters or angle brackets, single spaces, code points <= max (text.ts). */
function modelText(maxCodePoints: number): Decoder<string> {
  return (input, path) =>
    typeof input === "string" && isBoundedModelText(input, maxCodePoints) ? ok(input) : invalid(path);
}

function literal<const L extends string | number | boolean | null>(expected: L): Decoder<L> {
  return (input, path) => (input === expected ? ok(expected) : invalid(path));
}

function oneOf<const L extends readonly string[]>(values: L): Decoder<L[number]> {
  const allowed = new Set<string>(values);
  return (input, path) =>
    typeof input === "string" && allowed.has(input) ? ok(input as L[number]) : invalid(path);
}

function integer(min = 0): Decoder<number> {
  return (input, path) =>
    typeof input === "number" && Number.isInteger(input) && input >= min ? ok(input) : invalid(path);
}

function finite(min = Number.NEGATIVE_INFINITY): Decoder<number> {
  return (input, path) =>
    typeof input === "number" && Number.isFinite(input) && input >= min ? ok(input) : invalid(path);
}

const positive: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isFinite(input) && input > 0 ? ok(input) : invalid(path);

const boolean: Decoder<boolean> = (input, path) => (typeof input === "boolean" ? ok(input) : invalid(path));

function nullable<T>(inner: Decoder<T>): Decoder<T | null> {
  return (input, path) => (input === null ? ok(null) : inner(input, path));
}

function identifier(prefix: string): Decoder<string> {
  const pattern = new RegExp(`^${prefix}[1-9][0-9]*$`);
  return (input, path) => (typeof input === "string" && pattern.test(input) ? ok(input) : invalid(path));
}

const httpUrl: Decoder<string> = (input, path) => {
  if (typeof input !== "string" || input.length === 0 || input.length > URL_MAX_CHARS) return invalid(path);
  try {
    const { protocol } = new URL(input);
    return protocol === "http:" || protocol === "https:" ? ok(input) : invalid(path);
  } catch {
    return invalid(path);
  }
};

const timestamp: Decoder<string> = (input, path) => {
  const decoded = text(FREE_TEXT_MAX_CHARS, 1)(input, path);
  if (!decoded.ok) return decoded;
  return Number.isFinite(Date.parse(decoded.value)) ? decoded : invalid(path);
};

interface ArrayBounds {
  readonly min?: number;
  readonly max?: number;
  readonly unique?: boolean;
}

function array<T>(item: Decoder<T>, bounds: ArrayBounds = {}): Decoder<T[]> {
  return (input, path) => {
    if (!Array.isArray(input)) return invalid(path);
    if (input.length < (bounds.min ?? 0) || input.length > (bounds.max ?? Number.POSITIVE_INFINITY)) {
      return invalid(path);
    }
    const out: T[] = [];
    for (const [index, element] of input.entries()) {
      const decoded = item(element, at(path, index));
      if (!decoded.ok) return decoded;
      out.push(decoded.value);
    }
    if (bounds.unique === true && new Set(out).size !== out.length) return invalid(path);
    return ok(out);
  };
}

function nonEmpty<T>(item: Decoder<T>, bounds: ArrayBounds = {}): Decoder<[T, ...T[]]> {
  const inner = array(item, { ...bounds, min: 1 });
  return (input, path) => {
    const decoded = inner(input, path);
    return decoded.ok ? ok(decoded.value as [T, ...T[]]) : decoded;
  };
}

/** Exact key set: every declared key must be an own property, no other own property may exist. */
function object<S extends Shape>(shape: S): Decoder<ObjectOf<S>> {
  const entries = Object.entries(shape);
  return (input, path) => {
    if (!isRecord(input)) return invalid(path);
    const out: Record<string, unknown> = {};
    for (const [key, decoder] of entries) {
      if (!Object.hasOwn(input, key)) return invalid(at(path, key));
      const decoded = decoder(input[key], at(path, key));
      if (!decoded.ok) return decoded;
      out[key] = decoded.value;
    }
    for (const key of Object.keys(input)) {
      if (!Object.hasOwn(shape, key)) return invalid(at(path, key));
    }
    return ok(out as ObjectOf<S>);
  };
}

/** Discriminated union on a string or boolean tag; the branch re-validates the tag itself. */
function tagged<B extends Record<string, Decoder<unknown>>>(key: string, branches: B): Decoder<Infer<B[keyof B]>> {
  return (input, path) => {
    if (!isRecord(input)) return invalid(path);
    const tag = Object.hasOwn(input, key) ? input[key] : undefined;
    const name = typeof tag === "string" || typeof tag === "boolean" ? String(tag) : null;
    const branch = name !== null && Object.hasOwn(branches, name) ? branches[name] : undefined;
    if (branch === undefined) return invalid(at(path, key));
    return branch(input, path) as Decoded<Infer<B[keyof B]>>;
  };
}

function recordOf<K extends string, T>(keys: readonly K[], item: Decoder<T>): Decoder<Record<K, T>> {
  const shape: Record<string, Decoder<T>> = {};
  for (const key of keys) shape[key] = item;
  return object(shape) as unknown as Decoder<Record<K, T>>;
}

/** Enumerations are declared as exhaustive records so a contract change fails to compile here. */
function keysOf<K extends string>(record: Record<K, null>): readonly K[] {
  return Object.keys(record) as K[];
}

/* ------------------------------------------------------------------ */
/* closed enumerations                                                  */
/* ------------------------------------------------------------------ */

const ORIGINS = keysOf<Origin>({ gsc: null, dataforseo_serp: null, crawl: null, product_profile: null, user_input: null });

const UNAVAILABLE_REASONS = keysOf<UnavailableReason>({
  not_requested: null,
  not_connected: null,
  not_configured: null,
  timeout: null,
  provider_error: null,
  quota_exhausted: null,
  insufficient_evidence: null,
  unsupported_language: null,
  validation_failed: null,
});

export const CLASSIFIED_SERP_FORMATS = keysOf<ClassifiedSerpFormat>({
  guide: null,
  listicle: null,
  comparison: null,
  product_page: null,
  tool: null,
  forum: null,
  video: null,
  news: null,
});

const SERP_FORMATS: readonly SerpFormat[] = [...CLASSIFIED_SERP_FORMATS, "unknown"];
const RUN_MODES = keysOf<RunMode>({ complete: null, partial: null, degraded: null, unavailable: null });
const GAP_KINDS = keysOf<GapKind>({ no_product_profile: null, no_gsc: null, no_outline: null, llm_unavailable: null });
const INTENT_VALUES = ["informational", "commercial", "transactional", "navigational"] as const;
const HEADING_LEVELS = ["h2", "h3"] as const;
const AVAILABLE_STATUSES = ["complete", "partial"] as const;

/* ------------------------------------------------------------------ */
/* provenance and reads                                                 */
/* ------------------------------------------------------------------ */

const unavailableShape = {
  status: literal("unavailable"),
  reason: oneOf(UNAVAILABLE_REASONS),
  attempted: nullable(integer()),
};
const unavailable = object(unavailableShape);

const modelProvenance = object({
  method: literal("model"),
  derived_from: array(oneOf(ORIGINS), { max: ORIGINS.length, unique: true }),
});

function heuristic<O extends Origin>(origin: O) {
  return object({ method: literal("heuristic"), origin: literal(origin) });
}

function observedBy<O extends Origin>(origin: O) {
  return object({ method: literal("observed"), origin: literal(origin) });
}

const llmReadMeta: Decoder<LlmReadMeta> = tagged("status", {
  complete: object({
    status: literal("complete"),
    calls: integer(),
    model_id: text(FREE_TEXT_MAX_CHARS, 1),
    temperature_requested: finite(),
    temperature_effective: nullable(finite()),
    input_tokens: nullable(integer()),
    output_tokens: nullable(integer()),
  }),
  unavailable: object({
    ...unavailableShape,
    calls: integer(),
    model_id: nullable(text()),
    input_tokens: nullable(integer()),
    output_tokens: nullable(integer()),
  }),
});

const serpAvailable = object({
  status: oneOf(AVAILABLE_STATUSES),
  requested: integer(1),
  returned: integer(),
  unresolved: integer(),
});
const serpReadMeta: Decoder<SerpReadMeta> = tagged("status", {
  complete: serpAvailable,
  partial: serpAvailable,
  unavailable,
});

const crawlAvailable = object({
  status: oneOf(AVAILABLE_STATUSES),
  attempted: integer(),
  observed: integer(),
  truncated: integer(),
  failed: integer(),
  skipped: integer(),
});
const crawlReadMeta = tagged("status", { complete: crawlAvailable, partial: crawlAvailable, unavailable });

const coverageRatio = object({ ratio: finite(0) });
const coverageUnknown = object({
  ratio: literal(null),
  reason: oneOf(["no_query_impressions", "split_exceeds_total", "query_not_in_sample"]),
});
const primaryCoverage: Decoder<Infer<typeof coverageRatio> | Infer<typeof coverageUnknown>> = (input, path) => {
  if (!isRecord(input)) return invalid(path);
  return input["ratio"] === null ? coverageUnknown(input, path) : coverageRatio(input, path);
};

const gscAvailable = object({
  status: oneOf(AVAILABLE_STATUSES),
  property: text(FREE_TEXT_MAX_CHARS, 1),
  window: object({ start: text(), end: text(), lookback_days: literal(GSC_LOOKBACK_DAYS) }),
  matched_queries: integer(),
  primary_coverage: primaryCoverage,
  truncated: array(oneOf(["query", "query_page", "page"]), { max: 3, unique: true }),
  rows: object({ query: integer(), query_page: integer(), page: integer() }),
  unreadable_rows: object({ query: integer(), query_page: integer(), page: integer() }),
});
const gscReadMeta: Decoder<GscReadMeta> = tagged("status", { complete: gscAvailable, partial: gscAvailable, unavailable });

const profileReadMeta: Decoder<ProfileReadMeta> = tagged("status", {
  complete: object({
    status: literal("complete"),
    website_id: text(FREE_TEXT_MAX_CHARS, 1),
    snapshot_revision: integer(),
    profile_hash: text(FREE_TEXT_MAX_CHARS, 1),
  }),
  unavailable,
});

const briefRunMeta = object({
  run_id: text(FREE_TEXT_MAX_CHARS, 1),
  collected_at: timestamp,
  elapsed_ms: integer(),
  budget_ms: literal(RUN_BUDGET_MS),
  mode: oneOf(RUN_MODES),
  reads: object({
    serp: serpReadMeta,
    crawl: crawlReadMeta,
    gsc: gscReadMeta,
    product_profile: profileReadMeta,
    llm: llmReadMeta,
  }),
  // Empty is a shape-valid placeholder: assemble.ts self-checks before stamping,
  // and parseContentBrief still rejects it because sha256 hex never equals "".
  fingerprint: text(),
});

/* ------------------------------------------------------------------ */
/* evidence ledger                                                      */
/* ------------------------------------------------------------------ */

const serpObservation = object({
  id: identifier("S"),
  rank: integer(1),
  url: nullable(httpUrl),
  domain: text(FREE_TEXT_MAX_CHARS, 1),
  title: nullable(text()),
  format: object({ value: oneOf(SERP_FORMATS), method: literal("heuristic"), rules_hit: array(text()) }),
});

const crawlExcerpt = object({
  heading: text(HEADING_MAX_CHARS),
  level: oneOf(HEADING_LEVELS),
  text: text(CRAWL_EXCERPT_MAX_CHARS),
});

const crawlObservationBase = {
  id: identifier("C"),
  serp_id: identifier("S"),
  url: httpUrl,
  final_url: httpUrl,
  fetched_at: timestamp,
  h2: array(text(HEADING_MAX_CHARS), { max: CRAWL_HEADINGS_PER_PAGE_MAX }),
  h3: array(text(HEADING_MAX_CHARS), { max: CRAWL_HEADINGS_PER_PAGE_MAX }),
  excerpts: array(crawlExcerpt, { max: CRAWL_EXCERPTS_PER_PAGE_MAX }),
  content_hash: text(FREE_TEXT_MAX_CHARS, 1),
};
const crawlObservation: Decoder<CrawlObservation> = tagged("body_complete", {
  true: object({ ...crawlObservationBase, body_complete: literal(true), word_count: nullable(integer()) }),
  false: object({ ...crawlObservationBase, body_complete: literal(false), word_count: literal(null) }),
});

const crawlFailure = object({
  serp_id: identifier("S"),
  url: httpUrl,
  reason: oneOf(["timeout", "provider_error", "validation_failed"]),
  code: nullable(text()),
});

const crawlSkipped: Decoder<CrawlSkipped> = tagged("reason", {
  same_host: object({ serp_id: identifier("S"), reason: literal("same_host"), kept_serp_id: identifier("S") }),
  no_url: object({ serp_id: identifier("S"), reason: literal("no_url"), kept_serp_id: literal(null) }),
});

const productProfileOnly: Decoder<["product_profile"]> = (input, path) =>
  Array.isArray(input) && input.length === 1 && input[0] === "product_profile"
    ? ok<["product_profile"]>(["product_profile"])
    : invalid(path);

const profileFactBase = {
  id: identifier("P"),
  field: text(FREE_TEXT_MAX_CHARS, 1),
  text: text(PROFILE_FACT_MAX_CHARS),
};
const firstHandFact = (derivation: "declared" | "observed" | "computed") =>
  object({ ...profileFactBase, derivation: literal(derivation), provenance: observedBy("product_profile") });
const profileFact: Decoder<ProfileFact> = tagged("derivation", {
  declared: firstHandFact("declared"),
  observed: firstHandFact("observed"),
  computed: firstHandFact("computed"),
  inferred: object({
    ...profileFactBase,
    derivation: literal("inferred"),
    provenance: object({ method: literal("model"), derived_from: productProfileOnly }),
  }),
});

const gscQueryPageRow = object({
  query: text(FREE_TEXT_MAX_CHARS, 1),
  page: httpUrl,
  clicks: integer(),
  impressions: integer(),
  position: nullable(positive),
});

const gscPageRow = object({
  id: identifier("G"),
  page: httpUrl,
  clicks: integer(),
  impressions: integer(),
  position: nullable(positive),
});

const evidenceLedger = object({
  serp: array(serpObservation, { max: SERP_DEPTH }),
  crawl: object({
    observed: array(crawlObservation, { max: SERP_DEPTH }),
    failed: array(crawlFailure, { max: SERP_DEPTH }),
    skipped: array(crawlSkipped, { max: SERP_DEPTH }),
  }),
  profile: nullable(object({ facts: array(profileFact) })),
  gsc_query_page: array(gscQueryPageRow),
  gsc_pages: array(gscPageRow, { max: GSC_PAGE_ROWS_MAX }),
});

/* ------------------------------------------------------------------ */
/* verdict and fields                                                   */
/* ------------------------------------------------------------------ */

const gscHeuristic = heuristic("gsc");
const existingPage = { page: httpUrl, impressions: integer(), rows: integer(), rows_with_position: integer() };
const undecidableWithGsc = object({
  action: literal("undecidable"),
  reason: oneOf(["gsc_unavailable", "gsc_partial", "gsc_inconsistent", "position_unavailable"]),
  provenance: gscHeuristic,
});
const verdict: Decoder<Verdict> = tagged("action", {
  undecidable: tagged("reason", {
    no_gsc_property: object({ action: literal("undecidable"), reason: literal("no_gsc_property"), provenance: literal(null) }),
    gsc_unavailable: undecidableWithGsc,
    gsc_partial: undecidableWithGsc,
    gsc_inconsistent: undecidableWithGsc,
    position_unavailable: undecidableWithGsc,
  }),
  create: tagged("reason", {
    not_observed: object({
      action: literal("create"),
      reason: literal("not_observed"),
      existing: literal(null),
      provenance: gscHeuristic,
    }),
    below_impression_floor: object({
      action: literal("create"),
      reason: literal("below_impression_floor"),
      existing: nullable(object({ ...existingPage, avg_position: nullable(positive) })),
      provenance: gscHeuristic,
    }),
    beyond_position_cap: object({
      action: literal("create"),
      reason: literal("beyond_position_cap"),
      existing: object({ ...existingPage, avg_position: positive }),
      provenance: gscHeuristic,
    }),
  }),
  update: object({
    action: literal("update"),
    reason: literal("self_compete"),
    target_url: httpUrl,
    observed: object({ ...existingPage, avg_position: positive }),
    provenance: gscHeuristic,
  }),
});

const serpHeuristic = heuristic("dataforseo_serp");

const intentField: Decoder<IntentField> = tagged("status", {
  available: object({
    status: literal("available"),
    value: oneOf(INTENT_VALUES),
    matched: integer(),
    confidence: oneOf(["confirmed", "provisional"]),
    provenance: serpHeuristic,
    rules_hit: array(text()),
  }),
  unavailable,
});

const formatField: Decoder<FormatField> = tagged("status", {
  available: object({
    status: literal("available"),
    values: nonEmpty(oneOf(CLASSIFIED_SERP_FORMATS), { max: CLASSIFIED_SERP_FORMATS.length, unique: true }),
    distribution: recordOf(CLASSIFIED_SERP_FORMATS, integer()),
    unknown_count: integer(),
    classified: integer(),
    plurality_threshold: literal(FORMAT_PLURALITY_MIN),
    has_plurality: boolean,
    provenance: serpHeuristic,
  }),
  unavailable,
});

const lengthField: Decoder<LengthField> = tagged("status", {
  available: object({
    status: literal("available"),
    p25: finite(0),
    median: finite(0),
    p75: finite(0),
    pages_counted: integer(),
    tokenizer: literal("whitespace"),
    provenance: observedBy("crawl"),
  }),
  unavailable,
});

const clusterMember = object({
  observation_id: identifier("C"),
  heading: text(HEADING_MAX_CHARS),
  level: oneOf(HEADING_LEVELS),
});

const mustAnswerItem: Decoder<MustAnswerItem> = object({
  id: identifier("Q"),
  q: modelText(QUESTION_MAX_CHARS),
  q_provenance: tagged("method", { model: modelProvenance, heuristic: heuristic("crawl") }),
  cluster: object({ canonical_heading: text(HEADING_MAX_CHARS), members: nonEmpty(clusterMember) }),
  covered_by: integer(),
});

const mustAnswerField: Decoder<MustAnswerField> = tagged("status", {
  available: object({ status: literal("available"), items: array(mustAnswerItem, { max: MUST_ANSWER_CAP }) }),
  unavailable,
});

const outlineItem = object({
  id: identifier("O"),
  h2: modelText(MODEL_TEXT_MAX_CHARS),
  h3: array(modelText(MODEL_TEXT_MAX_CHARS)),
  answers: nonEmpty(identifier("Q")),
  provenance: modelProvenance,
});

const outlineField: Decoder<OutlineField> = tagged("status", {
  available: object({ status: literal("available"), items: nonEmpty(outlineItem, { max: OUTLINE_CAP }) }),
  unavailable,
});

const gapAngleField: Decoder<GapAngleField> = tagged("status", {
  available: object({
    status: literal("available"),
    value: modelText(MODEL_TEXT_MAX_CHARS),
    rationale: modelText(MODEL_TEXT_MAX_CHARS),
    provenance: modelProvenance,
    profile_fact_refs: nonEmpty(identifier("P")),
    checked_against: array(identifier("C"), { max: SERP_DEPTH }),
  }),
  unavailable,
});

const internalLinksField: Decoder<InternalLinksField> = tagged("status", {
  available: object({
    status: literal("available"),
    items: array(
      object({ page_ref: identifier("G"), why: modelText(MODEL_TEXT_MAX_CHARS), why_provenance: modelProvenance }),
      { max: INTERNAL_LINKS_CAP },
    ),
  }),
  unavailable,
});

const doNotCoverField: Decoder<DoNotCoverField> = tagged("status", {
  available: object({
    status: literal("available"),
    items: array(
      object({ page_ref: identifier("G"), topic: modelText(MODEL_TEXT_MAX_CHARS), topic_provenance: modelProvenance }),
      { max: DO_NOT_COVER_CAP },
    ),
  }),
  unavailable,
});

const contentBrief: Decoder<ContentBrief> = object({
  schema: literal(CONTENT_BRIEF_SCHEMA),
  run: briefRunMeta,
  keyword: object({
    primary: text(FREE_TEXT_MAX_CHARS, 1),
    supporting: array(text(FREE_TEXT_MAX_CHARS, 1), { max: SUPPORTING_KEYWORDS_MAX }),
    market: text(FREE_TEXT_MAX_CHARS, 1),
    language: text(FREE_TEXT_MAX_CHARS, 1),
  }),
  evidence: evidenceLedger,
  verdict,
  intent: intentField,
  format: formatField,
  length: lengthField,
  must_answer: mustAnswerField,
  outline: outlineField,
  gap_angle: gapAngleField,
  internal_links: internalLinksField,
  do_not_cover: doNotCoverField,
  draft_readiness: object({
    writable: array(identifier("O"), { max: OUTLINE_CAP }),
    gaps: array(oneOf(GAP_KINDS), { max: GAP_KINDS.length }),
  }),
  budget: object({
    outline_cap: literal(OUTLINE_CAP),
    must_answer_cap: literal(MUST_ANSWER_CAP),
    must_answer_min_pages: literal(MUST_ANSWER_MIN_PAGES),
    must_answer_candidates: integer(),
    must_answer_shown: integer(),
    must_answer_hidden: integer(),
  }),
});

/* ------------------------------------------------------------------ */
/* entry points used by parse-brief.ts                                  */
/* ------------------------------------------------------------------ */

/** UTF-8 bytes of the JSON form; `Buffer.byteLength(JSON.stringify(x))` without a Node-only global. */
function byteLength(input: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(input)).byteLength;
  } catch {
    return null;
  }
}

/** Record check, byte cap, schema literal, then the exact shape. No cross-field invariants. */
export function decodeBriefShape(input: unknown, path: string): Decoded<ContentBrief> {
  if (!isRecord(input)) return invalid(path);
  const bytes = byteLength(input);
  if (bytes === null || bytes > CONTENT_BRIEF_HANDOFF_MAX_BYTES) return invalid(path);
  if (input["schema"] !== CONTENT_BRIEF_SCHEMA) {
    return { ok: false, code: "brief_schema_mismatch", path: at(path, "schema") };
  }
  return contentBrief(input, path);
}

const passthrough: Decoder<unknown> = (input) => ok(input);

/** The sessionStorage envelope; `brief` is handed back untouched for decodeBriefShape. */
export const handoffEnvelope = object({
  version: literal(1),
  created_at: integer(),
  expires_at: integer(),
  brief: passthrough,
});
