import { describe, expect, it, vi } from "vitest";
import { SourceError } from "../adapter.ts";
import {
  DATAFORSEO_RANKED_KEYWORDS_LIVE_URL,
  HttpDataForSeoClient,
  type DataForSeoFetch,
  type DataForSeoRankedKeywordsRequest,
} from "./client.ts";

const REQUEST: DataForSeoRankedKeywordsRequest = {
  target: "example.com",
  locationName: "United States",
  languageCode: "en",
  limit: 200,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successEnvelope(): unknown {
  return {
    status_code: 20_000,
    status_message: "Ok.",
    cost: 0.011,
    tasks: [
      {
        status_code: 20_000,
        status_message: "Ok.",
        cost: 0.011,
        result_count: 1,
        result: [
          {
            total_count: 2,
            items_count: 2,
            items: [
              {
                keyword_data: {
                  keyword: "seo platform",
                  keyword_info: { search_volume: 500 },
                },
                ranked_serp_element: {
                  serp_item: {
                    url: "https://example.com/seo",
                    rank_group: 6,
                  },
                },
              },
              {
                keyword_data: {
                  keyword: "seo reporting",
                  keyword_info: { search_volume: null },
                },
                ranked_serp_element: { serp_item: null },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("HttpDataForSeoClient", () => {
  it("sends one standard live organic task and keeps Basic Auth inside the HTTP boundary", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl: DataForSeoFetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(successEnvelope());
    };
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl,
    });

    const result = await client.rankedKeywords(REQUEST);

    expect(capturedUrl).toBe(DATAFORSEO_RANKED_KEYWORDS_LIVE_URL);
    expect(capturedInit?.method).toBe("POST");
    expect(new Headers(capturedInit?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("fixture-login:fixture-password").toString("base64")}`,
    );
    expect(JSON.parse(String(capturedInit?.body))).toEqual([
      {
        target: "example.com",
        location_name: "United States",
        language_code: "en",
        historical_serp_mode: "live",
        item_types: ["organic"],
        filters: [
          ["keyword_data.keyword_info.search_volume", ">", 0],
          "and",
          ["ranked_serp_element.serp_item.rank_group", ">=", 4],
          "and",
          ["ranked_serp_element.serp_item.rank_group", "<=", 20],
        ],
        order_by: [
          "keyword_data.keyword_info.search_volume,desc",
          "ranked_serp_element.serp_item.rank_group,asc",
        ],
        limit: 200,
      },
    ]);
    expect(result).toEqual({
      rows: [
        {
          keyword: "seo platform",
          searchVolume: 500,
          currentUrl: "https://example.com/seo",
          currentRank: 6,
        },
        {
          keyword: "seo reporting",
          searchVolume: null,
          currentUrl: null,
          currentRank: null,
        },
      ],
      totalCount: 2,
      itemsCount: 2,
      costUsd: 0.011,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
  });

  it("maps provider no-results status to a successful empty response", async () => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () =>
        jsonResponse({
          status_code: 20_000,
          cost: 0,
          tasks: [
            {
              status_code: 40_102,
              status_message: "No Search Results.",
              cost: 0,
              result: null,
            },
          ],
        }),
    });

    await expect(client.rankedKeywords(REQUEST)).resolves.toEqual({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
    });
  });

  it.each([
    [40_100, "AUTH_REQUIRED"],
    [40_103, "UNAVAILABLE"],
    [40_202, "RATE_LIMITED"],
    [40_209, "RATE_LIMITED"],
    [40_205, "QUOTA_EXCEEDED"],
    [40_206, "QUOTA_EXCEEDED"],
    [40_207, "PERMISSION_DENIED"],
    [40_210, "QUOTA_EXCEEDED"],
    [40_005, "INVALID_CONFIGURATION"],
  ] as const)(
    "maps provider task status %s to stable %s without leaking provider prose",
    async (statusCode, expectedCode) => {
      const fetchImpl = vi.fn(async () =>
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
      );
      const client = new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl,
      });

      const error = await client.rankedKeywords(REQUEST).catch(
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

    await expect(client.rankedKeywords(REQUEST)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("maps HTTP auth failures without reading or leaking the response body", async () => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => jsonResponse({ secret: "provider-secret" }, 401),
    });

    const error = await client.rankedKeywords(REQUEST).catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    expect((error as Error).message).not.toContain("provider-secret");
  });

  it("enforces the decoded response byte cap", async () => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      maxResponseBytes: 4,
      fetchImpl: async () => jsonResponse(successEnvelope()),
    });

    await expect(client.rankedKeywords(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("honors caller cancellation and exposes only the stable timeout code", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async (_url, init) => {
        if (init?.signal?.aborted) throw init.signal.reason;
        return jsonResponse(successEnvelope());
      },
    });

    await expect(
      client.rankedKeywords(REQUEST, controller.signal),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
