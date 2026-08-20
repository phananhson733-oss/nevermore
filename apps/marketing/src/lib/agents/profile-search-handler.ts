// @input  -- authenticated same-origin profile-search POST plus exact search context
// @output -- cost-bounded DataForSEO overlap/SERP evidence or typed availability
// @pos    -- marketing-only server boundary for Agent profile search enrichment

import {
  HttpDataForSeoClient,
  createDataForSeoKeywordMetricsClient,
  resolveDataForSeoMarket,
  type DataForSeoCompetitorsDomainRequest,
  type DataForSeoCompetitorsDomainResponse,
  type DataForSeoMarketResolution,
  type DataForSeoSerpCompetitorsRequest,
  type DataForSeoSerpCompetitorsResponse,
  type DataForSeoSerpOrganicRequest,
  type DataForSeoSerpOrganicResponse,
} from "@sf/sources";
import {
  normalizeSeoAuditUrl,
  type SeoAuditUrlResult,
} from "@sf/public-tools";
import { createHash } from "node:crypto";
import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import { isSameOriginPost } from "../auth/disconnect.ts";
import { extractClientIp } from "../rate-limit.ts";
import {
  readCrawlCache,
  writeCrawlCache,
  type CachedCrawl,
} from "../tools/crawl-cache.ts";
import {
  acquirePublicToolSlot,
  readPublicToolJson,
  type PublicToolJsonResult,
  type PublicToolSlot,
} from "../tools/public-tool-request.ts";
import type { AgentKind } from "./audit-contract.ts";
import {
  canonicalAgentLanguageTag,
  isAgentMarketCodeValid,
} from "./profile-input-validation.ts";
import {
  AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
  isAgentProfileSearchEnvelope,
  normalizeAgentProfileSearchDomain,
  type AgentProfileSearchData,
  type AgentProfileSearchMethod,
  type AgentProfileSearchOverlapRow,
  type AgentProfileSearchSeedSerpCompetitorRow,
  type AgentProfileSearchSerpRow,
} from "./profile-search-contract.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;
const TARGET_QUERY_MAX_LENGTH = 200;
const RESULT_LIMIT = 10;
const COMPETITOR_MAXIMUM_RANK_GROUP = 100;
const PRODUCT_PROFILE_SEARCH_SEED_MAX_LENGTH = 200;
const PRODUCT_PROFILE_SEARCH_SEED_LIMIT = 5;
const CN_LOCATION_CODE = 2156;
const CN_LANGUAGE_CODE = "zh";

interface AgentProfileSearchCredentials {
  readonly login: string;
  readonly password: string;
}

export interface AgentProfileSearchProvider {
  readonly competitorsDomain: (
    request: DataForSeoCompetitorsDomainRequest,
    signal?: AbortSignal,
  ) => Promise<DataForSeoCompetitorsDomainResponse>;
  readonly serpCompetitors: (
    request: DataForSeoSerpCompetitorsRequest,
    signal?: AbortSignal,
  ) => Promise<DataForSeoSerpCompetitorsResponse>;
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
  readonly isSameOriginPost: (request: Request) => boolean;
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
  readonly readCache: (
    namespace: string,
    targetHost: string,
  ) => Promise<CachedCrawl | null>;
  readonly writeCache: (
    namespace: string,
    targetHost: string,
    payload: unknown,
  ) => Promise<void>;
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
    serpCompetitors: (request, signal) =>
      labs.serpCompetitors(request, signal),
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
  isSameOriginPost,
  normalizeUrl: normalizeSeoAuditUrl,
  resolveMarket: resolveDataForSeoMarket,
  credentials: providerCredentials,
  createProvider,
  extractClientIp,
  acquireSlot: acquirePublicToolSlot,
  readCache: (namespace, host) => readCrawlCache(namespace, host),
  writeCache: (namespace, host, payload) =>
    writeCrawlCache(namespace, host, payload),
  now: Date.now,
  log: defaultLog,
};

interface ProfileSearchInput {
  readonly url: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly targetQuery: string;
  readonly productProfileSearchSeeds: readonly string[];
}

interface PlannedSearch {
  readonly method: AgentProfileSearchMethod;
  readonly market: {
    readonly code: string;
    readonly locationCode: number;
    readonly languageCode: string;
  };
}

interface ProfileSearchCacheIdentity {
  readonly normalizedUrl: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly targetQuery: string;
  readonly method: AgentProfileSearchMethod;
  readonly providerMarketCode: string;
  readonly providerLocationCode: number;
  readonly providerLanguageCode: string;
  readonly maximumRankGroup: number | null;
  readonly fallbackWhenProjectedOverlapEmpty: boolean;
  readonly maximumProductProfileSearchSeeds: number | null;
  readonly productProfileSearchSeeds: readonly string[];
  readonly serpCompetitorsLimit: number | null;
}

