// @input  -- authenticated profile-diagnosis requests plus injected crawl/cache seams
// @output -- auth-first admission and strict, evidence-bounded refresh assertions
// @pos    -- focused tests for the shared SEO and Tech profile-refresh handler

import { describe, expect, it, vi } from "vitest";
import { ContextProfileError } from "@sf/sources";
import { KeywordLlmError } from "../tools/keyword-llm-client.ts";
import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  AGENT_PROFILE_REFRESH_READY_FIELD_PATHS,
  type AgentProfileRefreshData,
  type AgentProfileRefreshField,
  type AgentProfileRefreshFieldPath,
} from "./profile-refresh-contract.ts";
import {
  handleAgentProfileRefreshRequest,
  profileRefreshCacheNamespace,
  type AgentProfileRefreshHandlerDependencies,
} from "./profile-refresh-handler.ts";

function request(body: unknown = {
  url: "https://acme.test/pricing",
  marketCode: "US",
  languageTag: "en-US",
  outputLocale: "en",
  mode: "prefer_cache",
}): Request {
  return new Request(
    "https://gengrowth.ai/api/agents/seo/profile-refresh",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.9",
      },
      body: JSON.stringify(body),
    },
  );
}

function dependencies(
  overrides: Partial<AgentProfileRefreshHandlerDependencies> = {},
): AgentProfileRefreshHandlerDependencies {
  return {
    authenticate: vi.fn(async () => "authenticated" as const),
    isSameOriginPost: vi.fn(() => true),
    normalizeUrl: vi.fn(() => ({
      ok: true as const,
      url: "https://acme.test/pricing",
    })),
    extractClientIp: vi.fn(() => "203.0.113.9"),
    openGate: vi.fn(async () => ({
      ok: true as const,
      kind: "crawl" as const,
      release: vi.fn(),
    })),
    readCache: vi.fn(async () => null),
    writeCache: vi.fn(async () => undefined),
    crawl: vi.fn(async () => {
      throw new Error("crawl must not run in this test");
    }),
    synthesize: vi.fn(async () => {
      throw new Error("synthesis must not run in this test");
    }),
    ...overrides,
  };
}

function contextResult() {
  return {
    origin: "https://www.acme.test",
    pages: [
      {
        url: "https://www.acme.test/",
        path: "/",
        score: 100,
        title: "Acme",
        metaDescription: "Acme helps teams ship.",
        headings: {
          h1: ["Ship better"],
          h2: ["For product teams"],
          h3: ["Trusted by builders"],
        },
        text: "Acme helps product teams ship better software.",
        textTruncated: false,
      },
      {
        url: "https://www.acme.test/pricing",
        path: "/pricing",
        score: 90,
        title: "Acme pricing",
        metaDescription: "Plans for every team.",
        headings: { h1: ["Pricing"], h2: [], h3: [] },
        text: "Start free, then upgrade as your team grows.",
        textTruncated: false,
      },
      {
        url: "https://www.acme.test/features",
        path: "/features",
        score: 80,
        title: "Features",
        metaDescription: null,
        headings: { h1: ["Features"], h2: ["Automation"], h3: [] },
        text: "Automate product delivery workflows.",
        textTruncated: false,
      },
    ],
    pagesFetched: 3,
    productPagesFetched: 2,
    stopReason: "max_urls" as const,
    contextSufficient: true,
    requestsSent: 7,
    bytesFetched: 12_345,
    botProtectionResponses: 0,
    rateLimitedResponses: 0,
    protocolDowngradesRejected: 0,
    capturedAt: "2026-08-13T01:00:00.000Z",
  };
}

const LIST_PATHS = new Set<AgentProfileRefreshFieldPath>([
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

function synthesisFields(availableCount = 1): readonly AgentProfileRefreshField[] {
  return AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path, index) =>
    index < availableCount
      ? ({
          path,
          state: "available",
          value: LIST_PATHS.has(path) ? [`${path} fact`] : `${path} fact`,
          derivation: "inferred",
          confidence: "medium",
          source: "public_page",
          limitation: null,
          evidenceUrls: [contextResult().pages[0].url],
        } as AgentProfileRefreshField)
      : {
          path,
          state: "unavailable",
          value: null,
          derivation: "missing",
          confidence: "unknown",
          source: "not_available",
          limitation: "The bounded public pages do not establish this field.",
          evidenceUrls: [],
        },
  );
}

