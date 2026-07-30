import { describe, expect, it } from "vitest";
import {
  SourceError,
  type CollectionContext,
  type NormalizeContext,
} from "../adapter.ts";
import type {
  DataForSeoCompetitorDomainRow,
  DataForSeoCompetitorsDomainRequest,
  DataForSeoCompetitorsDomainResponse,
  DataForSeoRankedKeywordRow,
  DataForSeoRankedKeywordsRequest,
  DataForSeoRankedKeywordsResponse,
  DataForSeoSearchLandscapeClient,
} from "./client.ts";
import {
  createDataForSeoSearchLandscapeAdapter,
  createDataForSeoSearchLandscapeScope,
  dataForSeoSearchLandscapeSnapshotSummary,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_STOP_REASON,
  parseDataForSeoSearchLandscapeScope,
  type DataForSeoSearchLandscapeScopeInput,
} from "./search-landscape.ts";

const collectCtx: CollectionContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  runId: "r",
};

const normalizeCtx: NormalizeContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  capturedAt: "2026-07-29T08:30:00.000Z",
};

function rankedResponse(
  overrides: Partial<DataForSeoRankedKeywordsResponse> = {},
): DataForSeoRankedKeywordsResponse {
  return {
    rows: [
      {
        keyword: "enterprise seo platform",
        searchVolume: 720,
        currentUrl: "https://example.com/platform",
        currentRank: 7,
      },
    ],
    totalCount: 1,
    itemsCount: 1,
    costUsd: 0.011,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...overrides,
  };
}

function competitorsResponse(
  overrides: Partial<DataForSeoCompetitorsDomainResponse> = {},
): DataForSeoCompetitorsDomainResponse {
  return {
    rows: [
      {
        domain: "rival.example",
        averagePosition: 10,
        summedPosition: 30,
        intersections: 3,
        organicEstimatedTrafficVolume: 900,
      },
    ],
    totalCount: 1,
    itemsCount: 1,
    costUsd: 0.02,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...overrides,
  };
}

class FixtureSearchLandscapeClient implements DataForSeoSearchLandscapeClient {
  readonly rankedRequests: DataForSeoRankedKeywordsRequest[] = [];
  readonly competitorRequests: DataForSeoCompetitorsDomainRequest[] = [];

  constructor(
    private readonly ranked:
      | DataForSeoRankedKeywordsResponse
      | (() => Promise<DataForSeoRankedKeywordsResponse>),
    private readonly competitors:
      | DataForSeoCompetitorsDomainResponse
      | (() => Promise<DataForSeoCompetitorsDomainResponse>),
  ) {}

  rankedKeywords(
    request: DataForSeoRankedKeywordsRequest,
    _signal?: AbortSignal,
  ): Promise<DataForSeoRankedKeywordsResponse> {
    this.rankedRequests.push(request);
    return typeof this.ranked === "function"
      ? this.ranked()
      : Promise.resolve(this.ranked);
  }

  competitorsDomain(
    request: DataForSeoCompetitorsDomainRequest,
    _signal?: AbortSignal,
  ): Promise<DataForSeoCompetitorsDomainResponse> {
    this.competitorRequests.push(request);
    return typeof this.competitors === "function"
      ? this.competitors()
      : Promise.resolve(this.competitors);
  }
}

function scope() {
  return createDataForSeoSearchLandscapeScope({
    target: "https://www.Example.COM/pricing",
    marketCode: "gb",
    locationName: "United Kingdom",
    languageTag: "en-gb",
    rankedKeywordsLimit: 37,
    competitorsDomainLimit: 19,
  });
}

