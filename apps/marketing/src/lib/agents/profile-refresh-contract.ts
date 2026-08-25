// @input  -- profile-refresh API values crossing from the server to Agent clients
// @output -- exact v1 Product/ICP evidence types and a strict browser-safe guard
// @pos    -- public wire contract for live/cached Agent profile diagnosis

export const AGENT_PROFILE_REFRESH_SCHEMA_VERSION =
  "agent_profile_refresh.v1" as const;
export const AGENT_PROFILE_REFRESH_MAX_PROMPT_PAGES = 14;
export const AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES = 20;

export const AGENT_PROFILE_REFRESH_FIELD_PATHS = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
  "categories",
  "businessModel",
  "primaryCta",
  "trustSignals",
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpInterests",
  "icpPain",
  "icpBehavior",
  "icpPositioning",
  "jtbd",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
] as const;

export type AgentProfileRefreshAgent = "seo" | "tech";
export type AgentProfileRefreshMode = "prefer_cache" | "refresh";
export type AgentProfileRefreshAvailability =
  | "available"
  | "partial"
  | "no_data";
export type AgentProfileRefreshFieldPath =
  (typeof AGENT_PROFILE_REFRESH_FIELD_PATHS)[number];
export const AGENT_PROFILE_REFRESH_READY_FIELD_PATHS = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
  "categories",
  "businessModel",
  "primaryCta",
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpPain",
  "jtbd",
  "useCases",
] as const satisfies readonly AgentProfileRefreshFieldPath[];
export type AgentProfileRefreshStringFieldPath = Exclude<
  AgentProfileRefreshFieldPath,
  AgentProfileRefreshListFieldPath
>;
export type AgentProfileRefreshListFieldPath =
  | "coreFeatures"
  | "categories"
  | "trustSignals"
  | "icpInterests"
  | "useCases"
  | "outcomes"
  | "barriers"
  | "qualificationSignals"
  | "disqualifiers";
export type AgentProfileRefreshConfidence = "high" | "medium" | "low";
export type AgentProfileRefreshStopReason =
  | "max_urls"
  | "max_requests"
  | "max_wall_clock"
  | "max_total_bytes"
  | "aborted";

export interface AgentProfileRefreshRequest {
  /** Exact trimmed visitor input, retained so the browser can match its run. */
  readonly submittedUrl: string;
  /** Server-normalized public URL, including the submitted path and query. */
  readonly normalizedUrl: string;
  /** Lowercase hostname derived from `normalizedUrl`. */
  readonly targetHost: string;
  readonly marketCode: string;
  readonly languageTag: string;
  /** Locale in which the generated draft is written; not the target language. */
  readonly outputLocale: string;
}

interface AgentProfileRefreshAvailableBase {
  readonly state: "available";
  readonly derivation: "inferred";
  readonly confidence: AgentProfileRefreshConfidence;
  readonly source: "public_page";
  readonly limitation: string | null;
  /** Exact URLs from `diagnostics.sourceUrls`; never durable evidence IDs. */
  readonly evidenceUrls: readonly string[];
}

export interface AgentProfileRefreshAvailableStringField
  extends AgentProfileRefreshAvailableBase {
  readonly path: AgentProfileRefreshStringFieldPath;
  readonly value: string;
}

export interface AgentProfileRefreshAvailableListField
  extends AgentProfileRefreshAvailableBase {
  readonly path: AgentProfileRefreshListFieldPath;
  readonly value: readonly string[];
}

export interface AgentProfileRefreshUnavailableField {
  readonly path: AgentProfileRefreshFieldPath;
  readonly state: "unavailable";
  readonly value: null;
  readonly derivation: "missing";
  readonly confidence: "unknown";
  readonly source: "not_available";
  readonly limitation: string;
  readonly evidenceUrls: readonly [];
}

export type AgentProfileRefreshField =
  | AgentProfileRefreshAvailableStringField
  | AgentProfileRefreshAvailableListField
  | AgentProfileRefreshUnavailableField;

export interface AgentProfileRefreshCache {
  readonly status: "hit" | "fresh" | "refreshed";
  readonly capturedAt: string;
}

export interface AgentProfileRefreshDiagnostics {
  /** Origin after the guarded entry crawl resolved an allowed redirect. */
  readonly resolvedOrigin: string;
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  readonly stopReason: AgentProfileRefreshStopReason | null;
  readonly contextSufficient: boolean;
  readonly sourceUrls: readonly string[];
  readonly fieldsAvailable: number;
  readonly fieldsMissing: number;
}

