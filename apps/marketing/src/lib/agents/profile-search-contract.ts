// @input  -- profile-search API values crossing from the server to Agent clients
// @output -- a discriminated v1 response type and strict browser-safe guard
// @pos    -- public wire contract for bounded search-competitor enrichment

export const AGENT_PROFILE_SEARCH_SCHEMA_VERSION =
  "agent_profile_search.v1" as const;

const PUBLIC_HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type AgentProfileSearchAgent = "seo" | "tech";
export type AgentProfileSearchAvailability =
  | "available"
  | "no_data"
  | "market_unsupported"
  | "source_unavailable";
export type AgentProfileSearchMethod =
  | "competitors_domain"
  | "target_query_serp";

export interface AgentProfileSearchMarket {
  readonly code: string;
  readonly locationCode: number | null;
  readonly languageCode: string | null;
}

/** Search-overlap evidence. It is deliberately not named a product competitor. */
export interface AgentProfileSearchOverlapRow {
  readonly kind: "organic_search_overlap";
  readonly domain: string;
  /** Count of ranking keywords shared with the target; never a percentage. */
  readonly intersections: number;
  readonly averagePosition: number;
  readonly summedPosition: number;
  readonly organicEstimatedTrafficVolume: number;
}

/** One organic rank observed for the explicit target query. */
export interface AgentProfileSearchSerpRow {
  readonly kind: "target_query_serp";
  readonly domain: string;
  readonly rank: number;
}

interface AgentProfileSearchBase {
  readonly schemaVersion: typeof AGENT_PROFILE_SEARCH_SCHEMA_VERSION;
  readonly agent: AgentProfileSearchAgent;
  readonly targetHost: string;
  readonly market: AgentProfileSearchMarket;
}

export interface AgentProfileSearchOverlapData
  extends AgentProfileSearchBase {
  readonly availability: "available" | "no_data";
  readonly method: "competitors_domain";
  readonly observedAt: string;
  readonly rows: readonly AgentProfileSearchOverlapRow[];
}

export interface AgentProfileSearchSerpData extends AgentProfileSearchBase {
  readonly availability: "available" | "no_data";
  readonly method: "target_query_serp";
  readonly observedAt: string;
  readonly rows: readonly AgentProfileSearchSerpRow[];
}

export interface AgentProfileSearchMarketUnsupportedData
  extends AgentProfileSearchBase {
  readonly availability: "market_unsupported";
  readonly method: null;
  readonly market: {
    readonly code: string;
    readonly locationCode: null;
    readonly languageCode: null;
  };
  readonly observedAt: null;
  readonly rows: readonly [];
}

export interface AgentProfileSearchSourceUnavailableData
  extends AgentProfileSearchBase {
  readonly availability: "source_unavailable";
  /** The provider method selected before credentials/transport became unavailable. */
  readonly method: AgentProfileSearchMethod;
  readonly market: {
    readonly code: string;
    readonly locationCode: number;
    readonly languageCode: string;
  };
  readonly observedAt: null;
  readonly rows: readonly [];
}

export type AgentProfileSearchData =
  | AgentProfileSearchOverlapData
  | AgentProfileSearchSerpData
  | AgentProfileSearchMarketUnsupportedData
  | AgentProfileSearchSourceUnavailableData;

export interface AgentProfileSearchEnvelope {
  readonly data: AgentProfileSearchData;
}

type UnknownObject = Readonly<Record<string, unknown>>;

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

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function normalizeAgentProfileSearchDomain(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return PUBLIC_HOSTNAME_RE.test(domain) ? domain : null;
}

function domainKey(value: unknown): string | null {
  const normalized = normalizeAgentProfileSearchDomain(value);
  return normalized === value ? normalized : null;
}

function isMarket(value: unknown): value is AgentProfileSearchMarket {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["code", "locationCode", "languageCode"]) ||
    typeof value.code !== "string" ||
    !/^[A-Z]{2}$/.test(value.code)
  ) {
    return false;
  }
  if (value.locationCode === null || value.languageCode === null) {
    return value.locationCode === null && value.languageCode === null;
  }
  return (
    isPositiveInteger(value.locationCode) &&
    typeof value.languageCode === "string" &&
    /^[a-z]{2,3}$/.test(value.languageCode)
  );
}

function isOverlapRow(value: unknown): value is AgentProfileSearchOverlapRow {
  return (
    isObject(value) &&
    hasExactKeys(value, [
      "kind",
      "domain",
      "intersections",
      "averagePosition",
      "summedPosition",
      "organicEstimatedTrafficVolume",
    ]) &&
    value.kind === "organic_search_overlap" &&
    domainKey(value.domain) !== null &&
    isPositiveInteger(value.intersections) &&
    isNonNegativeFinite(value.averagePosition) &&
    isNonNegativeFinite(value.summedPosition) &&
    isNonNegativeFinite(value.organicEstimatedTrafficVolume)
  );
}

function isSerpRow(value: unknown): value is AgentProfileSearchSerpRow {
  return (
    isObject(value) &&
    hasExactKeys(value, ["kind", "domain", "rank"]) &&
    value.kind === "target_query_serp" &&
    domainKey(value.domain) !== null &&
    isPositiveInteger(value.rank)
  );
}

function hasUniqueBoundedDomains(rows: readonly unknown[]): boolean {
  if (rows.length > 10) return false;
  const domains = rows.map((row) =>
    isObject(row) ? domainKey(row.domain) : null,
  );
  return (
    domains.every((domain): domain is string => domain !== null) &&
    new Set(domains).size === domains.length
  );
}

function isData(value: unknown): value is AgentProfileSearchData {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "agent",
      "targetHost",
      "availability",
      "method",
      "market",
      "observedAt",
      "rows",
    ]) ||
    value.schemaVersion !== AGENT_PROFILE_SEARCH_SCHEMA_VERSION ||
    (value.agent !== "seo" && value.agent !== "tech") ||
    domainKey(value.targetHost) === null ||
    !isMarket(value.market) ||
    !Array.isArray(value.rows) ||
    !hasUniqueBoundedDomains(value.rows)
  ) {
    return false;
  }

  if (value.availability === "market_unsupported") {
    if (value.observedAt !== null || value.rows.length !== 0) return false;
    return (
      value.method === null &&
      value.market.locationCode === null &&
      value.market.languageCode === null
    );
  }

  if (value.availability === "source_unavailable") {
    return (
      value.observedAt === null &&
      value.rows.length === 0 &&
      (value.method === "competitors_domain" ||
        value.method === "target_query_serp") &&
      value.market.locationCode !== null &&
      value.market.languageCode !== null
    );
  }

  if (
    (value.availability !== "available" &&
      value.availability !== "no_data") ||
    !isCanonicalIsoTimestamp(value.observedAt) ||
    value.market.locationCode === null ||
    value.market.languageCode === null ||
    (value.availability === "available" && value.rows.length === 0) ||
    (value.availability === "no_data" && value.rows.length !== 0)
  ) {
    return false;
  }

  if (value.method === "competitors_domain") {
    return value.rows.every(isOverlapRow);
  }
  if (value.method === "target_query_serp") {
    return value.rows.every(isSerpRow);
  }
  return false;
}

export function isAgentProfileSearchEnvelope(
  value: unknown,
): value is AgentProfileSearchEnvelope {
  return (
    isObject(value) &&
    hasExactKeys(value, ["data"]) &&
    isData(value.data)
  );
}
