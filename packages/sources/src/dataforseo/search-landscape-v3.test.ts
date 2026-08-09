import { describe, expect, it, vi } from "vitest";
import {
  SourceError,
  type CollectionContext,
  type NormalizeContext,
} from "../adapter.ts";
import type {
  DataForSeoAiCitationRequest,
  DataForSeoAiCitationResponse,
  DataForSeoCompetitorsDomainRequest,
  DataForSeoCompetitorsDomainResponse,
  DataForSeoFetch,
  DataForSeoRankedKeywordsRequest,
  DataForSeoRankedKeywordsResponse,
  DataForSeoSearchLandscapeV3Client,
  DataForSeoSerpCompetitorsRequest,
  DataForSeoSerpCompetitorsResponse,
} from "./client.ts";
import {
  DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL,
  HttpDataForSeoClient,
} from "./client.ts";
import {
  createDataForSeoSearchLandscapeV3Adapter,
  createDataForSeoSearchLandscapeV3Scope,
  METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
  parseDataForSeoSearchLandscapeV3Scope,
} from "./search-landscape-v3.ts";

const collectionContext: CollectionContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  runId: "r",
};
const normalizeContext: NormalizeContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  capturedAt: "2026-08-09T06:00:00.000Z",
};

function generativeQueries(count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    entityId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    revision: index + 1,
    query: `Which platform is best for onboarding workflow ${index + 1}?`,
    normalizedQuery: `which platform is best for onboarding workflow ${index + 1}?`,
    marketCode: "US",
    languageTag: "en-US",
  }));
}

function ranked(
  overrides: Partial<DataForSeoRankedKeywordsResponse> = {},
): DataForSeoRankedKeywordsResponse {
  return {
    rows: [
      {
        keyword: "onboarding automation",
        searchVolume: 300,
        keywordDifficulty: null,
        providerSearchIntent: null,
        currentUrl: "https://example.com/features",
        currentRank: 8,
      },
    ],
    totalCount: 100,
    itemsCount: 1,
    costUsd: 0.01,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...overrides,
  };
}

function domains(): DataForSeoCompetitorsDomainResponse {
  return {
    rows: [
      {
        domain: "ahrefs.com",
        averagePosition: 9,
        summedPosition: 27,
        intersections: 17,
        organicEstimatedTrafficVolume: 800,
      },
    ],
    totalCount: 1,
    itemsCount: 1,
    costUsd: 0.02,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
  };
}

function aiResponse(index: number): DataForSeoAiCitationResponse {
  if (index >= 17) {
    return {
      availability: "unavailable",
      requestedModel: "gpt-5",
      resolvedModel: null,
      observedAt: null,
      sourceUrls: [],
      costUsd: 0,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
      limitation: "The provider returned no observable answer.",
    };
  }
  const cited = index < 8;
  return {
    availability: "available",
    requestedModel: "gpt-5",
    resolvedModel: "gpt-5-2026-08-01",
    observedAt: `2026-08-09T06:00:${String(index).padStart(2, "0")}.000Z`,
    sourceUrls: cited
      ? [
          `https://${index === 0 ? "docs." : ""}ahrefs.com/guide/${index}`,
          "https://notahrefs.com/ahrefs-mentioned-in-path",
        ]
      : index === 8
        ? ["https://notahrefs.com/ahrefs-mentioned-in-path"]
        : [],
    costUsd: 0.01,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    limitation: null,
  };
}

class FixtureClient implements DataForSeoSearchLandscapeV3Client {
  readonly aiRequests: DataForSeoAiCitationRequest[] = [];

  constructor(
    private readonly rankedResult = ranked(),
    private readonly domainResult = domains(),
    private readonly aiResult: (
      index: number,
    ) =>
      | DataForSeoAiCitationResponse
      | Promise<DataForSeoAiCitationResponse> = aiResponse,
  ) {}

  rankedKeywords(_request: DataForSeoRankedKeywordsRequest) {
    return Promise.resolve(this.rankedResult);
  }

  competitorsDomain(_request: DataForSeoCompetitorsDomainRequest) {
    return Promise.resolve(this.domainResult);
  }

  serpCompetitors(_request: DataForSeoSerpCompetitorsRequest) {
    return Promise.resolve({
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: 0,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    } satisfies DataForSeoSerpCompetitorsResponse);
  }

  aiCitation(request: DataForSeoAiCitationRequest) {
    this.aiRequests.push(request);
    return Promise.resolve(this.aiResult(this.aiRequests.length - 1));
  }
}