export interface AgentProfileRefreshData {
  readonly schemaVersion: typeof AGENT_PROFILE_REFRESH_SCHEMA_VERSION;
  readonly agent: AgentProfileRefreshAgent;
  readonly request: AgentProfileRefreshRequest;
  readonly availability: AgentProfileRefreshAvailability;
  readonly observedAt: string;
  readonly cache: AgentProfileRefreshCache;
  readonly diagnostics: AgentProfileRefreshDiagnostics;
  readonly fields: readonly AgentProfileRefreshField[];
}

export type AgentProfileRefreshResult = AgentProfileRefreshData;

export interface AgentProfileRefreshEnvelope {
  readonly data: AgentProfileRefreshData;
}

type UnknownObject = Readonly<Record<string, unknown>>;

const LIST_FIELD_PATHS = new Set<AgentProfileRefreshFieldPath>([
  "coreFeatures",
  "categories",
  "trustSignals",
  "icpInterests",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
]);
const FIELD_PATHS = new Set<AgentProfileRefreshFieldPath>(
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
);
const STOP_REASONS = new Set<AgentProfileRefreshStopReason>([
  "max_urls",
  "max_requests",
  "max_wall_clock",
  "max_total_bytes",
  "aborted",
]);

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: UnknownObject,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isCanonicalLanguageTag(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > 35) {
    return false;
  }
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function isCanonicalLocale(value: unknown): value is string {
  return (
    isCanonicalLanguageTag(value) &&
    (value === "en" || value === "zh")
  );
}

function isPublicNormalizedUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      parsed.hash === "" &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

function isCanonicalOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function isRequest(value: unknown): value is AgentProfileRefreshRequest {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "submittedUrl",
      "normalizedUrl",
      "targetHost",
      "marketCode",
      "languageTag",
      "outputLocale",
    ]) ||
    typeof value.submittedUrl !== "string" ||
    value.submittedUrl.trim() !== value.submittedUrl ||
    value.submittedUrl === "" ||
    value.submittedUrl.length > 2_048 ||
    !isPublicNormalizedUrl(value.normalizedUrl) ||
    typeof value.targetHost !== "string" ||
    value.targetHost !== value.targetHost.toLowerCase() ||
    !/^[A-Z]{2}$/.test(value.marketCode as string) ||
    !isCanonicalLanguageTag(value.languageTag) ||
    !isCanonicalLocale(value.outputLocale)
  ) {
    return false;
  }
  return new URL(value.normalizedUrl).hostname.toLowerCase() === value.targetHost;
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function isUniqueNonEmptyStrings(
  value: unknown,
  maxItems: number,
  maxLength: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maxItems &&
    value.every((item) => isNonEmptyString(item, maxLength)) &&
    new Set(value).size === value.length
  );
}

function isSourceUrls(value: unknown): value is readonly string[] {
  return (
    isUniqueNonEmptyStrings(
      value,
      AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES,
      2_048,
    ) &&
    value.every((url) => isPublicNormalizedUrl(url))
  );
}

function isField(
  value: unknown,
  sourceUrls: ReadonlySet<string>,
): value is AgentProfileRefreshField {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "path",
      "state",
      "value",
      "derivation",
      "confidence",
      "source",
      "limitation",
      "evidenceUrls",
    ]) ||
    typeof value.path !== "string" ||
    !FIELD_PATHS.has(value.path as AgentProfileRefreshFieldPath) ||
    !Array.isArray(value.evidenceUrls)
  ) {
    return false;
  }
  const path = value.path as AgentProfileRefreshFieldPath;
  if (value.state === "unavailable") {
    return (
      value.value === null &&
      value.derivation === "missing" &&
      value.confidence === "unknown" &&
      value.source === "not_available" &&
      isNonEmptyString(value.limitation, 500) &&
      value.evidenceUrls.length === 0
    );
  }
  if (
    value.state !== "available" ||
    value.derivation !== "inferred" ||
    (value.confidence !== "high" &&
      value.confidence !== "medium" &&
      value.confidence !== "low") ||
    value.source !== "public_page" ||
    (value.limitation !== null &&
      !isNonEmptyString(value.limitation, 500)) ||
    !isUniqueNonEmptyStrings(
      value.evidenceUrls,
      AGENT_PROFILE_REFRESH_MAX_PROMPT_PAGES,
      2_048,
    ) ||
    !value.evidenceUrls.every((url) => sourceUrls.has(url))
  ) {
    return false;
  }
  return LIST_FIELD_PATHS.has(path)
    ? isUniqueNonEmptyStrings(value.value, 20, 300)
    : isNonEmptyString(value.value, 2_000);
}

