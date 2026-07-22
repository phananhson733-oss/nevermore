import { describe, expect, it } from "vitest";
import type {
  CollectionContext,
  NormalizeContext,
} from "../adapter.ts";
import { SourceError } from "../adapter.ts";
import {
  createDataForSeoCollectionScope,
  createDataForSeoAdapter,
  dataForSeoParamsFromCollectionScope,
  dataForSeoSnapshotSummary,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_ROW_CAP_STOP_REASON,
  parseDataForSeoCollectionScope,
} from "./adapter.ts";
import type {
  DataForSeoClient,
  DataForSeoRankedKeywordsRequest,
  DataForSeoRankedKeywordsResponse,
} from "./client.ts";

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
  capturedAt: "2026-07-20T10:00:00.000Z",
};

function fixtureResponse(
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

class FixtureClient implements DataForSeoClient {
  readonly requests: DataForSeoRankedKeywordsRequest[] = [];

  constructor(
    private readonly response: DataForSeoRankedKeywordsResponse,
  ) {}

  rankedKeywords(
    request: DataForSeoRankedKeywordsRequest,
    _signal?: AbortSignal,
  ): Promise<DataForSeoRankedKeywordsResponse> {
    this.requests.push(request);
    return Promise.resolve(this.response);
  }
}

describe("DataForSEO ranked-keywords adapter", () => {
  it("fails closed when a collection scope omits its explicit market or language", () => {
    expect(() =>
      createDataForSeoCollectionScope({
        target: "example.com",
        marketCode: undefined,
        locationName: "United States",
        languageTag: "en",
        limit: 200,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      createDataForSeoCollectionScope({
        target: "example.com",
        marketCode: "US",
        locationName: "United States",
        languageTag: undefined,
        limit: 200,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("freezes one strict credential-free scope while preserving the full language tag", () => {
    const scope = createDataForSeoCollectionScope({
      target: "https://www.Example.COM/pricing",
      marketCode: "gb",
      locationName: "United Kingdom",
      languageTag: "en-gb",
      limit: 37,
    });

    expect(scope).toEqual({
      schemaVersion: "dataforseo.collection-scope.v1",
      queryKind: "ranked_keywords",
      target: "example.com",
      marketCode: "GB",
      languageTag: "en-GB",
      providerLanguageCode: "en",
      location: { kind: "name", name: "United Kingdom" },
      limit: 37,
    });
    expect(dataForSeoParamsFromCollectionScope(scope)).toEqual({
      target: "example.com",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageCode: "en",
      limit: 37,
    });
    expect(
      parseDataForSeoCollectionScope({
        ...scope,
        location: { name: "United Kingdom", kind: "name" },
      }),
    ).toEqual(scope);
    expect(JSON.stringify(scope)).not.toMatch(
      /authorization|credential|password|login|rawRequest/i,
    );
  });

  it("rejects a frozen scope that carries unknown or secret-bearing fields", () => {
    const scope = createDataForSeoCollectionScope({
      target: "example.com",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en",
      limit: 200,
    });

    expect(() =>
      parseDataForSeoCollectionScope({
        ...scope,
        password: "must-never-enter-a-manifest",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("keeps collection time separate from unknown provider timing and freshness", () => {
    const scope = createDataForSeoCollectionScope({
      target: "example.com",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en",
      limit: 200,
    });

    expect(
      dataForSeoSnapshotSummary(scope, "2026-07-22T08:09:10.000Z"),
    ).toEqual({
      collectionScope: scope,
      timing: {
        collectedAt: "2026-07-22T08:09:10.000Z",
        dataAsOf: null,
        observedAt: null,
        freshness: "unknown",
      },
    });
  });

  it("normalizes target and language while preserving the configured market/location", async () => {
    const adapter = createDataForSeoAdapter(
      new FixtureClient(fixtureResponse()),
    );

    const config = await adapter.validateConfig({
      target: "https://www.Example.COM/pricing?ref=ignored",
      marketCode: "gb",
      locationName: "United Kingdom",
      languageCode: "en-GB",
    });

    expect(config).toEqual({
      target: "example.com",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageCode: "en",
      limit: 200,
      usedUsLocationFallback: false,
    });
    await expect(adapter.capabilities(config)).resolves.toEqual([
      expect.objectContaining({
        datasetKey: "dataforseo.ranked_keywords.v1",
        operation: "keyword_gap_import",
        available: true,
      }),
    ]);
  });

  it("uses the documented US compatibility code only for an explicit US market", async () => {
    const adapter = createDataForSeoAdapter(
      new FixtureClient(fixtureResponse()),
    );
    const usConfig = await adapter.validateConfig({
      target: "example.com",
      marketCode: "US",
      languageCode: "en-US",
    });

    expect(usConfig).toMatchObject({
      locationCode: 2840,
      usedUsLocationFallback: true,
    });
    await expect(adapter.capabilities(usConfig)).resolves.toEqual([
      expect.objectContaining({
        limitation: expect.stringContaining("compatibility location code 2840"),
      }),
    ]);

    await expect(
      adapter.validateConfig({
        target: "example.de",
        marketCode: "DE",
        languageCode: "de-DE",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  });

  it("rejects ambiguous locations and out-of-range limits before provider I/O", async () => {
    const client = new FixtureClient(fixtureResponse());
    const adapter = createDataForSeoAdapter(client);

    await expect(
      adapter.collect(
        {
          target: "example.com",
          marketCode: "US",
          locationCode: 2840,
          locationName: "United States",
          languageCode: "en",
        },
        collectCtx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      adapter.collect(
        {
          target: "example.com",
          marketCode: "US",
          locationCode: 2840,
          languageCode: "en",
          limit: 1001,
        },
        collectCtx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(client.requests).toHaveLength(0);
  });

  it("marks a capped response partial, persists credential-free raw, and reports numeric usage", async () => {
    const client = new FixtureClient(fixtureResponse({ totalCount: 23 }));
    const adapter = createDataForSeoAdapter(client);

    const result = await adapter.collect(
      {
        target: "https://www.example.com/ignored",
        marketCode: "US",
        locationName: "United States",
        languageCode: "en-US",
        limit: 1,
        now: new Date("2026-07-20T09:30:00.000Z"),
      },
      collectCtx,
    );

    expect(client.requests).toEqual([
      {
        target: "example.com",
        locationName: "United States",
        languageCode: "en",
        limit: 1,
      },
    ]);
    expect(result).toMatchObject({
      availability: "partial",
      capturedAt: "2026-07-20T09:30:00.000Z",
      rowCount: 1,
      stopReason: DATAFORSEO_ROW_CAP_STOP_REASON,
      providerUsage: {
        apiCalls: 1,
        rowsReturned: 1,
        costUsd: 0.011,
      },
    });
    expect(result.limitation).toContain("first 1 of 23");
    expect(result.limitation).toContain("freshness is unknown");
    expect(result.limitation).not.toContain("weekly-updated");
    expect(result.raw).toMatchObject({
      schemaVersion: DATAFORSEO_METHOD_VERSION,
      request: {
        target: "example.com",
        marketCode: "US",
        locationName: "United States",
        languageCode: "en",
        limit: 1,
      },
    });
    expect(JSON.stringify(result.raw)).not.toMatch(/authorization|password|login/i);
  });

  it("normalizes vendor rows onto the existing keyword-gap projection with grade B", async () => {
    const adapter = createDataForSeoAdapter(
      new FixtureClient(fixtureResponse()),
    );
    const result = await adapter.collect(
      {
        target: "example.com",
        marketCode: "CA",
        locationName: "Canada",
        languageCode: "fr-CA",
        now: new Date("2026-07-20T09:30:00.000Z"),
      },
      collectCtx,
    );

    const observations = [];
    for await (const observation of adapter.normalize(
      result.raw,
      normalizeCtx,
    )) {
      observations.push(observation);
    }

    expect(observations).toEqual([
      expect.objectContaining({
        metricKey: "csv.keyword_gap.v1",
        subjectType: "keyword_cluster",
        subjectRef: "enterprise seo",
        observedAt: normalizeCtx.capturedAt,
        availability: "available",
        origin: "vendor_observation",
        grade: "B",
        valueJson: {
          keyword: "enterprise seo platform",
          clusterKey: "enterprise seo",
          searchVolume: 720,
          currentUrl: "https://example.com/platform",
          currentRank: 7,
          competitorDomain: null,
          competitorRank: null,
          marketCode: "CA",
          languageCode: "fr",
        },
      }),
    ]);
  });

  it("keeps a true empty result available and never invents zero-valued facts", async () => {
    const adapter = createDataForSeoAdapter(
      new FixtureClient(
        fixtureResponse({ rows: [], totalCount: 0, itemsCount: 0, costUsd: 0 }),
      ),
    );

    const result = await adapter.collect(
      {
        target: "example.com",
        marketCode: "US",
        locationCode: 2840,
        languageCode: "en",
      },
      collectCtx,
    );
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
      providerUsage: { apiCalls: 1, rowsReturned: 0, costUsd: 0 },
    });
    expect(result.limitation).toContain("observed empty result set");
    expect(observations).toEqual([]);
  });

  it("keeps the default adapter credential-bound at collection time", async () => {
    const { dataforseoAdapter } = await import("./adapter.ts");
    await expect(
      dataforseoAdapter.collect(
        {
          target: "example.com",
          marketCode: "US",
          locationCode: 2840,
          languageCode: "en",
        },
        collectCtx,
      ),
    ).rejects.toBeInstanceOf(SourceError);
    await expect(
      dataforseoAdapter.collect(
        {
          target: "example.com",
          marketCode: "US",
          locationCode: 2840,
          languageCode: "en",
        },
        collectCtx,
      ),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
