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
    expect(release).toHaveBeenCalledTimes(1);
  });
});
