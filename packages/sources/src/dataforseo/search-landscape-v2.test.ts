import { describe, expect, it } from "vitest";
import { SourceError, type CollectionContext, type NormalizeContext } from "../adapter.ts";
import type {
  DataForSeoCompetitorsDomainRequest,
  DataForSeoCompetitorsDomainResponse,
  DataForSeoRankedKeywordsRequest,
  DataForSeoRankedKeywordsResponse,
  DataForSeoSearchLandscapeV2Client,
  DataForSeoSerpCompetitorsRequest,
  DataForSeoSerpCompetitorsResponse,
} from "./client.ts";
import {
  createDataForSeoSearchLandscapeV2Adapter,
  createDataForSeoSearchLandscapeV2Scope,
  dataForSeoSearchLandscapeV2SnapshotSummary,
  METRIC_DATAFORSEO_SERP_COMPETITOR,
  parseDataForSeoSearchLandscapeV2Scope,
} from "./search-landscape-v2.ts";

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
  capturedAt: "2026-08-03T01:00:00.000Z",
};

function ranked(
  overrides: Partial<DataForSeoRankedKeywordsResponse> = {},
): DataForSeoRankedKeywordsResponse {
  return {
    rows: [
      {
        keyword: "seo automation",
        searchVolume: 300,
        keywordDifficulty: null,
        providerSearchIntent: null,
        currentUrl: "https://example.com/features",
        currentRank: 88,
      },
    ],
    totalCount: 1,
    itemsCount: 1,
    costUsd: 0.01,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...overrides,
  };
}

