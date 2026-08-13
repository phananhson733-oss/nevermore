// @input  -- authenticated exact profile-search POST plus explicit market/language/query
// @output -- cost-bounded DataForSEO overlap/SERP evidence or typed availability
// @pos    -- marketing-only server boundary for Agent profile search enrichment

import {
  HttpDataForSeoClient,
  createDataForSeoKeywordMetricsClient,
  resolveDataForSeoMarket,
  type DataForSeoCompetitorsDomainRequest,
  type DataForSeoCompetitorsDomainResponse,
  type DataForSeoMarketResolution,
  type DataForSeoSerpOrganicRequest,
  type DataForSeoSerpOrganicResponse,
} from "@sf/sources";
import {
  normalizeSeoAuditUrl,
  type SeoAuditUrlResult,
} from "@sf/public-tools";
import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import { extractClientIp } from "../rate-limit.ts";
import {
  acquirePublicToolSlot,
  readPublicToolJson,
  type PublicToolJsonResult,
  type PublicToolSlot,
} from "../tools/public-tool-request.ts";
import {
  consumePublicToolQuota,
  DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  type SharedQuotaDependencies,
} from "../tools/shared-rate-limit.ts";
import type { AgentKind } from "./audit-contract.ts";
import {
  AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
  normalizeAgentProfileSearchDomain,
  type AgentProfileSearchData,
  type AgentProfileSearchMethod,
  type AgentProfileSearchOverlapRow,
  type AgentProfileSearchSerpRow,
} from "./profile-search-contract.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;
const TARGET_QUERY_MAX_LENGTH = 200;
const RESULT_LIMIT = 10;
const CN_LOCATION_CODE = 2156;
const CN_LANGUAGE_CODE = "zh";

export const AGENT_PROFILE_SEARCH_DAILY_IP_MAX = 5;
export const AGENT_PROFILE_SEARCH_DAILY_GLOBAL_MAX = 100;
export const AGENT_PROFILE_SEARCH_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

interface AgentProfileSearchCredentials {
  readonly login: string;
  readonly password: string;
}

export interface AgentProfileSearchProvider {
  readonly competitorsDomain: (
    request: DataForSeoCompetitorsDomainRequest,
    signal?: AbortSignal,
  ) => Promise<DataForSeoCompetitorsDomainResponse>;
  readonly serpOrganic: (
    request: DataForSeoSerpOrganicRequest,
    signal?: AbortSignal,
  ) => Promise<DataForSeoSerpOrganicResponse>;
}

export interface AgentProfileSearchLog {
  readonly agent: AgentKind;
  readonly method: AgentProfileSearchMethod;
  readonly status: "available" | "no_data" | "source_unavailable";
  readonly costUsd: number | null;
}

export interface AgentProfileSearchDependencies {
  readonly authenticate: () => Promise<ServerAuthenticationStatus>;
  readonly normalizeUrl: (value: unknown) => SeoAuditUrlResult;
  readonly resolveMarket: (
    marketCode: unknown,
    preferredLanguage?: unknown,
  ) => DataForSeoMarketResolution | null;
  readonly credentials: () => AgentProfileSearchCredentials | null;
  readonly createProvider: (
    credentials: AgentProfileSearchCredentials,
  ) => AgentProfileSearchProvider;
  readonly extractClientIp: (headers: Headers) => string;
  readonly acquireSlot: (key: string) => PublicToolSlot;
  readonly quota: SharedQuotaDependencies;
  readonly now: () => number;
  /** Receives a sealed operational record: no URL, query, provider prose, or credentials. */
  readonly log: (record: AgentProfileSearchLog) => void;
}

function providerCredentials(): AgentProfileSearchCredentials | null {
  const login = process.env["DATAFORSEO_LOGIN"]?.trim() ?? "";
  const password = process.env["DATAFORSEO_PASSWORD"]?.trim() ?? "";
  return login === "" || password === "" ? null : { login, password };
}

function createProvider(
  credentials: AgentProfileSearchCredentials,
): AgentProfileSearchProvider {
  const labs = new HttpDataForSeoClient(credentials);
  const keywordMetrics = createDataForSeoKeywordMetricsClient(credentials);
  return {
    competitorsDomain: (request, signal) =>
      labs.competitorsDomain(request, signal),
    serpOrganic: (request, signal) =>
      keywordMetrics.serpOrganic(request, signal),
  };
}

function defaultLog(record: AgentProfileSearchLog): void {
  console.info(
    JSON.stringify({ event: "agent_profile_search", ...record }),
  );
}

const DEFAULT_DEPENDENCIES: AgentProfileSearchDependencies = {
  authenticate: getServerAuthenticationStatus,
  normalizeUrl: normalizeSeoAuditUrl,
  resolveMarket: resolveDataForSeoMarket,
  credentials: providerCredentials,
  createProvider,
  extractClientIp,
  acquireSlot: acquirePublicToolSlot,
  quota: DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  now: Date.now,
  log: defaultLog,
};

interface ProfileSearchInput {
  readonly url: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly targetQuery: string;
}

