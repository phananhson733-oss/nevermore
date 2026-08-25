import { describe, expect, it, vi } from "vitest";
import { SourceError } from "../adapter.ts";
import {
  DATAFORSEO_DOMAIN_INTERSECTION_LIVE_URL,
  HttpDataForSeoClient,
  type DataForSeoDomainIntersectionRequest,
  type DataForSeoFetch,
} from "./client.ts";

const REQUEST: DataForSeoDomainIntersectionRequest = {
  target1: "competitor.example",
  target2: "site.example",
  locationCode: 2_840,
  languageCode: "en",
  intersections: false,
  limit: 100,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successEnvelope(
  items: readonly unknown[] = [
    {
      keyword_data: {
        keyword: "approval workflow software",
        keyword_info: {
          search_volume: 2_900,
          cpc: 7.25,
        },
        keyword_properties: {
          keyword_difficulty: 31,
        },
        search_intent_info: {
          main_intent: "commercial",
        },
      },
      first_domain_serp_element: {
        rank_group: 4,
        url: "https://competitor.example/approval-workflows",
      },
      second_domain_serp_element: null,
    },
  ],
): unknown {
  return {
    version: "0.1.20260824",
    status_code: 20_000,
    status_message: "Ok.",
    cost: 0.011,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: "fixture-task-id",
        status_code: 20_000,
        status_message: "Ok.",
        cost: 0.011,
        result_count: 1,
        result: [
          {
            se_type: "google",
            target1: "competitor.example",
            target2: "site.example",
            location_code: 2_840,
            language_code: "en",
            total_count: items.length,
            items_count: items.length,
            items,
          },
        ],
      },
    ],
  };
}

