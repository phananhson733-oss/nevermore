import {
  COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK,
  COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT,
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
} from "@sf/public-tools";
import { describe, expect, it, vi } from "vitest";

import { readPublicToolJson } from "./public-tool-request.ts";
import { handleCompetitorKeywordGapRequest } from "./competitor-keyword-gap-handler.ts";

const ENDPOINT = "https://gengrowth.ai/api/tools/competitor-keyword-gap";
const VALID_INPUT = {
  siteDomain: "acme.com",
  competitorDomains: ["one.example"],
  marketCode: "US",
  languageCode: "en",
} as const;
const MARKET = {
  locationCode: 2840,
  locationName: "United States",
  languageCode: "en",
} as const;
const CREDENTIALS = { login: "dfs-login", password: "dfs-password" } as const;
const COMPLETED_AT = new Date("2026-08-24T12:00:00.000Z");

function authenticated() {
  return Promise.resolve({
    status: "authenticated" as const,
    userId: "user-1",
    email: "person@example.test",
    avatarUrl: null,
  });
}

function post(body: unknown): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function providerResponse(keyword = "gap keyword", rank = 4) {
  return {
    rows: [
      {
        keyword,
        searchVolume: 900,
        cpc: 2.5,
        keywordDifficulty: 27,
        providerIntent: "commercial" as const,
        firstDomainRank: rank,
        secondDomainRank: null,
        firstDomainUrl: null,
        firstDomainTitle: null,
        firstDomainEtv: null,
        coreKeyword: null,
        searchVolumeTrend: null,
        serpItemTypes: null,
        serpUpdatedAt: null,
      },
    ],
    totalCount: 1,
    costUsd: 0.011,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
  };
}

function runnableDependencies(overrides: Record<string, unknown> = {}) {
  const domainIntersection = vi.fn().mockResolvedValue(providerResponse());
  const releaseSlot = vi.fn();
  const releaseGsc = vi.fn();
  return {
    getServerAuthenticatedUser: authenticated,
    readJson: readPublicToolJson,
    resolveMarket: vi.fn().mockReturnValue(MARKET),
    credentials: vi.fn().mockReturnValue(CREDENTIALS),
    createProvider: vi.fn().mockReturnValue({ domainIntersection }),
    extractClientIp: vi.fn().mockReturnValue("203.0.113.9"),
    acquireSlot: vi.fn().mockReturnValue({
      acquired: true as const,
      release: releaseSlot,
    }),
    readGscSession: vi.fn().mockResolvedValue({
      properties: null,
      propertyTotal: 0,
      connectEnabled: true,
      consentNotice: "none",
    }),
    openGscGate: vi.fn().mockResolvedValue({
      ok: true as const,
      release: releaseGsc,
    }),
    resolveGscGrant: vi.fn().mockResolvedValue({ kind: "none" as const }),
    readCoverageQueries: vi.fn(),
    now: vi.fn().mockReturnValue(COMPLETED_AT),
    log: vi.fn(),
    domainIntersection,
    releaseSlot,
    releaseGsc,
    ...overrides,
  };
}