describe("DataForSEO search-landscape scope", () => {
  it("builds credential-free Snapshot timing with unknown provider freshness", () => {
    const value = scope();
    expect(
      dataForSeoSearchLandscapeSnapshotSummary(
        value,
        "2026-07-29T08:00:00.000Z",
      ),
    ).toEqual({
      collectionScope: value,
      timing: {
        collectedAt: "2026-07-29T08:00:00.000Z",
        dataAsOf: null,
        observedAt: null,
        freshness: "unknown",
      },
    });
    expect(() =>
      dataForSeoSearchLandscapeSnapshotSummary(
        value,
        "2026-07-29T08:00:00+00:00",
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it("freezes the exact canonical policy for both live calls", () => {
    const value = scope();

    expect(value).toEqual({
      schemaVersion: "dataforseo.search-landscape-scope.v1",
      queryKind: "search_landscape",
      target: "example.com",
      marketCode: "GB",
      languageTag: "en-GB",
      providerLanguageCode: "en",
      location: { kind: "name", name: "United Kingdom" },
      rankedKeywords: {
        limit: 37,
        historicalSerpMode: "live",
        itemTypes: ["organic"],
        minimumSearchVolumeExclusive: 0,
        rankGroup: { minimum: 4, maximum: 20 },
        orderBy: [
          "keyword_data.keyword_info.search_volume,desc",
          "ranked_serp_element.serp_item.rank_group,asc",
        ],
      },
      competitorsDomain: {
        limit: 19,
        itemTypes: ["organic"],
        includeClickstreamData: false,
        minimumIntersectionsExclusive: 0,
        orderBy: [
          "intersections,desc",
          "competitor_metrics.organic.etv,desc",
          "domain,asc",
        ],
        offset: 0,
        maxRankGroup: 20,
        excludeTopDomains: true,
        excludeDomains: ["example.com"],
        ignoreSynonyms: false,
      },
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.rankedKeywords)).toBe(true);
    expect(Object.isFrozen(value.competitorsDomain.excludeDomains)).toBe(true);
    expect(parseDataForSeoSearchLandscapeScope(value)).toEqual(value);
    expect(JSON.stringify(value)).not.toMatch(
      /authorization|credential|password|login|rawRequest/i,
    );
  });

  it.each([
    ["top-level password", (value: object) => ({ ...value, password: "secret" })],
    [
      "nested authorization",
      (value: ReturnType<typeof scope>) => ({
        ...value,
        competitorsDomain: {
          ...value.competitorsDomain,
          authorization: "secret",
        },
      }),
    ],
    [
      "changed self exclusion",
      (value: ReturnType<typeof scope>) => ({
        ...value,
        competitorsDomain: {
          ...value.competitorsDomain,
          excludeDomains: ["someone-else.example"],
        },
      }),
    ],
    [
      "changed provider order",
      (value: ReturnType<typeof scope>) => ({
        ...value,
        competitorsDomain: {
          ...value.competitorsDomain,
          orderBy: [...value.competitorsDomain.orderBy].reverse(),
        },
      }),
    ],
    [
      "non-canonical location",
      (value: ReturnType<typeof scope>) => ({
        ...value,
        location: { kind: "name", name: " United Kingdom " },
      }),
    ],
  ])("rejects %s in a previously frozen scope", (_label, mutate) => {
    expect(() => parseDataForSeoSearchLandscapeScope(mutate(scope()))).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("rejects missing market/language and independent out-of-range caps", () => {
    expect(() =>
      createDataForSeoSearchLandscapeScope({
        target: "example.com",
        marketCode: undefined,
        locationName: "United States",
        languageTag: "en",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      createDataForSeoSearchLandscapeScope({
        target: "example.com",
        marketCode: "US",
        locationName: "United States",
        languageTag: undefined,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      createDataForSeoSearchLandscapeScope({
        target: "example.com",
        marketCode: "US",
        locationName: "United States",
        languageTag: "en",
        rankedKeywordsLimit: 1_001,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      createDataForSeoSearchLandscapeScope({
        target: "example.com",
        marketCode: "US",
        locationName: "United States",
        languageTag: "en",
        competitorsDomainLimit: 1_001,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      createDataForSeoSearchLandscapeScope({
        target: "example.com",
        marketCode: "US",
        locationName: "United States",
        languageTag: "en",
        password: "must-not-enter-the-scope",
      } as DataForSeoSearchLandscapeScopeInput),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });
});

describe("DataForSEO search-landscape adapter", () => {
  it("advertises the exact composite identity and weekly freshness limitation", async () => {
    const adapter = createDataForSeoSearchLandscapeAdapter(
      new FixtureSearchLandscapeClient(
        rankedResponse(),
        competitorsResponse(),
      ),
    );
    const value = scope();

    await expect(adapter.validateConfig(value)).resolves.toEqual(value);
    await expect(adapter.capabilities(value)).resolves.toEqual([
      {
        datasetKey: "dataforseo.search_landscape.v1",
        operation: "search_landscape",
        available: true,
        limitation: expect.stringContaining("updated weekly"),
      },
    ]);
  });

  it("calls both narrow client operations with one scope and fails the whole collection", async () => {
    const expectedFailure = new SourceError(
      "RATE_LIMITED",
      "stable fixture failure",
    );
    const client = new FixtureSearchLandscapeClient(
      rankedResponse(),
      () => Promise.reject(expectedFailure),
    );
    const adapter = createDataForSeoSearchLandscapeAdapter(client, {
      now: () => new Date("2026-07-29T08:00:00.000Z"),
    });

    await expect(adapter.collect(scope(), collectCtx)).rejects.toBe(
      expectedFailure,
    );
    expect(client.rankedRequests).toHaveLength(1);
    expect(client.competitorRequests).toHaveLength(1);
  });

  it("fails closed when either endpoint returns more rows than its frozen cap", async () => {
    const client = new FixtureSearchLandscapeClient(
      rankedResponse({
        rows: [
          {
            keyword: "first keyword",
            searchVolume: 10,
            currentUrl: null,
            currentRank: 5,
          },
          {
            keyword: "second keyword",
            searchVolume: 20,
            currentUrl: null,
            currentRank: 6,
          },
        ],
        totalCount: 2,
        itemsCount: 2,
      }),
      competitorsResponse(),
    );
    const adapter = createDataForSeoSearchLandscapeAdapter(client);
    const cappedScope = createDataForSeoSearchLandscapeScope({
      target: "example.com",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en",
      rankedKeywordsLimit: 1,
      competitorsDomainLimit: 1,
    });

    await expect(
      adapter.collect(cappedScope, collectCtx),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("excludes the target locally, deterministically de-dupes canonical domains, and orders retained rows", async () => {
    const rows: Array<DataForSeoCompetitorDomainRow & Record<string, unknown>> = [
      {
        domain: "https://WWW.EXAMPLE.COM/pricing",
        averagePosition: 1,
        summedPosition: 1,
        intersections: 100,
        organicEstimatedTrafficVolume: 99_999,
        password: "smuggled-self-secret",
      },
      {
        domain: "beta.example",
        averagePosition: 5,
        summedPosition: 25,
        intersections: 5,
        organicEstimatedTrafficVolume: 500,
        authorization: "smuggled-row-secret",
      },
      {
        domain: "https://WWW.Alpha.Example/products",
        averagePosition: 12,
        summedPosition: 72,
        intersections: 6,
        organicEstimatedTrafficVolume: 900,
        login: "smuggled-row-secret",
      },
      {
        domain: "alpha.example",
        averagePosition: 10,
        summedPosition: 60,
        intersections: 6,
        organicEstimatedTrafficVolume: 900,
        credential: "smuggled-row-secret",
      },
      {
        domain: "gamma.example",
        averagePosition: 4,
        summedPosition: 24,
        intersections: 6,
        organicEstimatedTrafficVolume: 900,
      },
    ];
    const rankedRows: Array<
      DataForSeoRankedKeywordRow & Record<string, unknown>
    > = [
      {
        keyword: "enterprise seo platform",
        searchVolume: 720,
        currentUrl: "https://example.com/platform",
        currentRank: 7,
        password: "smuggled-ranked-secret",
      },
    ];
    const client = new FixtureSearchLandscapeClient(
      rankedResponse({ rows: rankedRows, totalCount: 10, itemsCount: 1 }),
      competitorsResponse({
        rows,
        totalCount: 8,
        itemsCount: 5,
        costUsd: 0.025,
      }),
    );
    const adapter = createDataForSeoSearchLandscapeAdapter(client, {
      now: () => new Date("2026-07-29T08:00:00.000Z"),
    });

    const result = await adapter.collect(scope(), collectCtx);
    const reversedClient = new FixtureSearchLandscapeClient(
      rankedResponse({ rows: rankedRows, totalCount: 10, itemsCount: 1 }),
      competitorsResponse({
        rows: [...rows].reverse(),
        totalCount: 8,
        itemsCount: 5,
        costUsd: 0.025,
      }),
    );
    const reversedResult = await createDataForSeoSearchLandscapeAdapter(
      reversedClient,
      {
        now: () => new Date("2026-07-29T08:00:00.000Z"),
      },
    ).collect(scope(), collectCtx);

    expect(client.rankedRequests).toEqual([
      {
        target: "example.com",
        locationName: "United Kingdom",
        languageCode: "en",
        limit: 37,
      },
    ]);
    expect(client.competitorRequests).toEqual([
      {
        target: "example.com",
        locationName: "United Kingdom",
        languageCode: "en",
        limit: 19,
      },
    ]);
    expect(result).toMatchObject({
      availability: "partial",
      capturedAt: "2026-07-29T08:00:00.000Z",
      rowCount: 4,
      stopReason: DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_STOP_REASON,
      providerUsage: {
        apiCalls: 2,
        rowsReturned: 6,
        rowsRetained: 4,
        costUsd: 0.036,
      },
    });
    expect(result.raw.schemaVersion).toBe(
      DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
    );
    expect(result.raw.competitorsDomain).toMatchObject({
      providerRowsCount: 5,
      retainedRowsCount: 3,
      excludedSelfCount: 1,
      duplicateRowsRemovedCount: 1,
      totalCount: 8,
      itemsCount: 5,
    });
    expect(result.raw.competitorsDomain.rows).toEqual([
      {
        domain: "alpha.example",
        averagePosition: 10,
        summedPosition: 60,
        intersections: 6,
        organicEstimatedTrafficVolume: 900,
      },
      {
        domain: "gamma.example",
        averagePosition: 4,
        summedPosition: 24,
        intersections: 6,
        organicEstimatedTrafficVolume: 900,
      },
      {
        domain: "beta.example",
        averagePosition: 5,
        summedPosition: 25,
        intersections: 5,
        organicEstimatedTrafficVolume: 500,
      },
    ]);
    expect(reversedResult.raw.competitorsDomain.rows).toEqual(
      result.raw.competitorsDomain.rows,
    );
    expect(result.limitation).toContain("updated weekly");
    expect(result.limitation).toContain("not a similarity percentage");
    expect(result.limitation).toContain("first 1 of 10");
    expect(result.limitation).toContain("first 5 of 8");
    expect(JSON.stringify(result.raw)).not.toMatch(
      /authorization|credential|password|login/i,
    );
  });

  it("emits legacy ranked observations plus factual competitor-domain observations only", async () => {
    const client = new FixtureSearchLandscapeClient(
      rankedResponse(),
      competitorsResponse(),
    );
    const adapter = createDataForSeoSearchLandscapeAdapter(client, {
      now: () => new Date("2026-07-29T08:00:00.000Z"),
    });
    const result = await adapter.collect(scope(), collectCtx);
    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeCtx,
    )) {
      observations.push(observation);
    }

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      metricKey: "csv.keyword_gap.v1",
      subjectType: "keyword_cluster",
      subjectRef: "enterprise seo",
      origin: "vendor_observation",
      grade: "B",
      support: "supports",
      valueJson: {
        keyword: "enterprise seo platform",
        clusterKey: "enterprise seo",
        searchVolume: 720,
        currentUrl: "https://example.com/platform",
        currentRank: 7,
        competitorDomain: null,
        competitorRank: null,
        marketCode: "GB",
        languageCode: "en",
      },
    });
    expect(observations[1]).toEqual({
      metricKey: "dataforseo.competitor_domain.v1",
      subjectType: "site",
      subjectRef: "rival.example",
      observedAt: normalizeCtx.capturedAt,
      availability: "available",
      valueNumeric: null,
      valueText: null,
      valueJson: {
        targetDomain: "example.com",
        competitorDomain: "rival.example",
        intersections: 3,
        averagePosition: 10,
        summedPosition: 30,
        organicEstimatedTrafficVolume: 900,
        marketCode: "GB",
        languageCode: "en",
      },
      unit: null,
      origin: "vendor_observation",
      grade: "B",
      support: "supports",
      limitation: result.limitation,
    });
    const serialized = JSON.stringify(observations[1]?.valueJson);
    expect(serialized).not.toMatch(
      /name|relationship|similarity|similarityPercent|percent/i,
    );
  });

  it("keeps two honest empty results available without fabricated observations", async () => {
    const client = new FixtureSearchLandscapeClient(
      rankedResponse({
        rows: [],
        totalCount: 0,
        itemsCount: 0,
        costUsd: 0,
      }),
      competitorsResponse({
        rows: [],
        totalCount: 0,
        itemsCount: 0,
        costUsd: 0,
      }),
    );
    const adapter = createDataForSeoSearchLandscapeAdapter(client);

    const result = await adapter.collect(scope(), collectCtx);
    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeCtx,
    )) {
      observations.push(observation);
    }

    expect(result).toMatchObject({
      availability: "available",
      rowCount: 0,
      stopReason: null,
      providerUsage: {
        apiCalls: 2,
        rowsReturned: 0,
        rowsRetained: 0,
        costUsd: 0,
      },
    });
    expect(result.limitation).toContain("observed empty result sets");
    expect(observations).toEqual([]);
  });
});
