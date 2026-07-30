/**
 * Source adapter contract (spec §7.1). All five providers (crawl/gsc/ga4/csv/
 * dataforseo) implement this one interface. Adapters return stable `errorCode`s
 * and NEVER leak provider prose into business logic. `normalize` is a pure
 * transform from raw payload to canonical observations; `unavailable` values are
 * always `null` (spec §1.3, AC-017) — never 0.
 */

export type Provider = "crawl" | "gsc" | "ga4" | "csv" | "dataforseo";

export type CollectionOperation =
  | "site_graph"
  | "search_analytics"
  | "organic_landing"
  | "keyword_gap_import"
  | "search_landscape";

export type DatasetKey =
  | "crawl.site_graph.v1"
  | "gsc.page_query_daily.v1"
  | "ga4.organic_landing_daily.v1"
  | "csv.keyword_gap.v1"
  | "dataforseo.ranked_keywords.v1"
  | "dataforseo.search_landscape.v1";

export type Availability = "available" | "partial" | "unavailable";

export interface SourceWindow {
  readonly start: string | null;
  readonly end: string | null;
}

/** A capability a configured connection can perform (advertised to the UI). */
export interface Capability {
  readonly datasetKey: DatasetKey;
  readonly operation: CollectionOperation;
  readonly available: boolean;
  readonly limitation: string;
}

/** The outcome of one collection attempt (spec §7.1). */
export interface CollectionResult<R> {
  readonly availability: Availability;
  readonly raw: R;
  readonly capturedAt: string;
  readonly sourceWindow: SourceWindow;
  readonly rowCount: number;
  readonly stopReason: string | null;
  readonly providerUsage: Record<string, number>;
  readonly limitation: string;
}

export type ObservationSubjectType =
  | "site"
  | "url"
  | "query"
  | "keyword_cluster"
  | "user_agent"
  | "page_set";

export type ObservationOrigin =
  | "first_party"
  | "direct_public"
  | "vendor_observation"
  | "user_provided";

export type Grade = "A" | "B" | "C";
export type Support = "supports" | "contradicts" | "context";

/**
 * A canonical normalized observation (spec §7.6). Exactly one `value*` is set
 * when `availability === "available"`; otherwise ALL values are null with a
 * reason in `limitation`. `method` is always `observed` at the source layer;
 * computed/inferred/generated observations are produced by the engine (§7.7).
 */
export interface NormalizedObservation {
  readonly metricKey: string;
  readonly subjectType: ObservationSubjectType;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly availability: Availability;
  readonly valueNumeric: number | null;
  readonly valueText: string | null;
  readonly valueJson: unknown | null;
  readonly unit: string | null;
  readonly origin: ObservationOrigin;
  readonly grade: Grade;
  readonly support: Support;
  readonly limitation: string;
}

/** Stable adapter error codes (spec §7.1). Provider errors map onto these. */
export const SOURCE_ERROR_CODES = [
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "INVALID_CONFIGURATION",
  "INVALID_RESPONSE",
  "NETWORK_ERROR",
  "TIMEOUT",
  "FEATURE_DISABLED",
  "UNAVAILABLE",
] as const;
export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number];

/** Whether an error is transient and safe to retry (spec §13.1). */
export function isTransient(code: SourceErrorCode): boolean {
  return (
    code === "RATE_LIMITED" ||
    code === "NETWORK_ERROR" ||
    code === "TIMEOUT" ||
    code === "UNAVAILABLE"
  );
}

export class SourceError extends Error {
  readonly code: SourceErrorCode;
  constructor(code: SourceErrorCode, message: string) {
    super(message);
    this.name = "SourceError";
    this.code = code;
  }
}

/** Context passed to a `collect` call (ids + injected io; never raw secrets in logs). */
export interface CollectionContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
}

export interface NormalizeContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly capturedAt: string;
}

/**
 * The adapter interface (spec §7.1). `C` = validated config, `P` = collect
 * params, `R` = raw payload type.
 */
export interface SourceAdapter<C, P, R> {
  readonly provider: Provider;
  validateConfig(config: unknown): Promise<C>;
  capabilities(config: C): Promise<Capability[]>;
  collect(params: P, ctx: CollectionContext): Promise<CollectionResult<R>>;
  normalize(raw: R, ctx: NormalizeContext): AsyncIterable<NormalizedObservation>;
}