function connectedGscDependencies(overrides: Record<string, unknown> = {}) {
  return runnableDependencies({
    readGscSession: vi.fn().mockResolvedValue({
      properties: ["sc-domain:acme.com"],
      propertyTotal: 1,
      connectEnabled: true,
      consentNotice: "none",
    }),
    resolveGscGrant: vi.fn().mockResolvedValue({
      kind: "grant" as const,
      accessToken: "gsc-secret-token",
      properties: ["sc-domain:acme.com"],
      propertyTotal: 1,
    }),
    readCoverageQueries: vi.fn().mockResolvedValue({
      queryRows: [],
      queryPageRows: [],
      queryPaging: { pagesFetched: 1, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    }),
    ...overrides,
  });
}

describe("handleCompetitorKeywordGapRequest", () => {
  it("rejects an unauthenticated request before reading its body or touching external services", async () => {
    const readJson = vi.fn();
    const acquireSlot = vi.fn();
    const domainIntersection = vi.fn();
    const getServerAuthenticatedUser = vi.fn().mockResolvedValue({
      status: "unauthenticated",
    });

    const dependencies = {
      acquireSlot,
      domainIntersection,
      getServerAuthenticatedUser,
      readJson,
    };
    const response = await handleCompetitorKeywordGapRequest(
      new Request("https://gengrowth.ai/api/tools/competitor-keyword-gap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteDomain: "example.com",
          competitorDomains: ["competitor.com"],
          marketCode: "US",
          languageCode: "en",
        }),
      }),
      dependencies,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(getServerAuthenticatedUser).toHaveBeenCalledOnce();
    expect(readJson).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(domainIntersection).not.toHaveBeenCalled();
  });

  it.each([
    [
      "returns unavailable",
      vi.fn().mockResolvedValue({ status: "unavailable" }),
    ],
    ["throws", vi.fn().mockRejectedValue(new Error("auth outage"))],
  ])(
    "returns auth_unavailable before any other work when authentication %s",
    async (_label, getServerAuthenticatedUser) => {
      const readJson = vi.fn();
      const acquireSlot = vi.fn();
      const domainIntersection = vi.fn();
      const dependencies = {
        acquireSlot,
        domainIntersection,
        getServerAuthenticatedUser,
        readJson,
      };

      const response = await handleCompetitorKeywordGapRequest(
        new Request("https://gengrowth.ai/api/tools/competitor-keyword-gap", {
          method: "POST",
        }),
        dependencies,
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: { code: "auth_unavailable" },
      });
      expect(readJson).not.toHaveBeenCalled();
      expect(acquireSlot).not.toHaveBeenCalled();
      expect(domainIntersection).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "unsupported media type",
      new Request(ENDPOINT, { method: "POST", body: "{}" }),
      415,
      "unsupported_media_type",
    ],
    [
      "declared oversized body",
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "4097",
        },
        body: "{}",
      }),
      413,
      "payload_too_large",
    ],
    [
      "streamed oversized body",
      new Request(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(5_000) }),
      }),
      413,
      "payload_too_large",
    ],
    [
      "malformed JSON",
      new Request(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      400,
      "invalid_request",
    ],
  ])(
    "enforces the 4KB JSON boundary for %s",
    async (_label, request, expectedStatus, expectedCode) => {
      const acquireSlot = vi.fn();
      const response = await handleCompetitorKeywordGapRequest(request, {
        getServerAuthenticatedUser: authenticated,
        readJson: readPublicToolJson,
        acquireSlot,
      });

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({
        error: { code: expectedCode },
      });
      expect(acquireSlot).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid Task2 input before market resolution or admission", async () => {
    const resolveMarket = vi.fn();
    const acquireSlot = vi.fn();
    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, competitorDomains: [] }),
      {
        getServerAuthenticatedUser: authenticated,
        readJson: readPublicToolJson,
        resolveMarket,
        acquireSlot,
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_input" },
    });
    expect(resolveMarket).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
  });

  it("rejects a market or language combination DataForSEO does not serve", async () => {
    const resolveMarket = vi.fn().mockReturnValue(null);
    const credentials = vi.fn();
    const acquireSlot = vi.fn();
    const response = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      {
        getServerAuthenticatedUser: authenticated,
        readJson: readPublicToolJson,
        resolveMarket,
        credentials,
        acquireSlot,
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_input" },
    });
    expect(resolveMarket).toHaveBeenCalledWith("US", "en");
    expect(credentials).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
  });

  it("fails closed before admission when DataForSEO credentials are absent", async () => {
    const credentials = vi.fn().mockReturnValue(null);
    const acquireSlot = vi.fn();
    const response = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      {
        getServerAuthenticatedUser: authenticated,
        readJson: readPublicToolJson,
        resolveMarket: vi.fn().mockReturnValue({
          locationCode: 2840,
          locationName: "United States",
          languageCode: "en",
        }),
        credentials,
        acquireSlot,
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
    expect(credentials).toHaveBeenCalledOnce();
    expect(acquireSlot).not.toHaveBeenCalled();
  });

  it("refuses a stale client's declared contract version before any paid, gated, or logged work", async () => {
    const dependencies = runnableDependencies();

    const response = await handleCompetitorKeywordGapRequest(
      post({
        ...VALID_INPUT,
        acceptSchemaVersion: "competitor_keyword_gap.v2",
      }),
      dependencies,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    // No Retry-After: retrying from the same stale bundle can never succeed.
    expect(response.headers.get("Retry-After")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: { code: "client_out_of_date" },
    });
    expect(dependencies.resolveMarket).not.toHaveBeenCalled();
    expect(dependencies.credentials).not.toHaveBeenCalled();
    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(dependencies.acquireSlot).not.toHaveBeenCalled();
    expect(dependencies.readGscSession).not.toHaveBeenCalled();
    expect(dependencies.readCoverageQueries).not.toHaveBeenCalled();
    expect(dependencies.log).not.toHaveBeenCalled();
  });

  it("runs a request that declares the current contract version exactly like one that omits it", async () => {
    const dependencies = runnableDependencies();

    const response = await handleCompetitorKeywordGapRequest(
      post({
        ...VALID_INPUT,
        acceptSchemaVersion: COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { run: { schemaVersion: string } };
    };
    expect(body.data.run.schemaVersion).toBe(
      COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
    );
    expect(dependencies.domainIntersection).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledOnce();
  });

  it("still serves a legacy request that does not declare a contract version", async () => {
    const dependencies = runnableDependencies();

    const response = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.domainIntersection).toHaveBeenCalledOnce();
  });

  it("returns a namespaced per-account conflict without constructing the provider", async () => {
    const acquireSlot = vi.fn().mockReturnValue({ acquired: false as const });
    const dependencies = runnableDependencies({ acquireSlot });

    const response = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      dependencies,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("5");
    await expect(response.json()).resolves.toEqual({
      error: { code: "search_in_progress" },
    });
    expect(acquireSlot).toHaveBeenCalledWith(
      "tools:competitor-keyword-gap:inflight:user-1",
    );
    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(dependencies.log).not.toHaveBeenCalled();
  });

  it("uses the same account-scoped slot key when one user changes IP", async () => {
    const acquireSlot = vi.fn().mockReturnValue({ acquired: false as const });
    const extractClientIp = vi
      .fn()
      .mockReturnValueOnce("203.0.113.9")
      .mockReturnValueOnce("198.51.100.17");
    const dependencies = runnableDependencies({
      acquireSlot,
      extractClientIp,
    });

    const first = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      dependencies,
    );
    const second = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      dependencies,
    );

    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect(acquireSlot.mock.calls).toEqual([
      ["tools:competitor-keyword-gap:inflight:user-1"],
      ["tools:competitor-keyword-gap:inflight:user-1"],
    ]);
    expect(dependencies.createProvider).not.toHaveBeenCalled();
  });

  it.each([1, 5])(
    "issues exactly one non-intersection DataForSEO call for each of %i competitors",
    async (competitorCount) => {
      const competitorDomains = Array.from(
        { length: competitorCount },
        (_, index) => `c${index + 1}.example`,
      );
      const domainIntersection = vi
        .fn()
        .mockImplementation(async (request: { readonly target1: string }) =>
          providerResponse(`${request.target1} keyword`),
        );
      const dependencies = runnableDependencies({
        createProvider: vi.fn().mockReturnValue({ domainIntersection }),
      });
      const request = post({ ...VALID_INPUT, competitorDomains });

      const response = await handleCompetitorKeywordGapRequest(
        request,
        dependencies,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store, private");
      const body = (await response.json()) as {
        data: { run: { status: string }; result: { rows: unknown[] } };
      };
      expect(body.data.run.status).toBe("complete");
      expect(body.data.result.rows).toHaveLength(competitorCount);
      expect(dependencies.createProvider).toHaveBeenCalledWith(CREDENTIALS);
      expect(domainIntersection).toHaveBeenCalledTimes(competitorCount);
      competitorDomains.forEach((domain, index) => {
        expect(domainIntersection).toHaveBeenNthCalledWith(
          index + 1,
          {
            target1: domain,
            target2: "acme.com",
            locationCode: 2840,
            languageCode: "en",
            intersections: false,
            limit: 300,
            maxFirstDomainRank: 20,
            includeSerpInfo: true,
          },
          request.signal,
        );
      });
      expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
      expect(dependencies.log).toHaveBeenCalledOnce();
      expect(dependencies.readGscSession).not.toHaveBeenCalled();
      expect(dependencies.openGscGate).not.toHaveBeenCalled();
      expect(dependencies.resolveGscGrant).not.toHaveBeenCalled();
      expect(dependencies.readCoverageQueries).not.toHaveBeenCalled();
    },
  );

  it("returns a partial report when four provider calls succeed and one fails", async () => {
    const competitorDomains = [
      "c1.example",
      "c2.example",
      "c3.example",
      "c4.example",
      "c5.example",
    ];
    const domainIntersection = vi
      .fn()
      .mockImplementation(async (request: { readonly target1: string }) => {
        if (request.target1 === "c5.example") {
          throw new Error("provider timeout for secret.example");
        }
        return providerResponse(`${request.target1} keyword`);
      });
    const dependencies = runnableDependencies({
      createProvider: vi.fn().mockReturnValue({ domainIntersection }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, competitorDomains }),
      dependencies,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        run: { status: string };
        result: {
          completedCompetitors: number;
          unavailableCompetitors: number;
          competitors: Array<{ domain: string; status: string }>;
        };
      };
    };
    expect(body.data.run.status).toBe("partial");
    expect(body.data.result.completedCompetitors).toBe(4);
    expect(body.data.result.unavailableCompetitors).toBe(1);
    expect(body.data.result.competitors.at(-1)).toEqual(
      expect.objectContaining({
        domain: "c5.example",
        status: "unavailable",
      }),
    );
    expect(domainIntersection).toHaveBeenCalledTimes(5);
    expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "partial",
        completedCompetitors: 4,
        unavailableCompetitors: 1,
        costUsd: 0.044,
        reportProduced: true,
      }),
    );
  });

  it("returns keyword_source_unavailable when every provider call rejects", async () => {
    const domainIntersection = vi.fn().mockRejectedValue(new Error("DFS down"));
    const dependencies = runnableDependencies({
      createProvider: vi.fn().mockReturnValue({ domainIntersection }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({
        ...VALID_INPUT,
        competitorDomains: ["one.example", "two.example"],
      }),
      dependencies,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
    expect(domainIntersection).toHaveBeenCalledTimes(2);
    expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledWith({
      status: "unavailable",
      requestedCompetitors: 2,
      completedCompetitors: 0,
      unavailableCompetitors: 2,
      rowCount: 0,
      costUsd: null,
      gsc: "not_requested",
      reportProduced: false,
    });
  });

  it("does not read GSC coverage when every DFS call already failed", async () => {
    const domainIntersection = vi.fn().mockRejectedValue(new Error("DFS down"));
    const readCoverageQueries = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    const dependencies = connectedGscDependencies({
      createProvider: vi.fn().mockReturnValue({ domainIntersection }),
      readCoverageQueries,
    });

    const outcome = await Promise.race([
      handleCompetitorKeywordGapRequest(
        post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
        dependencies,
      ),
      new Promise<"timed_out">((resolve) => {
        setTimeout(() => resolve("timed_out"), 100);
      }),
    ]);

    expect(outcome).toBeInstanceOf(Response);
    if (!(outcome instanceof Response)) return;
    expect(outcome.status).toBe(502);
    // The preflight is what runs before the provider; the read is what does
    // not, because there is nothing left to overlay.
    expect(dependencies.readGscSession).toHaveBeenCalledOnce();
    expect(dependencies.openGscGate).toHaveBeenCalledOnce();
    expect(dependencies.resolveGscGrant).toHaveBeenCalledOnce();
    expect(readCoverageQueries).not.toHaveBeenCalled();
    expect(dependencies.releaseGsc).toHaveBeenCalledOnce();
    expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledOnce();
  });

  it("treats fulfilled zero-row provider responses as complete evidence", async () => {
    const domainIntersection = vi.fn().mockResolvedValue({
      ...providerResponse(),
      rows: [],
      totalCount: 0,
    });
    const dependencies = runnableDependencies({
      createProvider: vi.fn().mockReturnValue({ domainIntersection }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      dependencies,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        run: { status: string };
        result: { completedCompetitors: number; rows: unknown[] };
      };
    };
    expect(body.data.run.status).toBe("complete");
    expect(body.data.result.completedCompetitors).toBe(1);
    expect(body.data.result.rows).toEqual([]);
    expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
  });

  it("refuses before spending when the session cannot read the selected property", async () => {
    const dependencies = runnableDependencies({
      readGscSession: vi.fn().mockResolvedValue({
        properties: ["sc-domain:other.example"],
        propertyTotal: 1,
        connectEnabled: true,
        consentNotice: "none",
      }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "gsc_property_not_granted" },
    });
    // The whole point of the refusal: nothing was bought.
    expect(dependencies.domainIntersection).not.toHaveBeenCalled();
    expect(dependencies.readGscSession).toHaveBeenCalledOnce();
    expect(dependencies.openGscGate).not.toHaveBeenCalled();
    expect(dependencies.resolveGscGrant).not.toHaveBeenCalled();
    expect(dependencies.readCoverageQueries).not.toHaveBeenCalled();
    expect(dependencies.releaseGsc).not.toHaveBeenCalled();
    expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledWith(
      expect.objectContaining({ gsc: "refused", reportProduced: false }),
    );
  });

  it("refuses before spending when a granted property belongs to another site", async () => {
    const readCoverageQueries = vi.fn();
    const dependencies = connectedGscDependencies({
      readGscSession: vi.fn().mockResolvedValue({
        properties: ["sc-domain:other.com"],
        propertyTotal: 1,
        connectEnabled: true,
        consentNotice: "none",
      }),
      resolveGscGrant: vi.fn().mockResolvedValue({
        kind: "grant",
        accessToken: "gsc-secret-token",
        properties: ["sc-domain:other.com"],
        propertyTotal: 1,
      }),
      readCoverageQueries,
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:other.com" }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "gsc_property_site_mismatch" },
    });
    expect(dependencies.domainIntersection).not.toHaveBeenCalled();
    expect(dependencies.readGscSession).toHaveBeenCalledOnce();
    expect(dependencies.openGscGate).not.toHaveBeenCalled();
    expect(dependencies.resolveGscGrant).not.toHaveBeenCalled();
    expect(readCoverageQueries).not.toHaveBeenCalled();
    expect(dependencies.releaseGsc).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the cheap session read throws",
      { readGscSession: vi.fn().mockRejectedValue(new Error("cookie secret")) },
      503,
      "gsc_temporarily_unavailable",
      false,
    ],
    [
      "the cheap session has no grant",
      {
        readGscSession: vi.fn().mockResolvedValue({
          properties: null,
          propertyTotal: 0,
          connectEnabled: true,
          consentNotice: "none",
        }),
      },
      403,
      "gsc_property_not_granted",
      false,
    ],
    [
      "the GSC gate throws",
      { openGscGate: vi.fn().mockRejectedValue(new Error("quota store")) },
      503,
      "gsc_temporarily_unavailable",
      false,
    ],
    [
      "grant resolution throws",
      { resolveGscGrant: vi.fn().mockRejectedValue(new Error("oauth down")) },
      503,
      "gsc_temporarily_unavailable",
      true,
    ],
    [
      "the grant is absent",
      { resolveGscGrant: vi.fn().mockResolvedValue({ kind: "none" }) },
      401,
      "gsc_revoked",
      true,
    ],
    [
      "the grant is revoked",
      { resolveGscGrant: vi.fn().mockResolvedValue({ kind: "revoked" }) },
      401,
      "gsc_revoked",
      true,
    ],
    [
      "the grant is temporarily unavailable",
      { resolveGscGrant: vi.fn().mockResolvedValue({ kind: "unavailable" }) },
      503,
      "gsc_temporarily_unavailable",
      true,
    ],
    [
      "the refreshed grant no longer contains the property",
      {
        resolveGscGrant: vi.fn().mockResolvedValue({
          kind: "grant",
          accessToken: "gsc-secret-token",
          properties: ["sc-domain:other.example"],
          propertyTotal: 1,
        }),
      },
      403,
      "gsc_property_not_granted",
      true,
    ],
  ])(
    "refuses the whole run before any paid call when %s",
    async (_label, overrides, status, code, shouldReleaseGsc) => {
      const dependencies = connectedGscDependencies(overrides);

      const response = await handleCompetitorKeywordGapRequest(
        post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
        dependencies,
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code } });
      // A request that named a property asked for both halves. When the
      // first-party half provably cannot happen, the visitor is not charged
      // for a report whose "your status" column would be empty.
      expect(dependencies.domainIntersection).not.toHaveBeenCalled();
      expect(dependencies.readCoverageQueries).not.toHaveBeenCalled();
      expect(dependencies.releaseGsc).toHaveBeenCalledTimes(
        shouldReleaseGsc ? 1 : 0,
      );
      expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
      expect(dependencies.log).toHaveBeenCalledWith(
        expect.objectContaining({ gsc: "refused", reportProduced: false }),
      );
    },
  );

  it("returns the shared gate's own refusal verbatim, with its Retry-After", async () => {
    const dependencies = connectedGscDependencies({
      openGscGate: vi.fn().mockResolvedValue({
        ok: false,
        response: Response.json(
          { error: { code: "rate_limited" } },
          { status: 429, headers: { "Retry-After": "1800" } },
        ),
      }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
      dependencies,
    );

    // Passed through rather than re-coded, so the visitor keeps the one piece
    // of information a rate limit carries: when it resets.
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1800");
    expect(await response.json()).toEqual({ error: { code: "rate_limited" } });
    expect(dependencies.domainIntersection).not.toHaveBeenCalled();
    // The gate releases its own slot on refusal; the handler must not double-release.
    expect(dependencies.releaseGsc).not.toHaveBeenCalled();
  });

  it("still delivers the DataForSEO half when only the coverage read fails", async () => {
    const dependencies = connectedGscDependencies({
      readCoverageQueries: vi.fn().mockRejectedValue(new Error("GSC down")),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
      dependencies,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        run: { status: string };
        result: { overlayStatus: string; rows: unknown[] };
      };
    };
    // The read is the ONE overlay failure the preflight cannot predict, so it
    // is the only reason a delivered report may still carry an empty overlay.
    expect(body.data.run.status).toBe("partial");
    expect(body.data.result.overlayStatus).toBe("unavailable");
    expect(body.data.result.rows).toHaveLength(1);
    expect(dependencies.domainIntersection).toHaveBeenCalledOnce();
    expect(dependencies.releaseGsc).toHaveBeenCalledOnce();
    expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
  });

  it("maps a successful GSC query and query-page read into the report", async () => {
    const readCoverageQueries = vi.fn().mockResolvedValue({
      queryRows: [{ query: "gap keyword", impressions: 120, position: 22.5 }],
      queryPageRows: [
        {
          query: "gap keyword",
          page: "https://acme.com/existing",
          impressions: 120,
          position: 22.5,
        },
      ],
      queryPaging: { pagesFetched: 2, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    });
    const dependencies = connectedGscDependencies({ readCoverageQueries });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
      dependencies,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        run: { status: string };
        result: {
          overlayStatus: string;
          rows: Array<{
            gsc: {
              queryStatus: string;
              evidenceBasis: string | null;
              queryImpressions: number | null;
              queryPosition: number | null;
              pageStatus: string;
              pageUrl: string | null;
              pageImpressions: number | null;
              pagePosition: number | null;
              queryPageCoverage: number | null;
              nextStep: string;
            };
          }>;
        };
      };
    };
    expect(body.data.run.status).toBe("complete");
    expect(body.data.result.overlayStatus).toBe("available");
    expect(body.data.result.rows[0]?.gsc).toEqual({
      queryStatus: "observed_weak",
      evidenceBasis: "query",
      queryImpressions: 120,
      queryPosition: 22.5,
      pageStatus: "observed_sufficient",
      pageUrl: "https://acme.com/existing",
      pageImpressions: 120,
      pagePosition: 22.5,
      queryPageCoverage: 1,
      nextStep: "optimize_existing",
    });
    expect(readCoverageQueries).toHaveBeenCalledWith({
      property: "sc-domain:acme.com",
      accessToken: "gsc-secret-token",
    });
    expect(dependencies.releaseGsc).toHaveBeenCalledOnce();
  });

  it("accepts a granted root URL-prefix property that matches the site", async () => {
    const readCoverageQueries = vi.fn().mockResolvedValue({
      queryRows: [],
      queryPageRows: [],
      queryPaging: { pagesFetched: 1, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    });
    const dependencies = connectedGscDependencies({
      readGscSession: vi.fn().mockResolvedValue({
        properties: ["https://acme.com/"],
        propertyTotal: 1,
        connectEnabled: true,
        consentNotice: "none",
      }),
      resolveGscGrant: vi.fn().mockResolvedValue({
        kind: "grant",
        accessToken: "gsc-secret-token",
        properties: ["https://acme.com/"],
        propertyTotal: 1,
      }),
      readCoverageQueries,
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "https://acme.com/" }),
      dependencies,
    );
    const body = (await response.json()) as {
      data: {
        run: { status: string };
        result: { overlayStatus: string };
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.run.status).toBe("complete");
    expect(body.data.result.overlayStatus).toBe("available");
    expect(readCoverageQueries).toHaveBeenCalledWith({
      property: "https://acme.com/",
      accessToken: "gsc-secret-token",
    });
    expect(dependencies.releaseGsc).toHaveBeenCalledOnce();
  });

  it("accepts an exact granted URL-prefix property on the canonical site host", async () => {
    const property = "https://www.acme.com:8443/blog/";
    const readCoverageQueries = vi.fn().mockResolvedValue({
      queryRows: [],
      queryPageRows: [],
      queryPaging: { pagesFetched: 1, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    });
    const dependencies = connectedGscDependencies({
      readGscSession: vi.fn().mockResolvedValue({
        properties: [property],
        propertyTotal: 1,
        connectEnabled: true,
        consentNotice: "none",
      }),
      resolveGscGrant: vi.fn().mockResolvedValue({
        kind: "grant",
        accessToken: "gsc-secret-token",
        properties: [property],
        propertyTotal: 1,
      }),
      readCoverageQueries,
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property }),
      dependencies,
    );
    const body = (await response.json()) as {
      data: {
        run: { status: string };
        result: { overlayStatus: string };
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.run.status).toBe("complete");
    expect(body.data.result.overlayStatus).toBe("available");
    expect(dependencies.openGscGate).toHaveBeenCalledWith("203.0.113.9");
    expect(dependencies.resolveGscGrant).toHaveBeenCalledOnce();
    expect(readCoverageQueries).toHaveBeenCalledWith({
      property,
      accessToken: "gsc-secret-token",
    });
    expect(dependencies.releaseGsc).toHaveBeenCalledOnce();
  });

  it.each(["https://other.com/blog/", "https://sub.acme.com/blog/"])(
    "refuses before spending on an exact granted URL-prefix property outside the canonical site host: %s",
    async (property) => {
      const readCoverageQueries = vi.fn();
      const dependencies = connectedGscDependencies({
        readGscSession: vi.fn().mockResolvedValue({
          properties: [property],
          propertyTotal: 1,
          connectEnabled: true,
          consentNotice: "none",
        }),
        resolveGscGrant: vi.fn().mockResolvedValue({
          kind: "grant",
          accessToken: "gsc-secret-token",
          properties: [property],
          propertyTotal: 1,
        }),
        readCoverageQueries,
      });

      const response = await handleCompetitorKeywordGapRequest(
        post({ ...VALID_INPUT, property }),
        dependencies,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "gsc_property_site_mismatch" },
      });
      expect(dependencies.domainIntersection).not.toHaveBeenCalled();
      expect(dependencies.openGscGate).not.toHaveBeenCalled();
      expect(dependencies.resolveGscGrant).not.toHaveBeenCalled();
      expect(readCoverageQueries).not.toHaveBeenCalled();
      expect(dependencies.releaseGsc).not.toHaveBeenCalled();
    },
  );

  it("preserves successful but truncated GSC paging as a partial overlay", async () => {
    const dependencies = connectedGscDependencies({
      readCoverageQueries: vi.fn().mockResolvedValue({
        queryRows: [],
        queryPageRows: [],
        queryPaging: { pagesFetched: 4, truncated: true },
        queryPagePaging: { pagesFetched: 1, truncated: false },
      }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
      dependencies,
    );
    const body = (await response.json()) as {
      data: {
        run: { status: string };
        result: {
          overlayStatus: string;
          gscQueryTruncated: boolean;
          gscQueryPageTruncated: boolean;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.run.status).toBe("partial");
    expect(body.data.result.overlayStatus).toBe("partial");
    expect(body.data.result.gscQueryTruncated).toBe(true);
    expect(body.data.result.gscQueryPageTruncated).toBe(false);
    expect(dependencies.releaseGsc).toHaveBeenCalledOnce();
  });

  it("passes the competitor page and snapshot fields into the report", async () => {
    const base = providerResponse();
    const domainIntersection = vi.fn().mockResolvedValue({
      ...base,
      rows: [
        {
          ...base.rows[0],
          firstDomainUrl: "https://one.example/guides/gap-keyword",
          firstDomainTitle: "Gap keyword guide",
          firstDomainEtv: 412.5,
          coreKeyword: "gap keyword",
          searchVolumeTrend: { monthly: 5, quarterly: -3, yearly: 12 },
          serpItemTypes: ["organic", "ai_overview"],
          serpUpdatedAt: "2026-05-14T18:17:21.000Z",
        },
      ],
    });
    const dependencies = runnableDependencies({
      createProvider: vi.fn().mockReturnValue({ domainIntersection }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      dependencies,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        result: {
          rows: Array<{
            competitorPages: Record<
              string,
              { url: string | null; title: string | null; etv: number | null }
            >;
            coreKeyword: string | null;
            searchVolumeTrend: {
              monthly: number | null;
              quarterly: number | null;
              yearly: number | null;
            } | null;
            serpSnapshot: {
              itemTypes: string[];
              updatedAt: string | null;
            } | null;
            preScreen: { band: string; basis: string; reason: string };
          }>;
        };
      };
    };
    const row = body.data.result.rows[0];
    expect(row?.competitorPages).toEqual({
      "one.example": {
        url: "https://one.example/guides/gap-keyword",
        title: "Gap keyword guide",
        etv: 412.5,
      },
    });
    expect(row?.coreKeyword).toBe("gap keyword");
    expect(row?.searchVolumeTrend).toEqual({
      monthly: 5,
      quarterly: -3,
      yearly: 12,
    });
    expect(row?.serpSnapshot).toEqual({
      itemTypes: ["organic", "ai_overview"],
      updatedAt: "2026-05-14T18:17:21.000Z",
    });
    expect(row?.serpSnapshot?.itemTypes).toContain("ai_overview");
    expect(["dfs_estimate", "tool_heuristic"]).toContain(row?.preScreen.basis);
    expect(typeof row?.preScreen.band).toBe("string");
    expect(typeof row?.preScreen.reason).toBe("string");
  });

  it("records the sample rule and GSC row counts in the envelope", async () => {
    const readCoverageQueries = vi.fn().mockResolvedValue({
      queryRows: [
        { query: "gap keyword", impressions: 40, position: 18 },
        { query: "other query", impressions: 12, position: 30 },
      ],
      queryPageRows: [],
      queryPaging: { pagesFetched: 1, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    });
    const withGsc = connectedGscDependencies({ readCoverageQueries });
    const withoutGsc = runnableDependencies();

    const connected = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
      withGsc,
    );
    const standalone = await handleCompetitorKeywordGapRequest(
      post(VALID_INPUT),
      withoutGsc,
    );

    expect(connected.status).toBe(200);
    expect(standalone.status).toBe(200);
    type Envelope = {
      data: {
        result: {
          sampleRule: {
            maxCompetitorRank: number;
            perCompetitorLimit: number;
            serpSnapshotRequested: boolean;
          };
          gscQueryRowCount: number | null;
          gscQueryPageRowCount: number | null;
        };
      };
    };
    const connectedBody = (await connected.json()) as Envelope;
    const standaloneBody = (await standalone.json()) as Envelope;
    const expectedRule = {
      maxCompetitorRank: COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK,
      perCompetitorLimit: COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT,
      serpSnapshotRequested: true,
    };
    expect(expectedRule).toEqual({
      maxCompetitorRank: 20,
      perCompetitorLimit: 300,
      serpSnapshotRequested: true,
    });
    expect(connectedBody.data.result.sampleRule).toEqual(expectedRule);
    expect(standaloneBody.data.result.sampleRule).toEqual(expectedRule);
    expect(connectedBody.data.result.gscQueryRowCount).toBe(2);
    expect(connectedBody.data.result.gscQueryPageRowCount).toBe(0);
    expect(standaloneBody.data.result.gscQueryRowCount).toBeNull();
    expect(standaloneBody.data.result.gscQueryPageRowCount).toBeNull();
    expect(withGsc.log).toHaveBeenCalledOnce();
    expect(Object.keys(withGsc.log.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      "completedCompetitors",
      "costUsd",
      "gsc",
      "reportProduced",
      "requestedCompetitors",
      "rowCount",
      "status",
      "unavailableCompetitors",
    ]);
  });

  it("emits exactly one sanitized final log for an acquired run", async () => {
    const domainIntersection = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("sensitive query phrase"))
      .mockRejectedValueOnce(
        new Error("raw provider error for two.example and secret-token"),
      );
    const dependencies = connectedGscDependencies({
      createProvider: vi.fn().mockReturnValue({ domainIntersection }),
      readCoverageQueries: vi.fn().mockResolvedValue({
        queryRows: [
          {
            query: "sensitive query phrase",
            impressions: 20,
            position: 12,
          },
        ],
        queryPageRows: [],
        queryPaging: { pagesFetched: 1, truncated: false },
        queryPagePaging: { pagesFetched: 1, truncated: false },
      }),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({
        ...VALID_INPUT,
        property: "sc-domain:acme.com",
        competitorDomains: ["one.example", "two.example"],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.log).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledWith({
      status: "partial",
      requestedCompetitors: 2,
      completedCompetitors: 1,
      unavailableCompetitors: 1,
      rowCount: 1,
      costUsd: 0.011,
      gsc: "available",
      reportProduced: true,
    });

    const serialized = JSON.stringify(dependencies.log.mock.calls[0]?.[0]);
    for (const sensitiveValue of [
      "user-1",
      "person@example.test",
      "acme.com",
      "one.example",
      "two.example",
      "sensitive query phrase",
      "sc-domain:acme.com",
      "gsc-secret-token",
      "raw provider error",
      "dfs-login",
      "dfs-password",
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
  });

  it("keeps known DFS cost, completion, and GSC facts when report construction later fails", async () => {
    const dependencies = connectedGscDependencies({
      now: vi.fn().mockReturnValue(new Date(Number.NaN)),
    });

    const response = await handleCompetitorKeywordGapRequest(
      post({ ...VALID_INPUT, property: "sc-domain:acme.com" }),
      dependencies,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
    expect(dependencies.domainIntersection).toHaveBeenCalledOnce();
    expect(dependencies.readCoverageQueries).toHaveBeenCalledOnce();
    expect(dependencies.releaseGsc).toHaveBeenCalledOnce();
    expect(dependencies.releaseSlot).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledWith({
      status: "unavailable",
      requestedCompetitors: 1,
      completedCompetitors: 1,
      unavailableCompetitors: 0,
      rowCount: 0,
      costUsd: 0.011,
      gsc: "available",
      reportProduced: false,
    });
  });
});