function synthesisFieldsForPaths(
  availablePaths: ReadonlySet<AgentProfileRefreshFieldPath>,
): readonly AgentProfileRefreshField[] {
  return AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) =>
    availablePaths.has(path)
      ? ({
          path,
          state: "available",
          value: LIST_PATHS.has(path) ? [`${path} fact`] : `${path} fact`,
          derivation: "inferred",
          confidence: "medium",
          source: "public_page",
          limitation: null,
          evidenceUrls: [contextResult().pages[0].url],
        } as AgentProfileRefreshField)
      : {
          path,
          state: "unavailable",
          value: null,
          derivation: "missing",
          confidence: "unknown",
          source: "not_available",
          limitation: "The bounded public pages do not establish this field.",
          evidenceUrls: [],
        },
  );
}

function profileData(
  agent: "seo" | "tech" = "seo",
  cacheStatus: "hit" | "fresh" | "refreshed" = "fresh",
): AgentProfileRefreshData {
  const context = contextResult();
  const fields = synthesisFields();
  return {
    schemaVersion: "agent_profile_refresh.v1",
    agent,
    request: {
      submittedUrl: "https://acme.test/pricing",
      normalizedUrl: "https://acme.test/pricing",
      targetHost: "acme.test",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    },
    availability: "partial",
    observedAt: context.capturedAt,
    cache: { status: cacheStatus, capturedAt: context.capturedAt },
    diagnostics: {
      resolvedOrigin: context.origin,
      pagesFetched: context.pagesFetched,
      productPagesFetched: context.productPagesFetched,
      stopReason: context.stopReason,
      contextSufficient: context.contextSufficient,
      sourceUrls: context.pages.map((page) => page.url),
      fieldsAvailable: 1,
      fieldsMissing: 21,
    },
    fields,
  };
}

