import { describe, expect, it, vi } from "vitest";
import { SourceError } from "../adapter.ts";
import {
  DATAFORSEO_COMPETITORS_DOMAIN_LIVE_URL,
  HttpDataForSeoClient,
  type DataForSeoCompetitorsDomainRequest,
  type DataForSeoFetch,
} from "./client.ts";
import { officialCompetitorsDomainLiveFixture } from "./competitors-domain.fixture.ts";

const REQUEST: DataForSeoCompetitorsDomainRequest = {
  target: "example.com",
  locationName: "United States",
  languageCode: "en",
  limit: 100,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpDataForSeoClient competitors-domain operation", () => {
  it("sends one exact organic live task and returns only the strict sanitized projection", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl: DataForSeoFetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(officialCompetitorsDomainLiveFixture());
    };
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl,
    });

    const result = await client.competitorsDomain({
      ...REQUEST,
      // Runtime callers cannot smuggle these fields into the provider task even
      // when they bypass the TypeScript request type.
      password: "must-not-cross-the-boundary",
      authorization: "must-not-cross-the-boundary",
    } as DataForSeoCompetitorsDomainRequest);

    expect(capturedUrl).toBe(DATAFORSEO_COMPETITORS_DOMAIN_LIVE_URL);
    expect(capturedInit?.method).toBe("POST");
    expect(new Headers(capturedInit?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("fixture-login:fixture-password").toString("base64")}`,
    );
    expect(JSON.parse(String(capturedInit?.body))).toEqual([
      {
        target: "example.com",
        location_name: "United States",
        language_code: "en",
        item_types: ["organic"],
        include_clickstream_data: false,
        filters: [["intersections", ">", 0]],
        order_by: [
          "intersections,desc",
          "competitor_metrics.organic.etv,desc",
          "domain,asc",
        ],
        limit: 100,
        offset: 0,
        max_rank_group: 20,
        exclude_top_domains: true,
        exclude_domains: ["example.com"],
        ignore_synonyms: false,
      },
    ]);
    expect(result).toEqual({
      rows: [
        {
          domain: "rival-one.example",
          averagePosition: 12.25,
          summedPosition: 49,
          intersections: 4,
          organicEstimatedTrafficVolume: 1_850.75,
        },
        {
          domain: "rival-two.example",
          averagePosition: 8,
          summedPosition: 8,
          intersections: 1,
          organicEstimatedTrafficVolume: 700,
        },
      ],
      totalCount: 2,
      itemsCount: 2,
      costUsd: 0.0203,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /authorization|credential|password|login|status_message|full_domain_metrics/i,
    );
    expect(String(capturedInit?.body)).not.toContain(
      "must-not-cross-the-boundary",
    );
  });

  it("accepts the documented successful empty shape without inventing rows", async () => {
    const fixture = officialCompetitorsDomainLiveFixture() as {
      tasks: Array<{
        result: Array<{
          total_count: number | null;
          items_count: number;
          items: unknown[] | null;
        }>;
      }>;
    };
    fixture.tasks[0]!.result[0] = {
      total_count: null,
      items_count: 0,
      items: null,
    };
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => jsonResponse(fixture),
    });

    await expect(client.competitorsDomain(REQUEST)).resolves.toEqual({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0.0203,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
  });

  it.each([
    ["a malformed domain", { domain: "not a domain" }],
    ["a fractional intersection count", { intersections: 1.5 }],
    ["a negative average position", { avg_position: -1 }],
    [
      "a missing organic competitor metric",
      { competitor_metrics: { organic: null } },
    ],
  ])("rejects %s", async (_label, rowPatch) => {
    const fixture = officialCompetitorsDomainLiveFixture() as {
      tasks: Array<{
        result: Array<{ items: Array<Record<string, unknown>> }>;
      }>;
    };
    Object.assign(fixture.tasks[0]!.result[0]!.items[0]!, rowPatch);
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => jsonResponse(fixture),
    });

    await expect(client.competitorsDomain(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects contradictory result counts", async () => {
    const fixture = officialCompetitorsDomainLiveFixture() as {
      tasks: Array<{ result: Array<{ items_count: number }> }>;
    };
    fixture.tasks[0]!.result[0]!.items_count = 99;
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => jsonResponse(fixture),
    });

    await expect(client.competitorsDomain(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it.each([
    [40_100, "AUTH_REQUIRED"],
    [40_103, "UNAVAILABLE"],
    [40_202, "RATE_LIMITED"],
    [40_210, "QUOTA_EXCEEDED"],
    [40_207, "PERMISSION_DENIED"],
    [40_005, "INVALID_CONFIGURATION"],
  ] as const)(
    "maps competitor task status %s to stable %s without provider prose",
    async (statusCode, expectedCode) => {
      const client = new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl: async () =>
          jsonResponse({
            status_code: 20_000,
            cost: 0,
            tasks: [
              {
                status_code: statusCode,
                status_message: "provider-secret-prose",
                cost: 0,
                result: null,
              },
            ],
          }),
      });

      const error = await client.competitorsDomain(REQUEST).catch(
        (value: unknown) => value,
      );
      expect(error).toBeInstanceOf(SourceError);
      expect(error).toMatchObject({ code: expectedCode });
      expect((error as Error).message).not.toContain("provider-secret-prose");
      expect((error as Error).message).not.toContain("fixture-password");
    },
  );

  it("classifies a failed envelope before requiring success-only fields", async () => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () =>
        jsonResponse({
          status_code: 40_100,
          status_message: "provider-secret-prose",
        }),
    });

    const error = await client.competitorsDomain(REQUEST).catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    expect((error as Error).message).not.toContain("provider-secret-prose");
  });

  it("maps HTTP failures without reading or leaking the response body", async () => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => jsonResponse({ secret: "provider-secret" }, 401),
    });

    const error = await client.competitorsDomain(REQUEST).catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    expect((error as Error).message).not.toContain("provider-secret");
  });

  it.each([
    [402, "QUOTA_EXCEEDED"],
    [403, "PERMISSION_DENIED"],
    [408, "TIMEOUT"],
    [429, "RATE_LIMITED"],
    [404, "INVALID_CONFIGURATION"],
    [503, "UNAVAILABLE"],
  ] as const)("maps HTTP %s to stable %s", async (status, expectedCode) => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => jsonResponse({ secret: "provider-secret" }, status),
    });

    const error = await client.competitorsDomain(REQUEST).catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ code: expectedCode });
    expect((error as Error).message).not.toContain("provider-secret");
  });

  it("rejects ambiguous locations and out-of-range caps before provider I/O", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(officialCompetitorsDomainLiveFixture()),
    );
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl,
    });

    await expect(
      client.competitorsDomain({
        ...REQUEST,
        locationCode: 2_840,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      client.competitorsDomain({
        ...REQUEST,
        limit: 1_001,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the decoded response cap and stable cancellation mapping", async () => {
    const capped = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      maxResponseBytes: 4,
      fetchImpl: async () =>
        jsonResponse(officialCompetitorsDomainLiveFixture()),
    });
    await expect(capped.competitorsDomain(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: vi.fn(async (_url, init) => {
        if (init?.signal?.aborted) throw init.signal.reason;
        return jsonResponse(officialCompetitorsDomainLiveFixture());
      }),
    });
    await expect(
      cancelled.competitorsDomain(REQUEST, controller.signal),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