function profileSearchCacheNamespace(
  agent: AgentKind,
  identity: ProfileSearchCacheIdentity,
): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
        agent,
        ...identity,
      }),
    )
    .digest("hex");
  return `agent_profile_search_v3_${agent}_${fingerprint}`;
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

function canonicalProductProfileSearchSeeds(
  value: unknown,
): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const seeds: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const seed = candidate.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (
      seed === "" ||
      seed.length > PRODUCT_PROFILE_SEARCH_SEED_MAX_LENGTH
    ) {
      return null;
    }
    const identity = seed.toLocaleLowerCase("en-US");
    if (seen.has(identity)) continue;
    if (seeds.length === PRODUCT_PROFILE_SEARCH_SEED_LIMIT) return null;
    seen.add(identity);
    seeds.push(seed);
  }
  return Object.freeze(seeds);
}

function parseInput(value: unknown): ProfileSearchInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const object = value as Readonly<Record<string, unknown>>;
  const expected = [
    "url",
    "marketCode",
    "languageTag",
    "targetQuery",
    "productProfileSearchSeeds",
  ];
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
  const languageTag = canonicalAgentLanguageTag(object.languageTag);
  const targetQuery = object.targetQuery.trim();
  const productProfileSearchSeeds = canonicalProductProfileSearchSeeds(
    object.productProfileSearchSeeds,
  );
  if (
    !isAgentMarketCodeValid(marketCode) ||
    languageTag === null ||
    targetQuery.length > TARGET_QUERY_MAX_LENGTH ||
    productProfileSearchSeeds === null
  ) {
    return null;
  }
  return {
    url: object.url,
    marketCode,
    languageTag,
    targetQuery,
    productProfileSearchSeeds,
  };
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

function projectSeedSerpCompetitorRows(
  rows: DataForSeoSerpCompetitorsResponse["rows"],
  target: string,
): readonly AgentProfileSearchSeedSerpCompetitorRow[] {
  const byDomain = new Map<string, AgentProfileSearchSeedSerpCompetitorRow>();
  for (const row of rows) {
    const domain = domainKey(row.domain);
    if (
      domain === null ||
      domain === target ||
      !finiteNonNegative(row.averagePosition) ||
      !finiteNonNegative(row.medianPosition) ||
      !finiteNonNegative(row.rating) ||
      !finiteNonNegative(row.organicEstimatedTrafficVolume) ||
      !Number.isSafeInteger(row.keywordsCount) ||
      row.keywordsCount < 0 ||
      !finiteNonNegative(row.visibility) ||
      !Number.isSafeInteger(row.relevantSerpItems) ||
      row.relevantSerpItems < 0
    ) {
      continue;
    }
    const projected: AgentProfileSearchSeedSerpCompetitorRow = {
      kind: "profile_seed_serp_competitor",
      domain,
      averagePosition: row.averagePosition,
      medianPosition: row.medianPosition,
      rating: row.rating,
      organicEstimatedTrafficVolume: row.organicEstimatedTrafficVolume,
      keywordsCount: row.keywordsCount,
      visibility: row.visibility,
      relevantSerpItems: row.relevantSerpItems,
    };
    const existing = byDomain.get(domain);
    if (existing !== undefined && existing.rating >= projected.rating) {
      continue;
    }
    byDomain.set(domain, projected);
  }
  return [...byDomain.values()]
    .sort(
      (left, right) =>
        right.rating - left.rating ||
        right.keywordsCount - left.keywordsCount ||
        left.domain.localeCompare(right.domain, "en"),
    )
    .slice(0, RESULT_LIMIT);
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
  method: AgentProfileSearchMethod = plan.method,
): AgentProfileSearchData {
  return {
    schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
    agent,
    targetHost: target,
    availability: "source_unavailable",
    method,
    market: plan.market,
    observedAt: null,
    rows: [],
  };
}

function cachedDataMatches(
  value: unknown,
  agent: AgentKind,
  target: string,
  plan: PlannedSearch,
  productProfileSearchSeeds: readonly string[],
): value is AgentProfileSearchData {
  const envelope = { data: value };
  if (!isAgentProfileSearchEnvelope(envelope)) return false;
  const data = envelope.data;
  if (
    !(
      (data.availability === "available" ||
        data.availability === "no_data") &&
      data.agent === agent &&
      data.targetHost === target &&
      data.market.code === plan.market.code &&
      data.market.locationCode === plan.market.locationCode &&
      data.market.languageCode === plan.market.languageCode
    )
  ) {
    return false;
  }
  if (plan.method === "target_query_serp") {
    return data.method === "target_query_serp";
  }
  if (data.method === "serp_competitors") {
    return productProfileSearchSeeds.length > 0;
  }
  return (
    data.method === "competitors_domain" &&
    (data.availability === "available" ||
      productProfileSearchSeeds.length === 0)
  );
}

