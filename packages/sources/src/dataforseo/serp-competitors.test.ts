import { describe, expect, it } from "vitest";
import { SourceError } from "../adapter.ts";
import {
  DATAFORSEO_SERP_COMPETITORS_LIVE_URL,
  HttpDataForSeoClient,
  type DataForSeoFetch,
} from "./client.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successEnvelope(): unknown {
  return {
    status_code: 20_000,
    cost: 0.02,
    tasks: [
      {
        status_code: 20_000,
        cost: 0.02,
        result_count: 1,
        result: [
          {
            total_count: 1,
            items_count: 1,
            items: [
              {
                domain: "Semrush.COM",
                avg_position: 3.5,
                median_position: 3,
                rating: 880,
                etv: 1200.25,
                keywords_count: 2,
                visibility: 0.42,
                relevant_serp_items: 2,
                keywords_positions: {},
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("HttpDataForSeoClient SERP competitors", () => {
  it("sends the bounded seed set and returns only factual provider fields", async () => {
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

    const result = await client.serpCompetitors({
      keywords: [" seo platform ", "geo analytics"],
      locationCode: 2840,
      languageCode: "en",
      limit: 100,
    });

    expect(capturedUrl).toBe(DATAFORSEO_SERP_COMPETITORS_LIVE_URL);
    expect(JSON.parse(String(capturedInit?.body))).toEqual([
      {
        keywords: ["seo platform", "geo analytics"],
        location_code: 2840,
        language_code: "en",
        item_types: ["organic"],
        limit: 100,
      },
    ]);
    expect(result).toEqual({
      rows: [
        {
          domain: "semrush.com",
          averagePosition: 3.5,
          medianPosition: 3,
          rating: 880,
          organicEstimatedTrafficVolume: 1200.25,
          keywordsCount: 2,
          visibility: 0.42,
          relevantSerpItems: 2,
        },
      ],
      totalCount: 1,
      itemsCount: 1,
      costUsd: 0.02,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /authorization|credential|password|keywords_positions/i,
    );
  });

  it("rejects empty or oversized seed sets before network I/O", async () => {
    let calls = 0;
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(successEnvelope());
      },
    });

    for (const keywords of [[], Array.from({ length: 201 }, (_, i) => `k${i}`)]) {
      await expect(
        client.serpCompetitors({
          keywords,
          locationName: "United States",
          languageCode: "en",
          limit: 100,
        }),
      ).rejects.toBeInstanceOf(SourceError);
    }
    expect(calls).toBe(0);
  });
});
