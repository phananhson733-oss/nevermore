// @input  -- authenticated profile-search requests plus injected provider/cache/concurrency seams
// @output -- auth order, strict input, cost gates, market routing, and safe projections
// @pos    -- focused TDD suite for the marketing-only DataForSEO boundary

import { describe, expect, it, vi } from "vitest";
import {
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
    productProfileSearchSeeds: [],
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
    serpCompetitors: vi.fn(async () => ({
      rows: [
        {
          domain: "seed-rival.com",
          averagePosition: 4.5,
          medianPosition: 3,
          rating: 812.25,
          organicEstimatedTrafficVolume: 321,
          keywordsCount: 4,
          visibility: 0.42,
          relevantSerpItems: 3,
        },
      ],
      totalCount: 1,
      itemsCount: 1,
      costUsd: 0.03,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    })),
    serpOrganic: vi.fn(async () => ({
      keyword: "seo platform",
      rows: [
        {
          rankGroup: 1,
          domain: "rival.com",
          sitelinkCount: 0,
          title: null,
          url: null,
        },
      ],
      itemTypes: [],
      aiOverview: null,
      communityItems: [],
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

function cachedSeedSerpData(
  overrides: Partial<AgentProfileSearchData> = {},
): AgentProfileSearchData {
  return {
    schemaVersion: "agent_profile_search.v1",
    agent: "seo",
    targetHost: "acme.com",
    availability: "available",
    method: "serp_competitors",
    market: { code: "US", locationCode: 2840, languageCode: "en" },
    observedAt: "2026-08-13T10:00:00.000Z",
    rows: [
      {
        kind: "profile_seed_serp_competitor",
        domain: "cached-seed-rival.com",
        averagePosition: 4.5,
        medianPosition: 3,
        rating: 812.25,
        organicEstimatedTrafficVolume: 321,
        keywordsCount: 4,
        visibility: 0.42,
        relevantSerpItems: 3,
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
    now: () => NOW,
    log: vi.fn(),
    ...overrides,
  };
}

describe("handleAgentProfileSearchRequest", () => {
  it("returns an exact strict cache hit before credentials, slot, or provider", async () => {
    const credentials = vi.fn(() => ({ login: "login", password: "password" }));
    const extractClientIp = vi.fn(() => IP);
    const acquireSlot = vi.fn(() => ({ acquired: true as const, release: vi.fn() }));
    const createProvider = vi.fn();
    const writeCache = vi.fn();
    const data = cachedData();
    const deps = dependencies({
      credentials,
      extractClientIp,
      acquireSlot,
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
        productProfileSearchSeeds: [],
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
        productProfileSearchSeeds: [],
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
        productProfileSearchSeeds: [],
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
        productProfileSearchSeeds: [],
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

      await handleAgentProfileSearchRequest(
        request(secondBody),
        secondAgent,
        deps,
      );

      expect(upstream.competitorsDomain).toHaveBeenCalledTimes(1);
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

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "https://www.acme.com/pricing?ref=agent",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "technical seo",
        productProfileSearchSeeds: [],
      }),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect(upstream.competitorsDomain).not.toHaveBeenCalled();
    expect(readCache).toHaveBeenCalledTimes(2);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });

  it("keys fallback cache by canonical Product Profile seeds", async () => {
    const cache = new Map<string, unknown>();
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockResolvedValue({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0.02,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
    });
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

    await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: ["  SEO   Platform  ", "SEO Platform"],
      }),
      "seo",
      deps,
    );
    vi.mocked(upstream.competitorsDomain).mockClear();
    vi.mocked(upstream.serpCompetitors).mockClear();

    const cachedResponse = await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "ignored",
        productProfileSearchSeeds: ["SEO Platform"],
      }),
      "seo",
      deps,
    );

    expect((await cachedResponse.json()).data.method).toBe("serp_competitors");
    expect(upstream.competitorsDomain).not.toHaveBeenCalled();
    expect(upstream.serpCompetitors).not.toHaveBeenCalled();

    await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: ["different seed"],
      }),
      "seo",
      deps,
    );

    expect(upstream.competitorsDomain).toHaveBeenCalledTimes(1);
    expect(upstream.serpCompetitors).toHaveBeenCalledTimes(1);
  });

  it("does not let a cached empty overlap suppress the seed fallback", async () => {
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockResolvedValue({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0.02,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
    });
    const deps = dependencies({
      readCache: async () => ({
        payload: cachedData({ availability: "no_data", rows: [] }),
        capturedAt: "2026-08-13T10:00:00.000Z",
      }),
      createProvider: () => upstream,
    });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: ["SEO platform"],
      }),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.method).toBe("serp_competitors");
    expect(upstream.competitorsDomain).toHaveBeenCalledTimes(1);
    expect(upstream.serpCompetitors).toHaveBeenCalledTimes(1);
  });

  it("accepts a strict seed-SERP cache hit before paid gates", async () => {
    const upstream = provider();
    const deps = dependencies({
      readCache: async () => ({
        payload: cachedSeedSerpData(),
        capturedAt: "2026-08-13T10:00:00.000Z",
      }),
      createProvider: () => upstream,
    });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: ["SEO platform"],
      }),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(cachedSeedSerpData());
    expect(deps.credentials).not.toHaveBeenCalled();
    expect(upstream.competitorsDomain).not.toHaveBeenCalled();
    expect(upstream.serpCompetitors).not.toHaveBeenCalled();
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
        productProfileSearchSeeds: [],
      }),
      "seo",
      deps,
    );
    vi.mocked(upstream.serpOrganic).mockClear();

    await handleAgentProfileSearchRequest(
      request({
        url: "acme.cn",
        marketCode: "CN",
        languageTag: "zh-CN",
        targetQuery: "出生星盘",
        productProfileSearchSeeds: [],
      }),
      "seo",
      deps,
    );

    expect(upstream.serpOrganic).toHaveBeenCalledTimes(1);
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
        serpCompetitors: vi.fn(),
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
      expect.stringMatching(/^agent_profile_search_v3_seo_[a-f0-9]{64}$/),
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

  it("authenticates before reading the body or touching the provider", async () => {
    const incoming = request();
    const createProvider = vi.fn();
    const response = await handleAgentProfileSearchRequest(incoming, "seo", {
      ...dependencies(),
      authenticate: async () => "unauthenticated",
      createProvider: createProvider as never,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(incoming.bodyUsed).toBe(false);
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
        productProfileSearchSeeds: [],
        extra: true,
      },
    ],
    [
      "missing key",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "seo",
      },
    ],
    [
      "invalid market",
      {
        url: "acme.com",
        marketCode: "USA",
        languageTag: "en",
        targetQuery: "seo",
        productProfileSearchSeeds: [],
      },
    ],
    [
      "invalid language",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "not_a_locale",
        targetQuery: "seo",
        productProfileSearchSeeds: [],
      },
    ],
    [
      "overlong query",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "x".repeat(201),
        productProfileSearchSeeds: [],
      },
    ],
    [
      "non-array Product Profile seeds",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "seo",
        productProfileSearchSeeds: "seo platform",
      },
    ],
    [
      "empty Product Profile seed",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "seo",
        productProfileSearchSeeds: ["   "],
      },
    ],
    [
      "overlong Product Profile seed",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "seo",
        productProfileSearchSeeds: ["x".repeat(201)],
      },
    ],
    [
      "more than five canonical Product Profile seeds",
      {
        url: "acme.com",
        marketCode: "US",
        languageTag: "en",
        targetQuery: "seo",
        productProfileSearchSeeds: ["one", "two", "three", "four", "five", "six"],
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
        maximumRankGroup: 100,
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

  it("uses canonical Product Profile seeds only after projected top-100 overlap is empty", async () => {
    const events: string[] = [];
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockImplementation(async () => {
      events.push("competitors_domain");
      return {
        rows: [
          {
            domain: "www.acme.com",
            averagePosition: 1,
            summedPosition: 1,
            intersections: 1,
            organicEstimatedTrafficVolume: 1,
          },
        ],
        totalCount: 1,
        itemsCount: 1,
        costUsd: 0.02,
        providerStatusCode: 20_000,
        taskStatusCode: 20_000,
      };
    });
    vi.mocked(upstream.serpCompetitors).mockImplementation(async () => {
      events.push("serp_competitors");
      return {
        rows: [
          {
            domain: "www.acme.com",
            averagePosition: 1,
            medianPosition: 1,
            rating: 999,
            organicEstimatedTrafficVolume: 999,
            keywordsCount: 5,
            visibility: 1,
            relevantSerpItems: 5,
          },
          {
            domain: "www.rival.com",
            averagePosition: 5,
            medianPosition: 4,
            rating: 4,
            organicEstimatedTrafficVolume: 100,
            keywordsCount: 8,
            visibility: 0.3,
            relevantSerpItems: 2,
          },
          {
            domain: "rival.com",
            averagePosition: 4,
            medianPosition: 3,
            rating: 5,
            organicEstimatedTrafficVolume: 200,
            keywordsCount: 2,
            visibility: 0.4,
            relevantSerpItems: 3,
          },
          {
            domain: "second.com",
            averagePosition: 2,
            medianPosition: 2,
            rating: 5,
            organicEstimatedTrafficVolume: 300,
            keywordsCount: 7,
            visibility: 0.5,
            relevantSerpItems: 4,
          },
        ],
        totalCount: 4,
        itemsCount: 4,
        costUsd: 0.03,
        providerStatusCode: 20_000,
        taskStatusCode: 20_000,
      };
    });
    const log = vi.fn();
    const deps = dependencies({
      createProvider: () => upstream,
      log,
    });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "ignored outside CN",
        productProfileSearchSeeds: [
          "  SEO   Platform  ",
          "SEO Platform",
          "ＡＩ search",
        ],
      }),
      "seo",
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(events).toEqual(["competitors_domain", "serp_competitors"]);
    expect(upstream.competitorsDomain).toHaveBeenCalledWith(
      {
        target: "acme.com",
        locationCode: 2840,
        languageCode: "en",
        limit: 10,
        maximumRankGroup: 100,
      },
      expect.any(AbortSignal),
    );
    expect(upstream.serpCompetitors).toHaveBeenCalledWith(
      {
        keywords: ["SEO Platform", "AI search"],
        locationCode: 2840,
        languageCode: "en",
        limit: 10,
      },
      expect.any(AbortSignal),
    );
    expect(body.data).toMatchObject({
      schemaVersion: "agent_profile_search.v1",
      availability: "available",
      method: "serp_competitors",
      observedAt: "2026-08-13T10:00:00.000Z",
    });
    expect(body.data.rows).toEqual([
      {
        kind: "profile_seed_serp_competitor",
        domain: "second.com",
        averagePosition: 2,
        medianPosition: 2,
        rating: 5,
        organicEstimatedTrafficVolume: 300,
        keywordsCount: 7,
        visibility: 0.5,
        relevantSerpItems: 4,
      },
      {
        kind: "profile_seed_serp_competitor",
        domain: "rival.com",
        averagePosition: 4,
        medianPosition: 3,
        rating: 5,
        organicEstimatedTrafficVolume: 200,
        keywordsCount: 2,
        visibility: 0.4,
        relevantSerpItems: 3,
      },
    ]);
    expect(body.data.rows[0]).not.toHaveProperty("intersections");
    expect(log).toHaveBeenCalledWith({
      agent: "seo",
      method: "serp_competitors",
      status: "available",
      costUsd: 0.05,
    });
  });

  it("does not call SERP Competitors when projected overlap is available", async () => {
    const upstream = provider();
    const deps = dependencies({ createProvider: () => upstream });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: ["SEO platform"],
      }),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.method).toBe("competitors_domain");
    expect(upstream.serpCompetitors).not.toHaveBeenCalled();
  });

  it("returns seed-SERP no_data when the bounded fallback is empty", async () => {
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockResolvedValue({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0.02,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
    });
    vi.mocked(upstream.serpCompetitors).mockResolvedValue({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
    });
    const deps = dependencies({ createProvider: () => upstream });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: ["SEO platform"],
      }),
      "seo",
      deps,
    );

    await expect(response.json()).resolves.toMatchObject({
      data: {
        availability: "no_data",
        method: "serp_competitors",
        rows: [],
      },
    });
  });

  it("uses the app-aligned top-100 overlap policy and a fresh cache identity for gengrowth.ai", async () => {
    const upstream = provider();
    const deps = dependencies({
      normalizeUrl: () => ({ ok: true, url: "https://gengrowth.ai/" }),
      createProvider: () => upstream,
    });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "gengrowth.ai",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: [],
      }),
      "seo",
      deps,
    );

    expect(response.status).toBe(200);
    expect(upstream.competitorsDomain).toHaveBeenCalledWith(
      {
        target: "gengrowth.ai",
        locationCode: 2840,
        languageCode: "en",
        limit: 10,
        maximumRankGroup: 100,
      },
      expect.any(AbortSignal),
    );
    expect(deps.readCache).toHaveBeenCalledWith(
      expect.stringMatching(/^agent_profile_search_v3_seo_[a-f0-9]{64}$/),
      "gengrowth.ai",
    );
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
        productProfileSearchSeeds: [],
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
        {
          rankGroup: 1,
          domain: "www.acme.cn",
          sitelinkCount: 0,
          title: null,
          url: null,
        },
        {
          rankGroup: 2,
          domain: "rival.cn",
          sitelinkCount: 0,
          title: null,
          url: null,
        },
        {
          rankGroup: 3,
          domain: "www.rival.cn",
          sitelinkCount: 0,
          title: null,
          url: null,
        },
        {
          rankGroup: 4,
          domain: "second.cn",
          sitelinkCount: 0,
          title: null,
          url: null,
        },
      ],
      itemTypes: ["organic"],
      aiOverview: null,
      communityItems: [],
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
        productProfileSearchSeeds: ["birth chart calculator"],
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
    expect(upstream.serpCompetitors).not.toHaveBeenCalled();
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
    "returns market_unsupported without provider access for %s",
    async (marketCode, targetQuery) => {
      const deps = dependencies({ resolveMarket: () => null });
      const response = await handleAgentProfileSearchRequest(
        request({
          url: "acme.com",
          marketCode,
          languageTag: "en",
          targetQuery,
          productProfileSearchSeeds: [],
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
      expect(deps.createProvider).not.toHaveBeenCalled();
      expect(deps.readCache).not.toHaveBeenCalled();
      expect(deps.writeCache).not.toHaveBeenCalled();
    },
  );

  it("returns source_unavailable when credentials are absent without calling the provider", async () => {
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
    expect(deps.createProvider).not.toHaveBeenCalled();
  });

  it("serves repeated normal-use searches without a daily request allowance", async () => {
    const upstream = provider();
    const deps = dependencies({
      createProvider: () => upstream,
    });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await handleAgentProfileSearchRequest(
        request(),
        "seo",
        deps,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data.availability).toBe("available");
    }

    expect(upstream.competitorsDomain).toHaveBeenCalledTimes(6);
  });

  it("refuses concurrent runs before the provider", async () => {
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
    expect(deps.createProvider).not.toHaveBeenCalled();
  });

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

  it("attributes a fallback rejection to SERP Competitors and releases the shared slot", async () => {
    const release = vi.fn();
    const log = vi.fn();
    const upstream = provider();
    vi.mocked(upstream.competitorsDomain).mockResolvedValue({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0.02,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
    });
    vi.mocked(upstream.serpCompetitors).mockRejectedValue(
      new Error("secret fallback diagnostic"),
    );
    const deps = dependencies({
      acquireSlot: () => ({ acquired: true, release }),
      createProvider: () => upstream,
      log,
    });

    const response = await handleAgentProfileSearchRequest(
      request({
        url: "acme.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "",
        productProfileSearchSeeds: ["SEO platform"],
      }),
      "seo",
      deps,
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("secret");
    expect(JSON.parse(text).data).toMatchObject({
      availability: "source_unavailable",
      method: "serp_competitors",
      observedAt: null,
      rows: [],
    });
    expect(log).toHaveBeenCalledWith({
      agent: "seo",
      method: "serp_competitors",
      status: "source_unavailable",
      costUsd: null,
    });
    expect(deps.writeCache).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