interface PlannedSearch {
  readonly method: AgentProfileSearchMethod;
  readonly market: {
    readonly code: string;
    readonly locationCode: number;
    readonly languageCode: string;
  };
}

function json(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      ...headers,
    },
  });
}

function error(code: string, status: number, retryAfter?: number): Response {
  return json(
    { error: { code } },
    status,
    retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) },
  );
}

function canonicalLanguageTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 35) return null;
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
}

function parseInput(value: unknown): ProfileSearchInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const object = value as Readonly<Record<string, unknown>>;
  const expected = ["url", "marketCode", "languageTag", "targetQuery"];
  if (
    Object.keys(object).length !== expected.length ||
    !expected.every((key) => Object.hasOwn(object, key)) ||
    typeof object.url !== "string" ||
    typeof object.marketCode !== "string" ||
    typeof object.targetQuery !== "string"
  ) {
    return null;
  }
  const marketCode = object.marketCode.trim().toUpperCase();
  const languageTag = canonicalLanguageTag(object.languageTag);
  const targetQuery = object.targetQuery.trim();
  if (
    !/^[A-Z]{2}$/.test(marketCode) ||
    languageTag === null ||
    targetQuery.length > TARGET_QUERY_MAX_LENGTH
  ) {
    return null;
  }
  return { url: object.url, marketCode, languageTag, targetQuery };
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function agentProfileSearchIpBucket(
  clientIp: string,
  nowMs: number,
): string {
  return `agent-profile-search:ip:${clientIp}:${utcDay(nowMs)}`;
}

export function agentProfileSearchGlobalBucket(nowMs: number): string {
  return `agent-profile-search:global:${utcDay(nowMs)}`;
}

function inflightKey(clientIp: string): string {
  return `agents:profile-search:inflight:${clientIp}`;
}

function domainKey(value: unknown): string | null {
  return normalizeAgentProfileSearchDomain(value);
}