describe("HttpDataForSeoClient domain-intersection operation", () => {
  it("sends one exact competitor-to-site organic gap task and returns the strict nested projection", async () => {
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

    const result = await client.domainIntersection({
      ...REQUEST,
      target1: " https://WWW.Competitor.Example/a-provider-ignored-path ",
      target2: "SITE.EXAMPLE",
      password: "must-not-cross-the-boundary",
      authorization: "must-not-cross-the-boundary",
    } as DataForSeoDomainIntersectionRequest);

    expect(capturedUrl).toBe(DATAFORSEO_DOMAIN_INTERSECTION_LIVE_URL);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.redirect).toBe("error");
    expect(new Headers(capturedInit?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("fixture-login:fixture-password").toString("base64")}`,
    );
    expect(JSON.parse(String(capturedInit?.body))).toEqual([
      {
        target1: "competitor.example",
        target2: "site.example",
        location_code: 2_840,
        language_code: "en",
        intersections: false,
        item_types: ["organic"],
        include_clickstream_data: false,
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
        limit: 100,
        offset: 0,
      },
    ]);
    expect(result).toEqual({
      rows: [
        {
          keyword: "approval workflow software",
          searchVolume: 2_900,
          cpc: 7.25,
          keywordDifficulty: 31,
          providerIntent: "commercial",
          firstDomainRank: 4,
          secondDomainRank: null,
        },
      ],
      totalCount: 1,
      costUsd: 0.011,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /authorization|credential|password|login|status_message|url/i,
    );
    expect(String(capturedInit?.body)).not.toContain(
      "must-not-cross-the-boundary",
    );
  });

  it("preserves absent provider metrics and ranks as null", async () => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () =>
        jsonResponse(
          successEnvelope([
            {
              keyword_data: {
                keyword: "unknown volume keyword",
                keyword_info: { search_volume: null, cpc: null },
                keyword_properties: { keyword_difficulty: null },
                search_intent_info: { main_intent: null },
              },
              first_domain_serp_element: null,
              second_domain_serp_element: null,
            },
          ]),
        ),
    });

    await expect(client.domainIntersection(REQUEST)).resolves.toMatchObject({
      rows: [
        {
          searchVolume: null,
          cpc: null,
          keywordDifficulty: null,
          providerIntent: null,
          firstDomainRank: null,
          secondDomainRank: null,
        },
      ],
    });
  });

  it("accepts the documented successful empty shape without inventing rows", async () => {
    const fixture = successEnvelope([]) as {
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

    await expect(client.domainIntersection(REQUEST)).resolves.toEqual({
      rows: [],
      totalCount: 0,
      costUsd: 0.011,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
  });

  it("fails closed when non-empty rows omit total_count because total unknown cannot be inferred from returned rows", async () => {
    const fixture = successEnvelope() as {
      tasks: Array<{
        result: Array<{
          total_count?: number | null;
          items_count: number;
          items: unknown[];
        }>;
      }>;
    };
    // A truncated live result must surface as invalid rather than silently
    // inferring total coverage from the returned rows alone.
    fixture.tasks[0]!.result[0]!.total_count = null;
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () => jsonResponse(fixture),
    });

    await expect(client.domainIntersection(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(client.domainIntersection(REQUEST)).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it.each([
    ["keyword difficulty", { keyword_difficulty: 31.5 }, undefined, undefined],
    ["provider intent", undefined, { main_intent: "mixed" }, undefined],
    ["first-domain rank", undefined, undefined, { rank_group: 4.5 }],
    ["second-domain rank", undefined, undefined, { rank_group: 0 }],
  ])(
    "fails closed on malformed present %s",
    async (_label, keywordProperties, searchIntentInfo, serpElement) => {
      const item = {
        keyword_data: {
          keyword: "malformed provider row",
          keyword_info: { search_volume: 10, cpc: 1 },
          keyword_properties: keywordProperties ?? { keyword_difficulty: 10 },
          search_intent_info: searchIntentInfo ?? { main_intent: "commercial" },
        },
        first_domain_serp_element:
          _label === "first-domain rank"
            ? serpElement
            : { rank_group: 4 },
        second_domain_serp_element:
          _label === "second-domain rank" ? serpElement : null,
      };
      const client = new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl: async () => jsonResponse(successEnvelope([item])),
      });

      await expect(client.domainIntersection(REQUEST)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    },
  );

  it.each([
    ["empty target1", { ...REQUEST, target1: "" }],
    ["empty target2", { ...REQUEST, target2: "  " }],
    [
      "no location",
      { ...REQUEST, locationCode: undefined, locationName: undefined },
    ],
    ["two locations", { ...REQUEST, locationName: "United States" }],
    ["invalid language", { ...REQUEST, languageCode: "" }],
    ["zero limit", { ...REQUEST, limit: 0 }],
    ["fractional limit", { ...REQUEST, limit: 1.5 }],
    ["oversized limit", { ...REQUEST, limit: 1_001 }],
    ["non-boolean intersections", { ...REQUEST, intersections: "false" }],
  ])("rejects %s before provider I/O", async (_label, request) => {
    const fetchImpl = vi.fn(async () => jsonResponse(successEnvelope()));
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl,
    });

    await expect(
      client.domainIntersection(request as DataForSeoDomainIntersectionRequest),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider task and HTTP failures without leaking provider prose or credentials", async () => {
    const taskFailure = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () =>
        jsonResponse({
          status_code: 20_000,
          cost: 0,
          tasks: [
            {
              status_code: 40_103,
              status_message: "provider-secret-prose",
              cost: 0,
              result: null,
            },
          ],
        }),
    });
    const taskError = await taskFailure
      .domainIntersection(REQUEST)
      .catch((value: unknown) => value);
    expect(taskError).toBeInstanceOf(SourceError);
    expect(taskError).toMatchObject({ code: "UNAVAILABLE" });
    expect((taskError as Error).message).not.toMatch(
      /provider-secret-prose|fixture-password/,
    );

    const httpFailure = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () =>
        jsonResponse({ secret: "provider-secret-body" }, 401),
    });
    const httpError = await httpFailure
      .domainIntersection(REQUEST)
      .catch((value: unknown) => value);
    expect(httpError).toMatchObject({ code: "AUTH_REQUIRED" });
    expect((httpError as Error).message).not.toMatch(
      /provider-secret-body|fixture-password/,
    );
  });

  it("inherits the bounded-response and cancellation transport semantics", async () => {
    const capped = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      maxResponseBytes: 4,
      fetchImpl: async () => jsonResponse(successEnvelope()),
    });
    await expect(capped.domainIntersection(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: vi.fn(async (_url, init) => {
        if (init?.signal?.aborted) throw init.signal.reason;
        return jsonResponse(successEnvelope());
      }),
    });
    await expect(
      cancelled.domainIntersection(REQUEST, controller.signal),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