type SearchLandscapeV3Scope = ReturnType<
  typeof createDataForSeoSearchLandscapeV3Scope
>;
type EnabledSearchLandscapeV3Scope = Omit<
  SearchLandscapeV3Scope,
  "aiCitations"
> & {
  readonly aiCitations: Extract<
    SearchLandscapeV3Scope["aiCitations"],
    { readonly state: "enabled" }
  >;
};

function enabledScope(): EnabledSearchLandscapeV3Scope {
  const scope = createDataForSeoSearchLandscapeV3Scope({
    target: "example.com",
    marketCode: "US",
    languageTag: "en-US",
    locationCode: 2840,
    rankedKeywordsLimit: 200,
    competitorsDomainLimit: 100,
    serpCompetitorsLimit: 100,
    seeds: [],
    aiCitations: {
      state: "enabled",
      requestedModel: "gpt-5",
      queries: generativeQueries(),
      trackedCompetitorDomains: ["semrush.com"],
    },
  });
  if (scope.aiCitations.state !== "enabled") {
    throw new Error("fixture expected an enabled AI-citation scope");
  }
  return scope as EnabledSearchLandscapeV3Scope;
}

function aiSuccessEnvelope(
  annotations: readonly Record<string, unknown>[],
): unknown {
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
            model_name: "gpt-5-2026-08-01",
            datetime: "2026-08-09 06:00:00 +00:00",
            items: [
              {
                sections: [
                  {
                    text: "Provider answer text must not be persisted.",
                    annotations,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("DataForSEO search-landscape v3", () => {
  it("maps the fixed ChatGPT live request and retains only nested annotation URLs", async () => {
    const fetchImpl = vi.fn<DataForSeoFetch>(async () =>
      new Response(
        JSON.stringify(
          aiSuccessEnvelope([
            { type: "url_citation", url: "https://docs.ahrefs.com/a" },
            {
              title: "Official documented annotation shape",
              url: "https://semrush.com/b",
              start_index: 10,
              end_index: 20,
              text: "Semrush",
            },
            { type: "other", url: "https://ignored.example/a" },
          ]),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl,
    });

    await expect(
      client.aiCitation({
        userPrompt: "Which onboarding platform is best?",
        modelName: "gpt-5",
        maxOutputTokens: 1_024,
        webSearch: true,
        webSearchCountryIsoCode: "US",
      }),
    ).resolves.toMatchObject({
      availability: "available",
      requestedModel: "gpt-5",
      resolvedModel: "gpt-5-2026-08-01",
      observedAt: "2026-08-09T06:00:00.000Z",
      sourceUrls: ["https://docs.ahrefs.com/a", "https://semrush.com/b"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL);
    expect(JSON.parse(String(init?.body))).toEqual([
      {
        user_prompt: "Which onboarding platform is best?",
        model_name: "gpt-5",
        max_output_tokens: 1_024,
        web_search: true,
        web_search_country_iso_code: "US",
      },
    ]);
  });

  it.each([
    { title: "missing URL" },
    { title: "invalid URL", url: "not a URL" },
  ])("fails closed for a documented annotation with a missing or invalid URL", async (annotation) => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () =>
        new Response(JSON.stringify(aiSuccessEnvelope([annotation])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await expect(
      client.aiCitation({
        userPrompt: "Which onboarding platform is best?",
        modelName: "gpt-5",
        maxOutputTokens: 1_024,
        webSearch: true,
        webSearchCountryIsoCode: "US",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([15, 4_097])(
    "rejects max_output_tokens outside the documented 16 through 4096 range",
    async (maxOutputTokens) => {
      const fetchImpl = vi.fn<DataForSeoFetch>(async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const client = new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl,
      });

      await expect(
        client.aiCitation({
          userPrompt: "Which onboarding platform is best?",
          modelName: "gpt-5",
          maxOutputTokens,
          webSearch: true,
          webSearchCountryIsoCode: "US",
        }),
      ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("maps the provider no-answer status to unavailable rather than measured zero", async () => {
    const client = new HttpDataForSeoClient({
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            status_code: 20_000,
            cost: 0,
            tasks: [
              {
                status_code: 40_102,
                cost: 0,
                result_count: 0,
                result: null,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    await expect(
      client.aiCitation({
        userPrompt: "Which onboarding platform is best?",
        modelName: "gpt-5",
        maxOutputTokens: 1_024,
        webSearch: true,
        webSearchCountryIsoCode: "US",
      }),
    ).resolves.toEqual({
      availability: "unavailable",
      requestedModel: "gpt-5",
      resolvedModel: null,
      observedAt: null,
      sourceUrls: [],
      costUsd: 0,
      providerStatusCode: 20_000,
      taskStatusCode: 40_102,
      limitation: "The provider returned no observable answer.",
    });
  });

  it.each([40_202, 40_209])(
    "keeps provider limit status %s as a sanitized unavailable query outcome",
    async (taskStatusCode) => {
      const client = new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status_code: 20_000,
              cost: 0,
              tasks: [
                {
                  status_code: taskStatusCode,
                  result_count: 0,
                  result: null,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      });

      await expect(
        client.aiCitation({
          userPrompt: "Which onboarding platform is best?",
          modelName: "gpt-5",
          maxOutputTokens: 1_024,
          webSearch: true,
          webSearchCountryIsoCode: "US",
        }),
      ).resolves.toMatchObject({
        availability: "unavailable",
        requestedModel: "gpt-5",
        resolvedModel: null,
        observedAt: null,
        sourceUrls: [],
        providerStatusCode: 20_000,
        taskStatusCode,
        limitation: expect.stringMatching(/limit/iu),
      });
    },
  );

  it.each([
    [40_100, "AUTH_REQUIRED"],
    [40_005, "INVALID_CONFIGURATION"],
  ] as const)(
    "does not downgrade provider status %s to a query-level unavailable outcome",
    async (taskStatusCode, errorCode) => {
      const client = new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status_code: 20_000,
              cost: 0,
              tasks: [
                {
                  status_code: taskStatusCode,
                  result_count: 0,
                  result: null,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      });

      await expect(
        client.aiCitation({
          userPrompt: "Which onboarding platform is best?",
          modelName: "gpt-5",
          maxOutputTokens: 1_024,
          webSearch: true,
          webSearchCountryIsoCode: "US",
        }),
      ).rejects.toMatchObject({ code: errorCode });
    },
  );

  it("freezes exactly 20 canonical GenerativeQueries and rejects a smaller paid cohort", () => {
    const scope = enabledScope();
    expect(scope.aiCitations).toMatchObject({
      state: "enabled",
      platform: "chat_gpt",
      requestedModel: "gpt-5",
      attemptedQueries: 20,
      maxOutputTokens: 1_024,
      querySetHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(scope.aiCitations.queries).toHaveLength(20);
    expect(parseDataForSeoSearchLandscapeV3Scope(scope)).toEqual(scope);

    expect(() =>
      createDataForSeoSearchLandscapeV3Scope({
        target: "example.com",
        marketCode: "US",
        languageTag: "en-US",
        locationCode: 2840,
        aiCitations: {
          state: "enabled",
          requestedModel: "gpt-5",
          queries: generativeQueries(19),
          trackedCompetitorDomains: [],
        },
      }),
    ).toThrow(/exactly 20/iu);

    const overlong = generativeQueries();
    overlong[0] = {
      ...overlong[0]!,
      query: "x".repeat(501),
      normalizedQuery: "x".repeat(501),
    };
    expect(() =>
      createDataForSeoSearchLandscapeV3Scope({
        target: "example.com",
        marketCode: "US",
        languageTag: "en-US",
        locationCode: 2840,
        aiCitations: {
          state: "enabled",
          requestedModel: "gpt-5",
          queries: overlong,
          trackedCompetitorDomains: [],
        },
      }),
    ).toThrow(/500/iu);

    expect(() =>
      createDataForSeoSearchLandscapeV3Scope({
        target: "example.com",
        marketCode: "US",
        languageTag: "en-US",
        locationCode: 2840,
        aiCitations: {
          state: "enabled",
          requestedModel: "gpt-5",
          querySetHash: "0".repeat(64),
          queries: generativeQueries(),
          trackedCompetitorDomains: [],
        },
      }),
    ).toThrow(/querySetHash/iu);
  });

  it("retains the bounded 21-row overflow sentinel without making a paid AI call", async () => {
    const overflow = createDataForSeoSearchLandscapeV3Scope({
      target: "example.com",
      marketCode: "US",
      languageTag: "en-US",
      locationCode: 2840,
      aiCitations: {
        state: "skipped_insufficient_query_cohort",
        eligibleQueryCount: 21,
      },
    });
    expect(overflow.aiCitations).toEqual({
      state: "skipped_insufficient_query_cohort",
      eligibleQueryCount: 21,
      attemptedQueries: 0,
    });
    const client = new FixtureClient();
    await createDataForSeoSearchLandscapeV3Adapter(client).collect(
      overflow,
      collectionContext,
    );
    expect(client.aiRequests).toEqual([]);
    expect(() =>
      createDataForSeoSearchLandscapeV3Scope({
        target: "example.com",
        marketCode: "US",
        languageTag: "en-US",
        locationCode: 2840,
        aiCitations: {
          state: "skipped_insufficient_query_cohort",
          eligibleQueryCount: 20,
        },
      }),
    ).toThrow(/eligible/iu);
  });

  it("persists a canonical organic ratio from intersections over ranked total_count, never returned rows", async () => {
    const client = new FixtureClient();
    const adapter = createDataForSeoSearchLandscapeV3Adapter(client, {
      now: () => new Date("2026-08-09T06:01:00.000Z"),
    });
    const result = await adapter.collect(enabledScope(), collectionContext);
    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeContext,
    )) {
      observations.push(observation);
    }

    expect(
      observations.find(
        (observation) =>
          observation.metricKey === METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
      )?.valueJson,
    ).toMatchObject({
      competitorDomain: "ahrefs.com",
      intersections: 17,
      targetOrganicKeywordCount: 100,
      serpOverlap: 0.17,
    });
  });

  it("fails closed when a competitor intersection count exceeds the ranked-keyword denominator", async () => {
    const client = new FixtureClient(ranked(), {
      ...domains(),
      rows: [{ ...domains().rows[0]!, intersections: 101 }],
    });
    const adapter = createDataForSeoSearchLandscapeV3Adapter(client);
    const result = await adapter.collect(enabledScope(), collectionContext);

    await expect(async () => {
      for await (const _observation of adapter.normalize(
        result.raw,
        normalizeContext,
      )) {
        // Consume the generator so response validation executes.
      }
    }).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rounds repeating organic overlap ratios half-up to 12 decimal places", async () => {
    const client = new FixtureClient(
      ranked({ totalCount: 3 }),
      {
        ...domains(),
        rows: [{ ...domains().rows[0]!, intersections: 2 }],
      },
    );
    const adapter = createDataForSeoSearchLandscapeV3Adapter(client);
    const result = await adapter.collect(enabledScope(), collectionContext);
    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeContext,
    )) {
      observations.push(observation);
    }

    expect(
      observations.find(
        (observation) =>
          observation.metricKey === METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
      )?.valueJson,
    ).toMatchObject({ serpOverlap: 0.666666666667 });
  });

  it("counts only citation annotation hosts and retains honest partial fixed-cohort coverage", async () => {
    const client = new FixtureClient();
    const adapter = createDataForSeoSearchLandscapeV3Adapter(client, {
      now: () => new Date("2026-08-09T06:01:00.000Z"),
    });
    const result = await adapter.collect(enabledScope(), collectionContext);
    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeContext,
    )) {
      observations.push(observation);
    }
    const ai = observations.filter(
      (observation) =>
        observation.metricKey === METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
    );

    expect(client.aiRequests).toHaveLength(20);
    expect(client.aiRequests[0]).toMatchObject({
      modelName: "gpt-5",
      webSearch: true,
      webSearchCountryIsoCode: "US",
    });
    expect(result.availability).toBe("partial");
    expect(
      ai.find((observation) => observation.subjectRef === "ahrefs.com")
        ?.valueJson,
    ).toMatchObject({
      competitorDomain: "ahrefs.com",
      attemptedQueries: 20,
      observedQueries: 17,
      citedQueries: 8,
      unavailableQueries: 3,
      querySetHash: enabledScope().aiCitations.querySetHash,
      platform: "chat_gpt",
      model: "gpt-5",
      marketCode: "US",
      languageTag: "en-US",
    });
    expect(
      ai.find((observation) => observation.subjectRef === "semrush.com")
        ?.valueJson,
    ).toMatchObject({ citedQueries: 0, observedQueries: 17 });
  });

  it("runs the 20 paid AI queries with a fixed concurrency ceiling of one", async () => {
    let active = 0;
    let maximumActive = 0;
    const client = new FixtureClient(
      ranked(),
      domains(),
      async (index) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return aiResponse(index);
      },
    );

    await createDataForSeoSearchLandscapeV3Adapter(client).collect(
      enabledScope(),
      collectionContext,
    );

    expect(client.aiRequests).toHaveLength(20);
    expect(maximumActive).toBe(1);
  });

  it("stops the sequential cohort on authentication errors instead of hiding them", async () => {
    const client = new FixtureClient(ranked(), domains(), () => {
      throw new SourceError("AUTH_REQUIRED", "fixture");
    });

    await expect(
      createDataForSeoSearchLandscapeV3Adapter(client).collect(
        enabledScope(),
        collectionContext,
      ),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(client.aiRequests).toHaveLength(1);
  });

  it("keeps AI limit partiality inside AI evidence without downgrading organic coverage", async () => {
    const limited = (index: number): DataForSeoAiCitationResponse =>
      index < 2
        ? {
            availability: "unavailable",
            requestedModel: "gpt-5",
            resolvedModel: null,
            observedAt: null,
            sourceUrls: [],
            costUsd: 0,
            providerStatusCode: 20_000,
            taskStatusCode: index === 0 ? 40_202 : 40_209,
            limitation: "The provider rate limit made this query unavailable.",
          }
        : {
            ...aiResponse(0),
            sourceUrls: [],
          };
    const organicallyCompleteDomains: DataForSeoCompetitorsDomainResponse = {
      ...domains(),
      rows: [{ ...domains().rows[0]!, intersections: 1 }],
    };
    const client = new FixtureClient(
      ranked({ totalCount: 1 }),
      organicallyCompleteDomains,
      limited,
    );
    const adapter = createDataForSeoSearchLandscapeV3Adapter(client);

    const result = await adapter.collect(enabledScope(), collectionContext);
    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeContext,
    )) {
      observations.push(observation);
    }
    const organic = observations.find(
      (observation) =>
        observation.metricKey === METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
    );
    const ai = observations.find(
      (observation) =>
        observation.metricKey === METRIC_DATAFORSEO_COMPETITOR_AI_CITATION &&
        observation.subjectRef === "ahrefs.com",
    );

    expect(client.aiRequests).toHaveLength(20);
    expect(result.availability).toBe("available");
    expect(result.raw.availability).toBe("available");
    expect(result.limitation).not.toMatch(/18 of 20|AI citation/iu);
    expect(result.raw.limitation).toBe(result.limitation);
    expect(organic?.limitation).toBe(result.limitation);
    expect(ai?.valueJson).toMatchObject({
      attemptedQueries: 20,
      observedQueries: 18,
      unavailableQueries: 2,
      cohortCoverage: "partial",
    });
    expect(ai?.limitation).toMatch(/18 of 20/iu);
    expect(result.raw.aiCitations).toMatchObject({
      state: "collected",
      observedQueries: 18,
      unavailableQueries: 2,
    });
    if (result.raw.aiCitations.state !== "collected") {
      throw new Error("fixture expected collected AI evidence");
    }
    expect(result.raw.aiCitations.outcomes[0]?.response.taskStatusCode).toBe(
      40_202,
    );
    expect(result.raw.aiCitations.outcomes[1]?.response.taskStatusCode).toBe(
      40_209,
    );
  });

  it("makes no paid AI call when the frozen sub-capability is skipped", async () => {
    const client = new FixtureClient();
    const adapter = createDataForSeoSearchLandscapeV3Adapter(client);
    const scope = createDataForSeoSearchLandscapeV3Scope({
      target: "example.com",
      marketCode: "US",
      languageTag: "en-US",
      locationCode: 2840,
      aiCitations: {
        state: "skipped_insufficient_query_cohort",
        eligibleQueryCount: 12,
      },
    });

    const result = await adapter.collect(scope, collectionContext);

    expect(client.aiRequests).toEqual([]);
    expect(result.raw.aiCitations).toMatchObject({
      state: "skipped_insufficient_query_cohort",
      attemptedQueries: 0,
      observedQueries: 0,
    });
  });

  it("does not synthesize available zero citations when no query is observed", async () => {
    const unavailable = (index: number): DataForSeoAiCitationResponse => ({
      ...aiResponse(17 + index),
      taskStatusCode: 40_102,
    });
    const client = new FixtureClient(ranked(), domains(), unavailable);
    const adapter = createDataForSeoSearchLandscapeV3Adapter(client);
    const result = await adapter.collect(enabledScope(), collectionContext);
    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeContext,
    )) {
      observations.push(observation);
    }

    expect(result.availability).toBe("partial");
    expect(
      observations.filter(
        (observation) =>
          observation.metricKey === METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
      ),
    ).toEqual([]);
  });
});