function targetHost(normalizedUrl: string): string {
  return domainKey(new URL(normalizedUrl).hostname) ?? "";
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function projectOverlapRows(
  rows: DataForSeoCompetitorsDomainResponse["rows"],
  target: string,
): readonly AgentProfileSearchOverlapRow[] {
  const projected: AgentProfileSearchOverlapRow[] = [];
  const seen = new Set<string>([target]);
  for (const row of rows) {
    const domain = domainKey(row.domain);
    if (
      domain === null ||
      seen.has(domain) ||
      !Number.isSafeInteger(row.intersections) ||
      row.intersections <= 0 ||
      !finiteNonNegative(row.averagePosition) ||
      !finiteNonNegative(row.summedPosition) ||
      !finiteNonNegative(row.organicEstimatedTrafficVolume)
    ) {
      continue;
    }
    seen.add(domain);
    projected.push({
      kind: "organic_search_overlap",
      domain,
      intersections: row.intersections,
      averagePosition: row.averagePosition,
      summedPosition: row.summedPosition,
      organicEstimatedTrafficVolume: row.organicEstimatedTrafficVolume,
    });
    if (projected.length === RESULT_LIMIT) break;
  }
  return projected;
}

function projectSerpRows(
  rows: DataForSeoSerpOrganicResponse["rows"],
  target: string,
): readonly AgentProfileSearchSerpRow[] {
  const projected: AgentProfileSearchSerpRow[] = [];
  const seen = new Set<string>([target]);
  for (const row of rows) {
    const domain = domainKey(row.domain);
    if (
      domain === null ||
      seen.has(domain) ||
      !Number.isSafeInteger(row.rankGroup) ||
      row.rankGroup <= 0
    ) {
      continue;
    }
    seen.add(domain);
    projected.push({
      kind: "target_query_serp",
      domain,
      rank: row.rankGroup,
    });
    if (projected.length === RESULT_LIMIT) break;
  }
  return projected;
}

function planSearch(
  input: ProfileSearchInput,
  dependencies: AgentProfileSearchDependencies,
): PlannedSearch | null {
  const market = dependencies.resolveMarket(
    input.marketCode,
    input.languageTag,
  );
  if (market !== null) {
    return {
      method: "competitors_domain",
      market: {
        code: input.marketCode,
        locationCode: market.locationCode,
        languageCode: market.languageCode,
      },
    };
  }
  if (input.marketCode === "CN" && input.targetQuery !== "") {
    return {
      method: "target_query_serp",
      market: {
        code: "CN",
        locationCode: CN_LOCATION_CODE,
        languageCode: CN_LANGUAGE_CODE,
      },
    };
  }
  return null;
}

function marketUnsupportedData(
  agent: AgentKind,
  target: string,
  input: ProfileSearchInput,
): AgentProfileSearchData {
  return {
    schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
    agent,
    targetHost: target,
    availability: "market_unsupported",
    method: null,
    market: {
      code: input.marketCode,
      locationCode: null,
      languageCode: null,
    },
    observedAt: null,
    rows: [],
  };
}

function sourceUnavailableData(
  agent: AgentKind,
  target: string,
  plan: PlannedSearch,
): AgentProfileSearchData {
  return {
    schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
    agent,
    targetHost: target,
    availability: "source_unavailable",
    method: plan.method,
    market: plan.market,
    observedAt: null,
    rows: [],
  };
}

function requestError(result: Extract<PublicToolJsonResult, { ok: false }>): Response {
  const status =
    result.code === "unsupported_media_type"
      ? 415
      : result.code === "payload_too_large"
        ? 413
        : 400;
  return error(result.code, status);
}

async function consumeDailyQuotas(
  clientIp: string,
  dependencies: AgentProfileSearchDependencies,
): Promise<Response | null> {
  const nowMs = dependencies.now();
  for (const [bucket, max] of [
    [agentProfileSearchIpBucket(clientIp, nowMs), AGENT_PROFILE_SEARCH_DAILY_IP_MAX],
    [agentProfileSearchGlobalBucket(nowMs), AGENT_PROFILE_SEARCH_DAILY_GLOBAL_MAX],
  ] as const) {
    const outcome = await consumePublicToolQuota(
      bucket,
      max,
      AGENT_PROFILE_SEARCH_DAILY_WINDOW_SECONDS,
      dependencies.quota,
      dependencies.now,
    );
    if (outcome.kind === "unavailable") {
      console.error("[agent-profile-search] quota unavailable");
      return error("quota_unavailable", 503, 60);
    }
    if (outcome.kind === "limited") {
      return error("rate_limited", 429, outcome.retryAfterSeconds);
    }
  }
  return null;
}

export async function handleAgentProfileSearchRequest(
  request: Request,
  agent: AgentKind,
  dependencies: AgentProfileSearchDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  let authentication: ServerAuthenticationStatus = "unavailable";
  try {
    authentication = await dependencies.authenticate();
  } catch {
    authentication = "unavailable";
  }
  if (authentication === "unavailable") return error("auth_unavailable", 503);
  if (authentication === "unauthenticated") return error("auth_required", 401);

  const body = await readPublicToolJson(request, REQUEST_BODY_LIMIT_BYTES);
  if (!body.ok) return requestError(body);
  const input = parseInput(body.value);
  if (input === null) return error("invalid_request", 400);

  const normalized = dependencies.normalizeUrl(input.url);
  if (!normalized.ok) return error("invalid_url", 400);
  const target = targetHost(normalized.url);
  if (target === "") return error("invalid_url", 400);

  const plan = planSearch(input, dependencies);
  if (plan === null) {
    return json({
      data: marketUnsupportedData(agent, target, input),
    });
  }

  const credentials = dependencies.credentials();
  if (credentials === null) {
    dependencies.log({
      agent,
      method: plan.method,
      status: "source_unavailable",
      costUsd: null,
    });
    return json({
      data: sourceUnavailableData(agent, target, plan),
    });
  }

  const clientIp = dependencies.extractClientIp(request.headers);
  const slot = dependencies.acquireSlot(inflightKey(clientIp));
  if (!slot.acquired) return error("search_in_progress", 409, 5);

  try {
    const quotaRefusal = await consumeDailyQuotas(clientIp, dependencies);
    if (quotaRefusal !== null) return quotaRefusal;

    try {
      const provider = dependencies.createProvider(credentials);
      if (plan.method === "competitors_domain") {
        const result = await provider.competitorsDomain(
          {
            target,
            locationCode: plan.market.locationCode,
            languageCode: plan.market.languageCode,
            limit: RESULT_LIMIT,
          },
          request.signal,
        );
        const rows = projectOverlapRows(result.rows, target);
        const availability = rows.length === 0 ? "no_data" : "available";
        dependencies.log({
          agent,
          method: plan.method,
          status: availability,
          costUsd: result.costUsd,
        });
        const data: AgentProfileSearchData = {
          schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
          agent,
          targetHost: target,
          availability,
          method: plan.method,
          market: plan.market,
          observedAt: new Date(dependencies.now()).toISOString(),
          rows,
        };
        return json({ data });
      }

      const result = await provider.serpOrganic(
        {
          keyword: input.targetQuery,
          locationCode: plan.market.locationCode,
          languageCode: plan.market.languageCode,
          depth: RESULT_LIMIT,
        },
        request.signal,
      );
      const rows = projectSerpRows(result.rows, target);
      const availability = rows.length === 0 ? "no_data" : "available";
      dependencies.log({
        agent,
        method: plan.method,
        status: availability,
        costUsd: result.costUsd,
      });
      const data: AgentProfileSearchData = {
        schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
        agent,
        targetHost: target,
        availability,
        method: plan.method,
        market: plan.market,
        observedAt: new Date(dependencies.now()).toISOString(),
        rows,
      };
      return json({ data });
    } catch {
      dependencies.log({
        agent,
        method: plan.method,
        status: "source_unavailable",
        costUsd: null,
      });
      return json({
        data: sourceUnavailableData(agent, target, plan),
      });
    }
  } finally {
    slot.release();
  }
}