export function isAgentProfileRefreshFields(
  value: unknown,
  sourceUrls: readonly string[],
): value is readonly AgentProfileRefreshField[] {
  if (
    !Array.isArray(value) ||
    value.length !== AGENT_PROFILE_REFRESH_FIELD_PATHS.length
  ) {
    return false;
  }
  const sources = new Set(sourceUrls);
  if (!value.every((field) => isField(field, sources))) return false;
  const paths = value.map((field) => field.path);
  return (
    new Set(paths).size === AGENT_PROFILE_REFRESH_FIELD_PATHS.length &&
    AGENT_PROFILE_REFRESH_FIELD_PATHS.every((path) => paths.includes(path))
  );
}

function isCache(value: unknown): value is AgentProfileRefreshCache {
  return (
    isObject(value) &&
    hasExactKeys(value, ["status", "capturedAt"]) &&
    (value.status === "hit" ||
      value.status === "fresh" ||
      value.status === "refreshed") &&
    isCanonicalIsoTimestamp(value.capturedAt)
  );
}

function isDiagnostics(
  value: unknown,
): value is AgentProfileRefreshDiagnostics {
  return (
    isObject(value) &&
    hasExactKeys(value, [
      "resolvedOrigin",
      "pagesFetched",
      "productPagesFetched",
      "stopReason",
      "contextSufficient",
      "sourceUrls",
      "fieldsAvailable",
      "fieldsMissing",
    ]) &&
    isCanonicalOrigin(value.resolvedOrigin) &&
    Number.isSafeInteger(value.pagesFetched) &&
    (value.pagesFetched as number) > 0 &&
    (value.pagesFetched as number) <=
      AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES &&
    Number.isSafeInteger(value.productPagesFetched) &&
    (value.productPagesFetched as number) >= 0 &&
    (value.productPagesFetched as number) <= (value.pagesFetched as number) &&
    (value.stopReason === null ||
      STOP_REASONS.has(value.stopReason as AgentProfileRefreshStopReason)) &&
    typeof value.contextSufficient === "boolean" &&
    value.contextSufficient === ((value.pagesFetched as number) >= 3) &&
    isSourceUrls(value.sourceUrls) &&
    value.sourceUrls.length === value.pagesFetched &&
    Number.isSafeInteger(value.fieldsAvailable) &&
    (value.fieldsAvailable as number) >= 0 &&
    Number.isSafeInteger(value.fieldsMissing) &&
    (value.fieldsMissing as number) >= 0 &&
    (value.fieldsAvailable as number) + (value.fieldsMissing as number) ===
      AGENT_PROFILE_REFRESH_FIELD_PATHS.length
  );
}

export function isAgentProfileRefreshData(
  value: unknown,
): value is AgentProfileRefreshData {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "agent",
      "request",
      "availability",
      "observedAt",
      "cache",
      "diagnostics",
      "fields",
    ]) ||
    value.schemaVersion !== AGENT_PROFILE_REFRESH_SCHEMA_VERSION ||
    (value.agent !== "seo" && value.agent !== "tech") ||
    !isRequest(value.request) ||
    !isCanonicalIsoTimestamp(value.observedAt) ||
    !isCache(value.cache) ||
    !isDiagnostics(value.diagnostics) ||
    !isAgentProfileRefreshFields(
      value.fields,
      isObject(value.diagnostics) && Array.isArray(value.diagnostics.sourceUrls)
        ? (value.diagnostics.sourceUrls as readonly string[])
        : [],
    )
  ) {
    return false;
  }

  const available = value.fields.filter(
    (field) => field.state === "available",
  ).length;
  const availablePaths = new Set(
    value.fields
      .filter((field) => field.state === "available")
      .map((field) => field.path),
  );
  const expectedAvailability =
    available === 0
      ? "no_data"
      : AGENT_PROFILE_REFRESH_READY_FIELD_PATHS.every((path) =>
            availablePaths.has(path),
          )
        ? "available"
        : "partial";
  return (
    value.availability === expectedAvailability &&
    value.diagnostics.fieldsAvailable === available &&
    value.diagnostics.fieldsMissing === value.fields.length - available
  );
}

export function isAgentProfileRefreshEnvelope(
  value: unknown,
): value is AgentProfileRefreshEnvelope {
  return (
    isObject(value) &&
    hasExactKeys(value, ["data"]) &&
    isAgentProfileRefreshData(value.data)
  );
}