describe("handleAgentProfileRefreshRequest", () => {
  it("returns auth_required before reading the body or touching crawl admission", async () => {
    const incoming = request();
    const openGate = vi.fn<AgentProfileRefreshHandlerDependencies["openGate"]>();

    const response = await handleAgentProfileRefreshRequest(
      incoming,
      "seo",
      dependencies({
        authenticate: vi.fn(async () => "unauthenticated" as const),
        openGate,
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(incoming.bodyUsed).toBe(false);
    expect(openGate).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("keeps an authentication outage distinct from a signed-out visitor", async () => {
    const incoming = request();
    const response = await handleAgentProfileRefreshRequest(
      incoming,
      "tech",
      dependencies({
        authenticate: vi.fn(async () => {
          throw new Error("auth store unavailable");
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
    expect(incoming.bodyUsed).toBe(false);
  });

  it("rejects a present cross-origin header after auth and before reading the body", async () => {
    const order: string[] = [];
    const incoming = new Request(
      "https://gengrowth.ai/api/agents/seo/profile-refresh",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({
          url: "https://acme.test",
          marketCode: "US",
          languageTag: "en",
          outputLocale: "en",
          mode: "prefer_cache",
        }),
      },
    );
    const response = await handleAgentProfileRefreshRequest(
      incoming,
      "seo",
      dependencies({
        authenticate: vi.fn(async () => {
          order.push("auth");
          return "authenticated" as const;
        }),
        isSameOriginPost: vi.fn(() => {
          order.push("origin");
          return false;
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_origin" },
    });
    expect(incoming.bodyUsed).toBe(false);
    expect(order).toEqual(["auth", "origin"]);
  });

  it("requires an exact JSON body with canonicalizable market and locale inputs", async () => {
    const invalidBodies = [
      {
        url: "https://acme.test",
        marketCode: "USA",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "prefer_cache",
      },
      {
        url: "https://acme.test",
        marketCode: "EU",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "prefer_cache",
      },
      {
        url: "https://acme.test",
        marketCode: "AA",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "prefer_cache",
      },
      {
        url: "https://acme.test",
        marketCode: "US",
        languageTag: "not_a_locale",
        outputLocale: "en",
        mode: "prefer_cache",
      },
      {
        url: "https://acme.test",
        marketCode: "US",
        languageTag: "en",
        outputLocale: "en",
        mode: "automatic",
      },
      {
        url: "https://acme.test",
        marketCode: "US",
        languageTag: "en",
        outputLocale: "en",
        mode: { toString: "refresh" },
      },
      {
        url: "https://acme.test",
        marketCode: "US",
        languageTag: "en",
        outputLocale: "en",
        mode: "refresh",
        unexpected: true,
      },
      {
        url: "https://acme.test",
        marketCode: "US",
        languageTag: "en",
        outputLocale: "en-US",
        mode: "refresh",
      },
    ];

    for (const body of invalidBodies) {
      const normalizeUrl = vi.fn<AgentProfileRefreshHandlerDependencies["normalizeUrl"]>();
      const response = await handleAgentProfileRefreshRequest(
        request(body),
        "seo",
        dependencies({ normalizeUrl }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_request" },
      });
      expect(normalizeUrl).not.toHaveBeenCalled();
    }
  });

  it("enforces JSON media type and the 4096-byte body ceiling after auth", async () => {
    const wrongMedia = new Request(
      "https://gengrowth.ai/api/agents/seo/profile-refresh",
      { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" },
    );
    const wrongMediaResponse = await handleAgentProfileRefreshRequest(
      wrongMedia,
      "seo",
      dependencies(),
    );
    expect(wrongMediaResponse.status).toBe(415);
    await expect(wrongMediaResponse.json()).resolves.toEqual({
      error: { code: "unsupported_media_type" },
    });

    const huge = request({
      url: `https://acme.test/${"a".repeat(4_096)}`,
      marketCode: "US",
      languageTag: "en",
      outputLocale: "en",
      mode: "prefer_cache",
    });
    const hugeResponse = await handleAgentProfileRefreshRequest(
      huge,
      "tech",
      dependencies(),
    );
    expect(hugeResponse.status).toBe(413);
    await expect(hugeResponse.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
  });

  it("returns invalid_url before crawl admission when the public URL normalizer rejects", async () => {
    const openGate = vi.fn<AgentProfileRefreshHandlerDependencies["openGate"]>();
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "tech",
      dependencies({
        normalizeUrl: vi.fn(() => ({
          ok: false as const,
          code: "invalid_url" as const,
        })),
        openGate,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_url" },
    });
    expect(openGate).not.toHaveBeenCalled();
  });

  it("keys the completed cache by full request identity while storing under the safe host", () => {
    const first = profileRefreshCacheNamespace("seo", {
      normalizedUrl: "https://acme.test/pricing",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    });

    expect(first).toMatch(/^agent_profile_refresh_v1_seo_[a-f0-9]{64}$/);
    expect(first).not.toContain("acme.test");
    expect(first).not.toContain("pricing");
    expect(
      profileRefreshCacheNamespace("seo", {
        normalizedUrl: "https://acme.test/features",
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
      }),
    ).not.toBe(first);
    expect(
      profileRefreshCacheNamespace("tech", {
        normalizedUrl: "https://acme.test/pricing",
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
      }),
    ).not.toBe(first);
    expect(
      profileRefreshCacheNamespace("seo", {
        normalizedUrl: "https://acme.test/pricing",
        marketCode: "DE",
        languageTag: "de",
        outputLocale: "en",
      }),
    ).not.toBe(first);
  });

  it("runs the site-level crawl in the selected primary language and synthesizes bounded pages", async () => {
    const release = vi.fn();
    const crawl = vi.fn(async () => contextResult());
    const synthesize = vi.fn(async () => ({ fields: [], usage: {} }));

    await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        openGate: vi.fn(async () => ({
          ok: true as const,
          kind: "crawl" as const,
          release,
        })),
        crawl,
        synthesize,
      }),
    );

    expect(crawl).toHaveBeenCalledWith("https://acme.test/pricing", {
      targetLanguage: "en",
      signal: expect.any(AbortSignal),
    });
    expect(synthesize).toHaveBeenCalledWith({
      agent: "seo",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
      pages: contextResult().pages.map((page) => ({
        url: page.url,
        title: page.title,
        headings: [...page.headings.h1, ...page.headings.h2, ...page.headings.h3],
        text: page.text,
      })),
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns and caches a strict fresh profile diagnosis after a cache miss", async () => {
    const fields = synthesisFields();
    const writeCache = vi.fn(async () => undefined);
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        crawl: vi.fn(async () => contextResult()),
        synthesize: vi.fn(async () => ({ fields, usage: { requestCount: 1 } })),
        writeCache,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: profileData("seo", "fresh") });
    const namespace = profileRefreshCacheNamespace("seo", {
      normalizedUrl: "https://acme.test/pricing",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    });
    expect(writeCache).toHaveBeenCalledWith(
      namespace,
      "acme.test",
      profileData("seo", "fresh"),
    );
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("writes a www profile refresh under its exact target host", async () => {
    const normalizedUrl = "https://www.acme.test/pricing";
    const writeCache = vi.fn(async () => undefined);
    const response = await handleAgentProfileRefreshRequest(
      request({
        url: normalizedUrl,
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "prefer_cache",
      }),
      "seo",
      dependencies({
        normalizeUrl: vi.fn(() => ({ ok: true as const, url: normalizedUrl })),
        crawl: vi.fn(async () => contextResult()),
        synthesize: vi.fn(async () => ({ fields: synthesisFields(), usage: {} })),
        writeCache,
      }),
    );

    expect(response.status).toBe(200);
    expect(writeCache).toHaveBeenCalledWith(
      profileRefreshCacheNamespace("seo", {
        normalizedUrl,
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
      }),
      "www.acme.test",
      expect.objectContaining({
        request: expect.objectContaining({ targetHost: "www.acme.test" }),
      }),
    );
  });

  it("marks the diagnosis available when all 14 readiness fields are available", async () => {
    const fields = synthesisFieldsForPaths(
      new Set(AGENT_PROFILE_REFRESH_READY_FIELD_PATHS),
    );
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        crawl: vi.fn(async () => contextResult()),
        synthesize: vi.fn(async () => ({ fields, usage: {} })),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.availability).toBe("available");
    expect(body.data.diagnostics.fieldsAvailable).toBe(14);
    expect(body.data.diagnostics.fieldsMissing).toBe(8);
  });

  it("serves a strict prefer-cache hit without crawling or synthesizing", async () => {
    const cached = profileData("tech", "fresh");
    const readCache = vi.fn(async () => ({
      payload: cached,
      capturedAt: "2026-08-13T01:05:06.000Z",
    }));
    const crawl = vi.fn<AgentProfileRefreshHandlerDependencies["crawl"]>();
    const synthesize = vi.fn<AgentProfileRefreshHandlerDependencies["synthesize"]>();
    const openGate = vi.fn<AgentProfileRefreshHandlerDependencies["openGate"]>(
      async (_ip, _url, cacheProbe) => {
        const hit = await cacheProbe?.("acme.test");
        if (!hit) throw new Error("expected a cache hit");
        return {
          ok: true,
          kind: "cached",
          payload: hit.payload,
          capturedAt: hit.capturedAt,
          release: vi.fn(),
        };
      },
    );
    const response = await handleAgentProfileRefreshRequest(
      request({
        url: "acme.test/pricing",
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "prefer_cache",
      }),
      "tech",
      dependencies({ readCache, openGate, crawl, synthesize }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      ...cached,
      request: { ...cached.request, submittedUrl: "acme.test/pricing" },
      cache: { status: "hit", capturedAt: "2026-08-13T01:05:06.000Z" },
    });
    expect(readCache).toHaveBeenCalledOnce();
    expect(crawl).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("reads a www profile refresh through its exact target host", async () => {
    const normalizedUrl = "https://www.acme.test/pricing";
    const cached = {
      ...profileData("tech", "fresh"),
      request: {
        ...profileData("tech", "fresh").request,
        normalizedUrl,
        targetHost: "www.acme.test",
      },
    } satisfies AgentProfileRefreshData;
    const readCache = vi.fn(async () => ({
      payload: cached,
      capturedAt: "2026-08-13T01:05:06.000Z",
    }));
    const openGate = vi.fn<AgentProfileRefreshHandlerDependencies["openGate"]>(
      async (_ip, _url, cacheProbe) => {
        const hit = await cacheProbe?.("www.acme.test");
        if (!hit) throw new Error("expected an exact-host cache hit");
        return {
          ok: true,
          kind: "cached",
          payload: hit.payload,
          capturedAt: hit.capturedAt,
          release: vi.fn(),
        };
      },
    );

    const response = await handleAgentProfileRefreshRequest(
      request({
        url: normalizedUrl,
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "prefer_cache",
      }),
      "tech",
      dependencies({
        normalizeUrl: vi.fn(() => ({ ok: true as const, url: normalizedUrl })),
        readCache,
        openGate,
      }),
    );

    expect(response.status).toBe(200);
    expect(readCache).toHaveBeenCalledWith(
      profileRefreshCacheNamespace("tech", {
        normalizedUrl,
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
      }),
      "www.acme.test",
    );
  });

  it("bypasses completed-result cache in refresh mode but keeps crawl admission", async () => {
    const readCache = vi.fn(async () => ({
      payload: profileData("seo", "fresh"),
      capturedAt: "2026-08-13T01:05:06.000Z",
    }));
    const openGate = vi.fn<AgentProfileRefreshHandlerDependencies["openGate"]>(
      async (_ip, _url, cacheProbe) => {
        expect(cacheProbe).toBeUndefined();
        return { ok: true, kind: "crawl", release: vi.fn() };
      },
    );
    const response = await handleAgentProfileRefreshRequest(
      request({
        url: "https://acme.test/pricing",
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "refresh",
      }),
      "seo",
      dependencies({
        readCache,
        openGate,
        crawl: vi.fn(async () => contextResult()),
        synthesize: vi.fn(async () => ({ fields: synthesisFields(), usage: {} })),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.cache.status).toBe("refreshed");
    expect(readCache).not.toHaveBeenCalled();
    expect(openGate).toHaveBeenCalledOnce();
  });

  it("fails closed when synthesis violates the strict profile contract", async () => {
    const release = vi.fn();
    const writeCache = vi.fn(async () => undefined);
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        openGate: vi.fn(async () => ({
          ok: true as const,
          kind: "crawl" as const,
          release,
        })),
        crawl: vi.fn(async () => contextResult()),
        synthesize: vi.fn(async () => ({ fields: [], usage: {} })),
        writeCache,
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "profile_response_invalid" },
    });
    expect(writeCache).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("reports an exhausted invalid model schema as an unverified response", async () => {
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        crawl: vi.fn(async () => contextResult()),
        synthesize: vi.fn(async () => {
          throw new KeywordLlmError(
            "schema_invalid",
            "reply did not match the field contract",
          );
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "profile_response_invalid" },
    });
  });

  it("ignores a malformed or mismatched cache row and performs the admitted crawl", async () => {
    const readCache = vi.fn(async () => ({
      payload: { ...profileData("seo"), agent: "tech" },
      capturedAt: "not-a-time",
    }));
    const crawl = vi.fn(async () => contextResult());
    const openGate = vi.fn<AgentProfileRefreshHandlerDependencies["openGate"]>(
      async (_ip, _url, cacheProbe) => {
        expect(await cacheProbe?.("acme.test")).toBeNull();
        return { ok: true, kind: "crawl", release: vi.fn() };
      },
    );
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        readCache,
        openGate,
        crawl,
        synthesize: vi.fn(async () => ({ fields: synthesisFields(), usage: {} })),
      }),
    );

    expect(response.status).toBe(200);
    expect(crawl).toHaveBeenCalledOnce();
  });

  it("does not turn a completed diagnosis into an error when cache storage fails", async () => {
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        crawl: vi.fn(async () => contextResult()),
        synthesize: vi.fn(async () => ({ fields: synthesisFields(), usage: {} })),
        writeCache: vi.fn(async () => {
          throw new Error("cache unavailable");
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: profileData("seo", "fresh"),
    });
  });

  it("does not synthesize or cache a crawl aborted by its request signal", async () => {
    const synthesize = vi.fn<AgentProfileRefreshHandlerDependencies["synthesize"]>();
    const writeCache = vi.fn(async () => undefined);
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        crawl: vi.fn(async () => ({
          ...contextResult(),
          stopReason: "aborted" as const,
        })),
        synthesize,
        writeCache,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "profile_source_unavailable" },
    });
    expect(synthesize).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it.each([
    ["bot_protection_blocked", 422],
    ["rate_limited_by_target", 429],
    ["protocol_downgrade_rejected", 400],
    ["too_few_pages", 422],
    ["invalid_target", 400],
    ["entry_unreachable", 502],
    ["robots_disallowed", 422],
    ["robots_unreachable", 422],
  ] as const)("preserves the safe context failure %s", async (code, status) => {
    const release = vi.fn();
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "seo",
      dependencies({
        openGate: vi.fn(async () => ({
          ok: true as const,
          kind: "crawl" as const,
          release,
        })),
        crawl: vi.fn(async () => {
          throw new ContextProfileError(code);
        }),
      }),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps gate refusal status and retry metadata while forcing private no-store", async () => {
    const refusal = Response.json(
      { error: { code: "target_busy" } },
      {
        status: 429,
        headers: { "Cache-Control": "public, max-age=60", "Retry-After": "17" },
      },
    );
    const response = await handleAgentProfileRefreshRequest(
      request(),
      "tech",
      dependencies({
        openGate: vi.fn(async () => ({ ok: false as const, response: refusal })),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({
      error: { code: "target_busy" },
    });
  });
});