function isCanonicalCapturedAt(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

async function writeCacheFailSoft(
  dependencies: AgentProfileSearchDependencies,
  namespace: string,
  target: string,
  data: AgentProfileSearchData,
): Promise<void> {
  try {
    await dependencies.writeCache(namespace, target, data);
  } catch {
    // Search evidence remains usable when the shared cache is unavailable.
  }
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
  if (!dependencies.isSameOriginPost(request)) {
    return error("invalid_origin", 403);
  }

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

  const cacheNamespace = profileSearchCacheNamespace(agent, {
    normalizedUrl: normalized.url,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    targetQuery:
      plan.method === "target_query_serp" ? input.targetQuery : "",
    method: plan.method,
    providerMarketCode: plan.market.code,
    providerLocationCode: plan.market.locationCode,
    providerLanguageCode: plan.market.languageCode,
    maximumRankGroup:
      plan.method === "competitors_domain"
        ? COMPETITOR_MAXIMUM_RANK_GROUP
        : null,
    fallbackWhenProjectedOverlapEmpty:
      plan.method === "competitors_domain",
    maximumProductProfileSearchSeeds:
      plan.method === "competitors_domain"
        ? PRODUCT_PROFILE_SEARCH_SEED_LIMIT
        : null,
    productProfileSearchSeeds:
      plan.method === "competitors_domain"
        ? input.productProfileSearchSeeds
        : [],
    serpCompetitorsLimit:
      plan.method === "competitors_domain" ? RESULT_LIMIT : null,
  });
  try {
    const cached = await dependencies.readCache(cacheNamespace, target);
    if (
      cached !== null &&
      isCanonicalCapturedAt(cached.capturedAt) &&
      cachedDataMatches(
        cached.payload,
        agent,
        target,
        plan,
        input.productProfileSearchSeeds,
      )
    ) {
      return json({ data: cached.payload });
    }
  } catch {
    // Cache reads fail soft; the authenticated request continues to the provider.
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
    let attemptedMethod: AgentProfileSearchMethod = plan.method;
    try {
      const provider = dependencies.createProvider(credentials);
      if (plan.method === "competitors_domain") {
        const overlapResult = await provider.competitorsDomain(
          {
            target,
            locationCode: plan.market.locationCode,
            languageCode: plan.market.languageCode,
            limit: RESULT_LIMIT,
            maximumRankGroup: COMPETITOR_MAXIMUM_RANK_GROUP,
          },
          request.signal,
        );
        const overlapRows = projectOverlapRows(overlapResult.rows, target);
        if (
          overlapRows.length === 0 &&
          input.productProfileSearchSeeds.length > 0
        ) {
          attemptedMethod = "serp_competitors";
          const seedSerpResult = await provider.serpCompetitors(
            {
              keywords: input.productProfileSearchSeeds,
              locationCode: plan.market.locationCode,
              languageCode: plan.market.languageCode,
              limit: RESULT_LIMIT,
            },
            request.signal,
          );
          const rows = projectSeedSerpCompetitorRows(
            seedSerpResult.rows,
            target,
          );
          const availability = rows.length === 0 ? "no_data" : "available";
          dependencies.log({
            agent,
            method: attemptedMethod,
            status: availability,
            costUsd: Number(
              (overlapResult.costUsd + seedSerpResult.costUsd).toFixed(12),
            ),
          });
          const data: AgentProfileSearchData = {
            schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
            agent,
            targetHost: target,
            availability,
            method: attemptedMethod,
            market: plan.market,
            observedAt: new Date(dependencies.now()).toISOString(),
            rows,
          };
          await writeCacheFailSoft(
            dependencies,
            cacheNamespace,
            target,
            data,
          );
          return json({ data });
        }
        const availability =
          overlapRows.length === 0 ? "no_data" : "available";
        dependencies.log({
          agent,
          method: plan.method,
          status: availability,
          costUsd: overlapResult.costUsd,
        });
        const data: AgentProfileSearchData = {
          schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
          agent,
          targetHost: target,
          availability,
          method: plan.method,
          market: plan.market,
          observedAt: new Date(dependencies.now()).toISOString(),
          rows: overlapRows,
        };
        await writeCacheFailSoft(
          dependencies,
          cacheNamespace,
          target,
          data,
        );
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
        method: "target_query_serp",
        status: availability,
        costUsd: result.costUsd,
      });
      const data: AgentProfileSearchData = {
        schemaVersion: AGENT_PROFILE_SEARCH_SCHEMA_VERSION,
        agent,
        targetHost: target,
        availability,
        method: "target_query_serp",
        market: plan.market,
        observedAt: new Date(dependencies.now()).toISOString(),
        rows,
      };
      await writeCacheFailSoft(
        dependencies,
        cacheNamespace,
        target,
        data,
      );
      return json({ data });
    } catch {
      dependencies.log({
        agent,
        method: attemptedMethod,
        status: "source_unavailable",
        costUsd: null,
      });
      return json({
        data: sourceUnavailableData(agent, target, plan, attemptedMethod),
      });
    }
  } finally {
    slot.release();
  }
}
