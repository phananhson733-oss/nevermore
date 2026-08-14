// @input  -- authenticated profile-search requests plus injected provider/quota seams
// @output -- auth order, strict input, cost gates, market routing, and safe projections
// @pos    -- focused TDD suite for the marketing-only DataForSEO boundary

import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PROFILE_SEARCH_DAILY_GLOBAL_MAX,
  AGENT_PROFILE_SEARCH_DAILY_IP_MAX,
  AGENT_PROFILE_SEARCH_DAILY_WINDOW_SECONDS,
  agentProfileSearchGlobalBucket,
  agentProfileSearchIpBucket,
  handleAgentProfileSearchRequest,
  type AgentProfileSearchDependencies,
  type AgentProfileSearchProvider,
} from "./profile-search-handler.ts";
import type { AgentProfileSearchData } from "./profile-search-contract.ts";

const NOW = Date.parse("2026-08-13T10:00:00.000Z");
const IP = "203.0.113.9";

function request(
  body: unknown = {
    url: "https://www.acme.com/pricing?ref=agent",
    marketCode: "US",
    languageTag: "en-US",
    targetQuery: "seo platform",
  },
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request("https://gengrowth.ai/api/agents/seo/profile-search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": IP,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function provider(): AgentProfileSearchProvider {
  return {
    competitorsDomain: vi.fn(async () => ({
      rows: [
        {
          domain: "rival.com",
          averagePosition: 4.5,
          summedPosition: 54,
          intersections: 12,
          organicEstimatedTrafficVolume: 321,
        },
      ],
      totalCount: 1,
      itemsCount: 1,
      costUsd: 0.02,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    })),
    serpOrganic: vi.fn(async () => ({
      keyword: "seo platform",
      rows: [{ rankGroup: 1, domain: "rival.com" }],
      itemTypes: [],
      unresolvedItemCount: 0,
      costUsd: 0.002,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    })),
  };
}

function cachedData(
  overrides: Partial<AgentProfileSearchData> = {},
): AgentProfileSearchData {
  return {
    schemaVersion: "agent_profile_search.v1",
    agent: "seo",
    targetHost: "acme.com",
    availability: "available",
    method: "competitors_domain",
    market: { code: "US", locationCode: 2840, languageCode: "en" },
    observedAt: "2026-08-13T10:00:00.000Z",
    rows: [
      {
        kind: "organic_search_overlap",
        domain: "cached-rival.com",
        intersections: 8,
        averagePosition: 5,
        summedPosition: 40,
        organicEstimatedTrafficVolume: 200,
      },
    ],
    ...overrides,
  } as AgentProfileSearchData;
}

function dependencies(
  overrides: Partial<AgentProfileSearchDependencies> = {},
): AgentProfileSearchDependencies {
  const upstream = provider();
  return {
    authenticate: vi.fn(async () => "authenticated" as const),
    normalizeUrl: vi.fn(() => ({
      ok: true as const,
      url: "https://www.acme.com/pricing?ref=agent",
    })),
    resolveMarket: vi.fn(() => ({
      locationCode: 2840,
      locationName: "United States",
      languageCode: "en",
    })),
    credentials: vi.fn(() => ({ login: "login", password: "password" })),
    createProvider: vi.fn(() => upstream),
    extractClientIp: vi.fn(() => IP),
    acquireSlot: vi.fn(() => ({ acquired: true as const, release: vi.fn() })),
    readCache: vi.fn(async () => null),
    writeCache: vi.fn(async () => undefined),
    quota: {
      callQuota: vi.fn(async () => ({
        allowed: true,
        hits: 1,
        reset_at: "2026-08-14T00:00:00.000Z",
      })),
    },
    now: () => NOW,
    log: vi.fn(),
    ...overrides,
  };
}

describe("handleAgentProfileSearchRequest", () => {
  it("returns an exact strict cache hit before credentials, slot, quota, or provider", async () => {
    const credentials = vi.fn(() => ({ login: "login", password: "password" }));
    const extractClientIp = vi.fn(() => IP);
    const acquireSlot = vi.fn(() => ({ acquired: true as const, release: vi.fn() }));
    const callQuota = vi.fn();
    const createProvider = vi.fn();
    const writeCache = vi.fn();
    const data = cachedData();
    const deps = dependencies({
      credentials,
      extractClientIp,
      acquireSlot,
      quota: { callQuota: callQuota as never },
      createProvider: createProvider as never,
      readCache: vi.fn(async () => ({
        payload: data,
        capturedAt: "2026-08-13T10:00:00.000Z",
      })),
      writeCache,
    });

    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({ data });
    expect(credentials).not.toHaveBeenCalled();
    expect(extractClientIp).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(callQuota).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it.each([
    [
      "path",
      {
        url: "https://www.acme.com/docs",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "seo platform",
      },
      "seo",
    ],
    [
      "agent",
      {
        url: "https://www.acme.com/pricing?ref=agent",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "seo platform",
      },
      "tech",
    ],
    [
      "market",
      {
        url: "https://www.acme.com/pricing?ref=agent",
        marketCode: "GB",
        languageTag: "en-US",
        targetQuery: "seo platform",
      },
      "seo",
    ],
    [
      "language",
      {
        url: "https://www.acme.com/pricing?ref=agent",
        marketCode: "US",
        languageTag: "fr-FR",
        targetQuery: "seo platform",
      },
      "seo",
    ],
  ] as const)(
    "does not reuse a cache row for a different %s identity",
    async (_label, secondBody, secondAgent) => {
      const cache = new Map<string, unknown>();
      const upstream = provider();
      const readCache = vi.fn(async (namespace: string, host: string) => {
        const payload = cache.get(`${namespace}:${host}`);
        return payload === undefined
          ? null
          : {
              payload,
              capturedAt: "2026-08-13T10:00:00.000Z",
            };
      });
      const writeCache = vi.fn(
        async (namespace: string, host: string, payload: unknown) => {
          cache.set(`${namespace}:${host}`, payload);
        },
      );
      const normalizeUrl = vi.fn((value: unknown) => ({
        ok: true as const,
        url: String(value),
      }));
      const deps = dependencies({
        normalizeUrl,
        readCache,
        writeCache,
        createProvider: () => upstream,
      });

      await handleAgentProfileSearchRequest(request(), "seo", deps);
      vi.mocked(upstream.competitorsDomain).mockClear();
      vi.mocked(deps.quota.callQuota).mockClear();

      await handleAgentProfileSearchRequest(
        request(secondBody),
        secondAgent,
        deps,
      );

      expect(upstream.competitorsDomain).toHaveBeenCalledTimes(1);
      expect(deps.quota.callQuota).toHaveBeenCalledTimes(2);
      expect(readCache).toHaveBeenCalledTimes(2);
      expect(writeCache).toHaveBeenCalledTimes(2);
    },
  );

  it("reuses competitors_domain cache when only the ignored target query changes", async () => {
    const cache = new Map<string, unknown>();
    const upstream = provider();
    const readCache = vi.fn(async (namespace: string, host: string) => {
      const payload = cache.get(`${namespace}:${host}`);
      return payload === undefined
        ? null
        : {
            payload,
            capturedAt: "2026-08-13T10:00:00.000Z",
          };
    });
    const writeCache = vi.fn(
      async (namespace: string, host: string, payload: unknown) => {
        cache.set(`${namespace}:${host}`, payload);
      },
    );
    const deps = dependencies({
      readCache,
      writeCache,
      createProvider: () => upstream,
    });

    await handleAgentProfileSearchRequest(request(), "seo", deps);
    vi.mocked(upstream.competitorsDomain).mockClear();
    vi.mocked(deps.quota.callQuota).mockClear();

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "https://www.acme.com/pricing?ref=agent",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "technical seo",
      }),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect(upstream.competitorsDomain).not.toHaveBeenCalled();
    expect(deps.quota.callQuota).not.toHaveBeenCalled();
    expect(readCache).toHaveBeenCalledTimes(2);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });

  it("keeps the target query in target_query_serp cache identity", async () => {
    const cache = new Map<string, unknown>();
    const upstream = provider();
    const readCache = vi.fn(async (namespace: string, host: string) => {
      const payload = cache.get(`${namespace}:${host}`);
      return payload === undefined
        ? null
        : {
            payload,
            capturedAt: "2026-08-13T10:00:00.000Z",
          };
    });
    const writeCache = vi.fn(
      async (namespace: string, host: string, payload: unknown) => {
        cache.set(`${namespace}:${host}`, payload);
      },
    );
    const deps = dependencies({
      normalizeUrl: () => ({ ok: true, url: "https://www.acme.cn/" }),
      resolveMarket: () => null,
      readCache,
      writeCache,
      createProvider: () => upstream,
    });

    await handleAgentProfileSearchRequest(
      request({
        url: "acme.cn",
        marketCode: "CN",
        languageTag: "zh-CN",
        targetQuery: "免费星盘计算",
      }),
      "seo",
      deps,
    );
    vi.mocked(upstream.serpOrganic).mockClear();
    vi.mocked(deps.quota.callQuota).mockClear();

    await handleAgentProfileSearchRequest(
      request({
        url: "acme.cn",
        marketCode: "CN",
        languageTag: "zh-CN",
        targetQuery: "出生星盘",
      }),
      "seo",
      deps,
    );

    expect(upstream.serpOrganic).toHaveBeenCalledTimes(1);
    expect(deps.quota.callQuota).toHaveBeenCalledTimes(2);
    expect(readCache).toHaveBeenCalledTimes(2);
    expect(writeCache).toHaveBeenCalledTimes(2);
  });

  it.each(["2026-08-13T10:00:00Z", "not-a-timestamp"])(
    "rejects a cache row with non-canonical capturedAt %s",
    async (capturedAt) => {
      const upstream = provider();
      const deps = dependencies({
        readCache: async () => ({ payload: cachedData(), capturedAt }),
        createProvider: () => upstream,
      });

      const response = await handleAgentProfileSearchRequest(
        request(),
        "seo",
        deps,
      );

      expect(response.status).toBe(200);
      expect(upstream.competitorsDomain).toHaveBeenCalledTimes(1);
      expect(deps.quota.callQuota).toHaveBeenCalledTimes(2);
      expect((await response.json()).data.rows[0].domain).toBe("rival.com");
    },
  );

  it.each([
    ["schema", { schemaVersion: "agent_profile_search.v0" }],
    ["agent", { agent: "tech" }],
    ["target host", { targetHost: "other.com" }],
    [
      "method",
      {
        method: "target_query_serp",
        rows: [
          { kind: "target_query_serp", domain: "cached-rival.com", rank: 1 },
        ],
      },
    ],
    [
      "market",
      {
        market: { code: "GB", locationCode: 2826, languageCode: "en" },
      },
    ],
    ["timestamp", { observedAt: "2026-08-13T10:00:00Z" }],
    [
      "availability",
      { availability: "source_unavailable", observedAt: null, rows: [] },
    ],
  ] as const)(
    "rejects a cached payload with a wrong %s",
    async (_label, cachedOverride) => {
      const upstream = provider();
      const deps = dependencies({
        readCache: async () => ({
          payload: cachedData(cachedOverride as never),
          capturedAt: "2026-08-13T10:00:00.000Z",
        }),
        createProvider: () => upstream,
      });

      const response = await handleAgentProfileSearchRequest(
        request(),
        "seo",
        deps,
      );

      expect(response.status).toBe(200);
      expect(upstream.competitorsDomain).toHaveBeenCalledTimes(1);
      expect(deps.quota.callQuota).toHaveBeenCalledTimes(2);
      expect((await response.json()).data.rows[0].domain).toBe("rival.com");
    },
  );

  it.each([
    ["available", provider()],
    [
      "no_data",
      {
        competitorsDomain: vi.fn(async () => ({
          rows: [],
          totalCount: 0,
          itemsCount: 0,
          costUsd: 0,
          providerStatusCode: 20_000,
          taskStatusCode: 40_102,
        })),
        serpOrganic: vi.fn(),
      } satisfies AgentProfileSearchProvider,
    ],
  ] as const)("writes a successful %s provider result", async (_label, upstream) => {
    const writeCache = vi.fn(async () => undefined);
    const deps = dependencies({
      createProvider: () => upstream,
      writeCache,
    });

    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );
    const data = (await response.json()).data;

    expect(data.availability).toBe(_label);
    expect(writeCache).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledWith(
      expect.stringMatching(/^agent_profile_search_v1_seo_[a-f0-9]{64}$/),
      "acme.com",
      data,
    );
  });

  it("fails soft when the cache read rejects", async () => {
    const upstream = provider();
    const deps = dependencies({
      readCache: vi.fn(async () => {
        throw new Error("cache read unavailable");
      }),
      createProvider: () => upstream,
    });

    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.availability).toBe("available");
    expect(upstream.competitorsDomain).toHaveBeenCalledTimes(1);
  });

  it("fails soft when the cache write rejects", async () => {
    const upstream = provider();
    const deps = dependencies({
      writeCache: vi.fn(async () => {
        throw new Error("cache write unavailable");
      }),
      createProvider: () => upstream,
    });

    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.availability).toBe("available");
  });

  it("authenticates before reading the body or touching quota/provider", async () => {
    const incoming = request();
    const createProvider = vi.fn();
    const callQuota = vi.fn();
    const response = await handleAgentProfileSearchRequest(incoming, "seo", {
      ...dependencies(),
      authenticate: async () => "unauthenticated",
      createProvider: createProvider as never,
      quota: { callQuota: callQuota as never },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(incoming.bodyUsed).toBe(false);
    expect(callQuota).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("keeps auth outages distinct from a signed-out visitor", async () => {
    const incoming = request();
    const response = await handleAgentProfileSearchRequest(
      incoming,
      "tech",
      dependencies({
        authenticate: async () => {
          throw new Error("auth service down");
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
    expect(incoming.bodyUsed).toBe(false);
  });

  it.each([
    [
      "extra key",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "seo",
        extra: true,
      },
    ],
    [
      "missing key",
      { url: "acme.com", marketCode: "US", languageTag: "en" },
    ],
    [
      "invalid market",
      {
        url: "acme.com",
        marketCode: "USA",
        languageTag: "en",
        targetQuery: "seo",
      },
    ],
    [
      "invalid language",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "not_a_locale",
        targetQuery: "seo",
      },
    ],
    [
      "overlong query",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "x".repeat(201),
      },
    ],
  ] as const)("rejects an exact-body violation: %s", async (_label, body) => {
    const deps = dependencies();
    const response = await handleAgentProfileSearchRequest(
      request(body),
      "seo",
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(deps.quota.callQuota).not.toHaveBeenCalled();
    expect(deps.createProvider).not.toHaveBeenCalled();
  });

  it("enforces the 4096-byte request ceiling after auth", async () => {
    const deps = dependencies();
    const response = await handleAgentProfileSearchRequest(
      request(undefined, { "content-length": "4097" }),
      "seo",
      deps,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
    expect(deps.quota.callQuota).not.toHaveBeenCalled();
  });

  it("rejects a normalized URL whose host is not a public DNS hostname", async () => {
    const deps = dependencies({
      normalizeUrl: () => ({ ok: true, url: "https://bad_host.com/" }),
    });
    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_url" },
    });
    expect(deps.quota.callQuota).not.toHaveBeenCalled();
    expect(deps.createProvider).not.toHaveBeenCalled();
  });

  it("derives the host and projects Labs rows as organic search overlap", async () => {
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockResolvedValue({
      rows: [
        {
          domain: "www.rival.com",
          averagePosition: 4.5,
          summedPosition: 54,
          intersections: 12,
          organicEstimatedTrafficVolume: 321,
        },
        {
          domain: "rival.com",
          averagePosition: 8,
          summedPosition: 80,
          intersections: 10,
          organicEstimatedTrafficVolume: 100,
        },
        ...Array.from({ length: 12 }, (_, index) => ({
          domain: `rival-${index}.com`,
          averagePosition: index + 1,
          summedPosition: index + 1,
          intersections: index + 1,
          organicEstimatedTrafficVolume: index,
        })),
      ],
      totalCount: 14,
      itemsCount: 14,
      costUsd: 0.031,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
    const log = vi.fn();
    const deps = dependencies({ createProvider: () => upstream, log });

    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(upstream.competitorsDomain).toHaveBeenCalledWith(
      {
        target: "acme.com",
        locationCode: 2840,
        languageCode: "en",
        limit: 10,
      },
      expect.any(AbortSignal),
    );
    expect(body.data).toMatchObject({
      schemaVersion: "agent_profile_search.v1",
      agent: "seo",
      targetHost: "acme.com",
      availability: "available",
      method: "competitors_domain",
      market: { code: "US", locationCode: 2840, languageCode: "en" },
      observedAt: "2026-08-13T10:00:00.000Z",
    });
    expect(body.data.rows).toHaveLength(10);
    expect(body.data.rows[0]).toEqual({
      kind: "organic_search_overlap",
      domain: "rival.com",
      intersections: 12,
      averagePosition: 4.5,
      summedPosition: 54,
      organicEstimatedTrafficVolume: 321,
    });
    expect(new Set(body.data.rows.map((row: { domain: string }) => row.domain)).size).toBe(10);
    expect(log).toHaveBeenCalledWith({
      agent: "seo",
      method: "competitors_domain",
      status: "available",
      costUsd: 0.031,
    });
  });

  it("uses the explicit request language only through the served-market resolver", async () => {
    const resolveMarket = vi.fn(() => ({
      locationCode: 2840,
      locationName: "United States",
      languageCode: "es",
    }));
    const upstream = provider();
    const deps = dependencies({ resolveMarket, createProvider: () => upstream });

    await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "us",
        languageTag: "es-MX",
        targetQuery: "plataforma seo",
      }),
      "tech",
      deps,
    );

    expect(resolveMarket).toHaveBeenCalledWith("US", "es-MX");
    expect(upstream.competitorsDomain).toHaveBeenCalledWith(
      expect.objectContaining({ locationCode: 2840, languageCode: "es" }),
      expect.any(AbortSignal),
    );
  });

  it("falls back only for CN with a non-empty target query and keeps ranks factual", async () => {
    const upstream = provider();
    vi.mocked(upstream.serpOrganic).mockResolvedValue({
      keyword: "免费星盘计算",
      rows: [
        { rankGroup: 1, domain: "www.acme.cn" },
        { rankGroup: 2, domain: "rival.cn" },
        { rankGroup: 3, domain: "www.rival.cn" },
        { rankGroup: 4, domain: "second.cn" },
      ],
      itemTypes: ["organic"],
      unresolvedItemCount: 0,
      costUsd: 0.002,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
    const deps = dependencies({
      normalizeUrl: () => ({ ok: true, url: "https://www.acme.cn/" }),
      resolveMarket: () => null,
      createProvider: () => upstream,
    });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "acme.cn",
        marketCode: "CN",
        languageTag: "zh-CN",
        targetQuery: " 免费星盘计算 ",
      }),
      "tech",
      deps,
    );
    const body = await response.json();

    expect(upstream.serpOrganic).toHaveBeenCalledWith(
      {
        keyword: "免费星盘计算",
        locationCode: 2156,
        languageCode: "zh",
        depth: 10,
      },
      expect.any(AbortSignal),
    );
    expect(body.data).toEqual({
      schemaVersion: "agent_profile_search.v1",
      agent: "tech",
      targetHost: "acme.cn",
      availability: "available",
      method: "target_query_serp",
      market: { code: "CN", locationCode: 2156, languageCode: "zh" },
      observedAt: "2026-08-13T10:00:00.000Z",
      rows: [
        { kind: "target_query_serp", domain: "rival.cn", rank: 2 },
        { kind: "target_query_serp", domain: "second.cn", rank: 4 },
      ],
    });
  });

  it.each([
    ["AQ", "seo platform"],
    ["CN", "   "],
  ] as const)(
    "returns market_unsupported without quota or provider for %s",
    async (marketCode, targetQuery) => {
      const deps = dependencies({ resolveMarket: () => null });
      const response = await handleAgentProfileSearchRequest(
        request({
          url: "acme.com",
          marketCode,
          languageTag: "en",
          targetQuery,
        }),
        "seo",
        deps,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          schemaVersion: "agent_profile_search.v1",
          agent: "seo",
          targetHost: "acme.com",
          availability: "market_unsupported",
          method: null,
          market: { code: marketCode, locationCode: null, languageCode: null },
          observedAt: null,
          rows: [],
        },
      });
      expect(deps.quota.callQuota).not.toHaveBeenCalled();
      expect(deps.createProvider).not.toHaveBeenCalled();
      expect(deps.readCache).not.toHaveBeenCalled();
      expect(deps.writeCache).not.toHaveBeenCalled();
    },
  );

  it("returns source_unavailable when credentials are absent without spending quota", async () => {
    const deps = dependencies({ credentials: () => null });
    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        availability: "source_unavailable",
        method: "competitors_domain",
        observedAt: null,
        rows: [],
      },
    });
    expect(deps.writeCache).not.toHaveBeenCalled();
    expect(deps.quota.callQuota).not.toHaveBeenCalled();
    expect(deps.createProvider).not.toHaveBeenCalled();
  });

  it("applies per-IP then global durable daily quotas before a paid call", async () => {
    const events: string[] = [];
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockImplementation(async () => {
      events.push("provider");
      return {
        rows: [],
        totalCount: 0,
        itemsCount: 0,
        costUsd: 0,
        providerStatusCode: 20_000,
        taskStatusCode: 40_102,
      };
    });
    const callQuota = vi.fn(async (bucket: string) => {
      events.push(bucket);
      return {
        allowed: true,
        hits: 1,
        reset_at: "2026-08-14T00:00:00.000Z",
      };
    });
    const deps = dependencies({
      createProvider: () => upstream,
      quota: { callQuota },
    });

    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.availability).toBe("no_data");
    expect(callQuota).toHaveBeenNthCalledWith(
      1,
      agentProfileSearchIpBucket(IP, NOW),
      AGENT_PROFILE_SEARCH_DAILY_IP_MAX,
      AGENT_PROFILE_SEARCH_DAILY_WINDOW_SECONDS,
    );
    expect(callQuota).toHaveBeenNthCalledWith(
      2,
      agentProfileSearchGlobalBucket(NOW),
      AGENT_PROFILE_SEARCH_DAILY_GLOBAL_MAX,
      AGENT_PROFILE_SEARCH_DAILY_WINDOW_SECONDS,
    );
    expect(events).toEqual([
      agentProfileSearchIpBucket(IP, NOW),
      agentProfileSearchGlobalBucket(NOW),
      "provider",
    ]);
  });

  it("refuses concurrent runs before durable quota", async () => {
    const deps = dependencies({ acquireSlot: () => ({ acquired: false }) });
    const response = await handleAgentProfileSearchRequest(
      request(),
      "tech",
      deps,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "search_in_progress" },
    });
    expect(deps.quota.callQuota).not.toHaveBeenCalled();
    expect(deps.createProvider).not.toHaveBeenCalled();
  });

  it.each([
    ["limited", { allowed: false, hits: 6, reset_at: "2026-08-13T11:00:00.000Z" }, 429, "rate_limited"],
    ["unavailable", new Error("quota store detail"), 503, "quota_unavailable"],
  ] as const)(
    "fails closed when quota is %s and releases the slot",
    async (_label, quotaResult, status, code) => {
      const release = vi.fn();
      const deps = dependencies({
        acquireSlot: () => ({ acquired: true, release }),
        quota: {
          callQuota: async () => {
            if (quotaResult instanceof Error) throw quotaResult;
            return quotaResult;
          },
        },
      });
      const response = await handleAgentProfileSearchRequest(
        request(),
        "seo",
        deps,
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(release).toHaveBeenCalledTimes(1);
      expect(deps.createProvider).not.toHaveBeenCalled();
      expect(deps.writeCache).not.toHaveBeenCalled();
    },
  );

  it("turns a provider rejection into typed source_unavailable without leaking details", async () => {
    const release = vi.fn();
    const log = vi.fn();
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockRejectedValue(
      new Error("secret upstream diagnostic"),
    );
    const deps = dependencies({
      acquireSlot: () => ({ acquired: true, release }),
      createProvider: () => upstream,
      log,
    });

    const response = await handleAgentProfileSearchRequest(
      request(),
      "seo",
      deps,
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("secret");
    expect(JSON.parse(text).data).toMatchObject({
      availability: "source_unavailable",
      method: "competitors_domain",
      observedAt: null,
      rows: [],
    });
    expect(log).toHaveBeenCalledWith({
      agent: "seo",
      method: "competitors_domain",
      status: "source_unavailable",
      costUsd: null,
    });
    expect(deps.writeCache).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