function domains(
  overrides: Partial<DataForSeoCompetitorsDomainResponse> = {},
): DataForSeoCompetitorsDomainResponse {
  return {
    rows: [
      {
        domain: "ahrefs.com",
        averagePosition: 9,
        summedPosition: 27,
        intersections: 3,
        organicEstimatedTrafficVolume: 800,
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

function serp(
  overrides: Partial<DataForSeoSerpCompetitorsResponse> = {},
): DataForSeoSerpCompetitorsResponse {
  return {
    rows: [
      {
        domain: "semrush.com",
        averagePosition: 3.5,
        medianPosition: 3,
        rating: 880,
        organicEstimatedTrafficVolume: 1200,
        keywordsCount: 2,
        visibility: 0.42,
        relevantSerpItems: 2,
      },
    ],
    totalCount: 1,
    itemsCount: 1,
    costUsd: 0.03,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...overrides,
  };
}

class FixtureClient implements DataForSeoSearchLandscapeV2Client {
  readonly rankedRequests: DataForSeoRankedKeywordsRequest[] = [];
  readonly domainRequests: DataForSeoCompetitorsDomainRequest[] = [];
  readonly serpRequests: DataForSeoSerpCompetitorsRequest[] = [];

  constructor(
    private readonly rankedResult: DataForSeoRankedKeywordsResponse = ranked(),
    private readonly domainResult: DataForSeoCompetitorsDomainResponse = domains(),
    private readonly serpResult:
      | DataForSeoSerpCompetitorsResponse
      | Error = serp(),
  ) {}

  rankedKeywords(request: DataForSeoRankedKeywordsRequest) {
    this.rankedRequests.push(request);
    return Promise.resolve(this.rankedResult);
  }

  competitorsDomain(request: DataForSeoCompetitorsDomainRequest) {
    this.domainRequests.push(request);
    return Promise.resolve(this.domainResult);
  }

  serpCompetitors(request: DataForSeoSerpCompetitorsRequest) {
    this.serpRequests.push(request);
    return this.serpResult instanceof Error
      ? Promise.reject(this.serpResult)
      : Promise.resolve(this.serpResult);
  }
}

function scope(seeds: readonly object[] = [
  {
    keyword: "seo automation",
    sourceKind: "gsc_top_query",
    sourceRef: "observation:00000000-0000-4000-8000-000000000001",
  },
  {
    keyword: "GEO analytics",
    sourceKind: "product_profile",
    sourceRef: "profile:00000000-0000-4000-8000-000000000002",
  },
]) {
  return createDataForSeoSearchLandscapeV2Scope({
    target: "https://www.example.com/pricing",
    marketCode: "us",
    languageTag: "en-US",
    locationCode: 2840,
    rankedKeywordsLimit: 200,
    competitorsDomainLimit: 100,
    serpCompetitorsLimit: 100,
    seeds,
  });
}

describe("DataForSEO search-landscape v2", () => {
  it("freezes positions 1-100 and honest de-duplicated seed provenance", () => {
    const value = scope([
      {
        keyword: " SEO automation ",
        sourceKind: "gsc_top_query",
        sourceRef: "observation:one",
      },
      {
        keyword: "seo automation",
        sourceKind: "crawler_page_text",
        sourceRef: "observation:two",
      },
    ]);

    expect(value).toMatchObject({
      schemaVersion: "dataforseo.search-landscape-scope.v2",
      rankedKeywords: { rankGroup: { minimum: 1, maximum: 100 } },
      competitorsDomain: { maxRankGroup: 100 },
      serpCompetitors: {
        fallbackWhenDomainOverlapEmpty: true,
        maximumSeeds: 200,
        seeds: [
          {
            keyword: "SEO automation",
            sourceKind: "gsc_top_query",
            sourceRef: "observation:one",
          },
        ],
      },
    });
    expect(parseDataForSeoSearchLandscapeV2Scope(value)).toEqual(value);
    expect(
      parseDataForSeoSearchLandscapeV2Scope({
        serpCompetitors: value.serpCompetitors,
        competitorsDomain: value.competitorsDomain,
        rankedKeywords: value.rankedKeywords,
        location: value.location,
        providerLanguageCode: value.providerLanguageCode,
        languageTag: value.languageTag,
        marketCode: value.marketCode,
        target: value.target,
        queryKind: value.queryKind,
        schemaVersion: value.schemaVersion,
      }),
    ).toEqual(value);
    expect(
      dataForSeoSearchLandscapeV2SnapshotSummary(
        value,
        "2026-08-03T01:00:00.000Z",
      ).collectionScope,
    ).toEqual(value);
  });

  it("uses only two paid calls when domain overlap has retained competitors", async () => {
    const client = new FixtureClient();
    const adapter = createDataForSeoSearchLandscapeV2Adapter(client, {
      now: () => new Date("2026-08-03T01:00:00.000Z"),
    });

    const result = await adapter.collect(scope(), collectionContext);

    expect(client.rankedRequests[0]).toMatchObject({
      minimumRankGroup: 1,
      maximumRankGroup: 100,
    });
    expect(client.domainRequests[0]).toMatchObject({ maximumRankGroup: 100 });
    expect(client.serpRequests).toEqual([]);
    expect(result.providerUsage).toMatchObject({
      apiCalls: 2,
      rowsReturned: 2,
      rowsRetained: 2,
      costUsd: 0.03,
    });
    expect(result.raw.serpCompetitors.status).toBe("not_needed");
  });

  it("calls SERP Competitors once when domain overlap is empty and records a distinct metric", async () => {
    const client = new FixtureClient(
      ranked(),
      domains({ rows: [], totalCount: 0, itemsCount: 0 }),
      serp(),
    );
    const adapter = createDataForSeoSearchLandscapeV2Adapter(client, {
      now: () => new Date("2026-08-03T01:00:00.000Z"),
    });

    const result = await adapter.collect(scope(), collectionContext);
    expect(client.serpRequests).toEqual([
      expect.objectContaining({
        keywords: ["seo automation", "GEO analytics"],
        limit: 100,
      }),
    ]);
    expect(result.providerUsage).toMatchObject({
      apiCalls: 3,
      rowsReturned: 2,
      rowsRetained: 2,
      costUsd: 0.06,
    });
    expect(result.raw.serpCompetitors.status).toBe("collected");
    const observations = [];
    for await (const observation of adapter.normalize(result.raw, normalizeContext)) {
      observations.push(observation);
    }
    expect(observations.map((observation) => observation.metricKey)).toContain(
      METRIC_DATAFORSEO_SERP_COMPETITOR,
    );
    expect(
      observations.find(
        (observation) => observation.metricKey === METRIC_DATAFORSEO_SERP_COMPETITOR,
      )?.valueJson,
    ).toMatchObject({
      targetDomain: "example.com",
      competitorDomain: "semrush.com",
      seedCount: 2,
    });
  });

  it("retains ranked-keyword difficulty and provider intent through the v2 wrapper", async () => {
    const client = new FixtureClient(
      ranked({
        rows: [
          {
            keyword: "seo automation",
            searchVolume: 300,
            keywordDifficulty: 64,
            providerSearchIntent: "commercial",
            currentUrl: "https://example.com/features",
            currentRank: 88,
          },
        ],
      }),
      domains(),
    );
    const adapter = createDataForSeoSearchLandscapeV2Adapter(client, {
      now: () => new Date("2026-08-03T01:00:00.000Z"),
    });

    const result = await adapter.collect(scope(), collectionContext);
    expect(result.raw.rankedKeywords.rows).toEqual([
      expect.objectContaining({
        keywordDifficulty: 64,
        providerSearchIntent: "commercial",
      }),
    ]);

    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeContext,
    )) {
      observations.push(observation);
    }
    expect(
      observations.find(
        (observation) => observation.metricKey === "csv.keyword_gap.v1",
      )?.valueJson,
    ).toMatchObject({
      keywordDifficulty: 64,
      providerSearchIntent: "commercial",
    });
  });

  it("normalizes missing ranked-keyword metrics through the v2 wrapper", async () => {
    const client = new FixtureClient(
      ranked({
        rows: [
          {
            keyword: "seo automation",
            searchVolume: 300,
            currentUrl: "https://example.com/features",
            currentRank: 88,
          } as unknown as DataForSeoRankedKeywordsResponse["rows"][number],
        ],
      }),
      domains(),
    );
    const adapter = createDataForSeoSearchLandscapeV2Adapter(client);

    const result = await adapter.collect(scope(), collectionContext);

    expect(result.raw.rankedKeywords.rows).toEqual([
      expect.objectContaining({
        keywordDifficulty: null,
        providerSearchIntent: null,
      }),
    ]);
  });

  it("does not spend on fallback when no eligible seed is frozen", async () => {
    const client = new FixtureClient(
      ranked(),
      domains({ rows: [], totalCount: 0, itemsCount: 0 }),
    );
    const adapter = createDataForSeoSearchLandscapeV2Adapter(client);

    const result = await adapter.collect(scope([]), collectionContext);

    expect(client.serpRequests).toEqual([]);
    expect(result.providerUsage.apiCalls).toBe(2);
    expect(result.raw.serpCompetitors.status).toBe("skipped_no_seeds");
  });

  it("fails atomically when the required fallback provider call fails", async () => {
    const client = new FixtureClient(
      ranked(),
      domains({ rows: [], totalCount: 0, itemsCount: 0 }),
      new SourceError("RATE_LIMITED", "fixture"),
    );
    const adapter = createDataForSeoSearchLandscapeV2Adapter(client);

    await expect(adapter.collect(scope(), collectionContext)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(client.serpRequests).toHaveLength(1);
  });
});
