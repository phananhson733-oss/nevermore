import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  contentHash,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
} from "@sf/db";
import {
  createDataForSeoCollectionScope,
  createDataForSeoSearchLandscapeScope,
  createDataForSeoSearchLandscapeV2Scope,
} from "@sf/sources";
import {
  collectionSnapshotIdentity,
  resolveFrozenDataForSeoCollectionScope,
  resolveFrozenDataForSeoSearchLandscapeScope,
  resolveFrozenDataForSeoSearchLandscapeV2Scope,
  runCollection,
  type CollectionWorkerContext,
} from "./run-collection.ts";

const mocks = vi.hoisted(() => ({
  persistCollectionResult: vi.fn(),
}));

vi.mock("./persist.ts", () => ({
  persistCollectionResult: mocks.persistCollectionResult,
}));

afterEach(() => {
  vi.restoreAllMocks();
  mocks.persistCollectionResult.mockReset();
});

describe("DataForSEO worker gates", () => {
  it("recognizes the legacy ranked, v1 composite, and v2 composite identities", () => {
    expect(
      collectionSnapshotIdentity({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        method_version: "dataforseo.ranked_keywords.v1",
      }),
    ).toEqual({
      datasetKey: "dataforseo.ranked_keywords.v1",
      schemaVersion: "dataforseo.ranked_keywords.v1",
    });
    expect(
      collectionSnapshotIdentity({
        provider: "dataforseo",
        operation: "search_landscape",
        method_version: "dataforseo.search_landscape.v1",
      }),
    ).toEqual({
      datasetKey: "dataforseo.search_landscape.v1",
      schemaVersion: "dataforseo.search_landscape.v1",
    });
    expect(
      collectionSnapshotIdentity({
        provider: "dataforseo",
        operation: "search_landscape",
        method_version: "dataforseo.search_landscape.v2",
      }),
    ).toEqual({
      datasetKey: "dataforseo.search_landscape.v2",
      schemaVersion: "dataforseo.search_landscape.v2",
    });
    expect(() =>
      collectionSnapshotIdentity({
        provider: "dataforseo",
        operation: "search_landscape",
        method_version: "dataforseo.ranked_keywords.v1",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      collectionSnapshotIdentity({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        method_version: "dataforseo.search_landscape.v1",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("validates the exact v2 seed scope and both base/fallback caps", () => {
    const collectionScope = createDataForSeoSearchLandscapeV2Scope({
      target: "accepted.example",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageTag: "en-GB",
      rankedKeywordsLimit: 37,
      competitorsDomainLimit: 19,
      serpCompetitorsLimit: 17,
      seeds: [
        {
          keyword: "seo automation",
          sourceKind: "gsc_top_query",
          sourceRef: "observation:one",
        },
      ],
    });
    const run = {
      provider: "dataforseo",
      operation: "search_landscape",
      method_version: "dataforseo.search_landscape.v2",
      site_id: "00000000-0000-4000-8000-000000000005",
      source_connection_id: "00000000-0000-4000-8000-000000000006",
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "search_landscape",
        siteId: "00000000-0000-4000-8000-000000000005",
        collectionScope: collectionScope as never,
      }),
    };
    const requestPayload = {
      provider: "dataforseo",
      operation: "search_landscape",
      sourceConnectionId: run.source_connection_id,
      collectionScope,
    };

    expect(
      resolveFrozenDataForSeoSearchLandscapeV2Scope(
        run as never,
        requestPayload,
        100,
        50,
      ),
    ).toEqual(collectionScope);
    expect(() =>
      resolveFrozenDataForSeoSearchLandscapeV2Scope(
        run as never,
        requestPayload,
        36,
        50,
      ),
    ).toThrow(/worker caps/i);
    expect(() =>
      resolveFrozenDataForSeoSearchLandscapeV2Scope(
        run as never,
        requestPayload,
        100,
        16,
      ),
    ).toThrow(/worker caps/i);
  });

  it("validates the exact composite scope, hash, and both worker caps", () => {
    const collectionScope = createDataForSeoSearchLandscapeScope({
      target: "accepted.example",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageTag: "en-GB",
      rankedKeywordsLimit: 37,
      competitorsDomainLimit: 19,
    });
    const run = {
      provider: "dataforseo",
      operation: "search_landscape",
      method_version: "dataforseo.search_landscape.v1",
      site_id: "00000000-0000-4000-8000-000000000005",
      source_connection_id: "00000000-0000-4000-8000-000000000006",
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "search_landscape",
        siteId: "00000000-0000-4000-8000-000000000005",
        collectionScope,
      }),
    };
    const requestPayload = {
      provider: "dataforseo",
      operation: "search_landscape",
      sourceConnectionId: "00000000-0000-4000-8000-000000000006",
      collectionScope,
    };

    expect(
      resolveFrozenDataForSeoSearchLandscapeScope(
        run as never,
        requestPayload,
        100,
        50,
      ),
    ).toEqual(collectionScope);
    expect(() =>
      resolveFrozenDataForSeoSearchLandscapeScope(
        run as never,
        requestPayload,
        36,
        50,
      ),
    ).toThrow(/worker caps/i);
    expect(() =>
      resolveFrozenDataForSeoSearchLandscapeScope(
        run as never,
        requestPayload,
        100,
        18,
      ),
    ).toThrow(/worker caps/i);
    expect(() =>
      resolveFrozenDataForSeoSearchLandscapeScope(
        { ...run, method_version: "dataforseo.ranked_keywords.v1" } as never,
        requestPayload,
        100,
        50,
      ),
    ).toThrow(/identity/i);
  });

  it("uses only the canonical command-time scope and never rebuilds it from mutable Site state", () => {
    const collectionScope = createDataForSeoCollectionScope({
      target: "accepted.example",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageTag: "en-GB",
      limit: 37,
    });
    const run = {
      provider: "dataforseo",
      operation: "keyword_gap_import",
      method_version: "dataforseo.ranked_keywords.v1",
      site_id: "00000000-0000-4000-8000-000000000005",
      source_connection_id: "00000000-0000-4000-8000-000000000006",
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        siteId: "00000000-0000-4000-8000-000000000005",
        collectionScope,
      }),
    };

    expect(
      resolveFrozenDataForSeoCollectionScope(
        run as never,
        {
          provider: "dataforseo",
          operation: "keyword_gap_import",
          sourceConnectionId:
            "00000000-0000-4000-8000-000000000006",
          collectionScope,
        },
        200,
      ),
    ).toEqual(collectionScope);
  });

  it("fails closed instead of reconstructing a missing or tampered frozen scope", () => {
    const collectionScope = createDataForSeoCollectionScope({
      target: "accepted.example",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en",
      limit: 200,
    });
    const run = {
      provider: "dataforseo",
      operation: "keyword_gap_import",
      method_version: "dataforseo.ranked_keywords.v1",
      site_id: "00000000-0000-4000-8000-000000000005",
      source_connection_id: "00000000-0000-4000-8000-000000000006",
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        siteId: "00000000-0000-4000-8000-000000000005",
        collectionScope,
      }),
    };
    const requestPayload = {
      provider: "dataforseo",
      operation: "keyword_gap_import",
      sourceConnectionId: "00000000-0000-4000-8000-000000000006",
    };

    expect(() =>
      resolveFrozenDataForSeoCollectionScope(
        run as never,
        requestPayload,
        200,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      resolveFrozenDataForSeoCollectionScope(
        run as never,
        {
          ...requestPayload,
          collectionScope: { ...collectionScope, marketCode: "CA" },
        },
        200,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("rejects runtime cap drift instead of silently changing the frozen query", () => {
    const collectionScope = createDataForSeoCollectionScope({
      target: "accepted.example",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en",
      limit: 200,
    });
    const run = {
      provider: "dataforseo",
      operation: "keyword_gap_import",
      method_version: "dataforseo.ranked_keywords.v1",
      site_id: "00000000-0000-4000-8000-000000000005",
      source_connection_id: "00000000-0000-4000-8000-000000000006",
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        siteId: "00000000-0000-4000-8000-000000000005",
        collectionScope,
      }),
    };

    expect(() =>
      resolveFrozenDataForSeoCollectionScope(
        run as never,
        {
          provider: "dataforseo",
          operation: "keyword_gap_import",
          sourceConnectionId:
            "00000000-0000-4000-8000-000000000006",
          collectionScope,
        },
        100,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("executes and summarizes the frozen scope even after Site and connection config change", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000002";
    const projectId = "00000000-0000-4000-8000-000000000003";
    const runId = "00000000-0000-4000-8000-000000000001";
    const siteId = "00000000-0000-4000-8000-000000000005";
    const sourceConnectionId = "00000000-0000-4000-8000-000000000006";
    const collectionScope = createDataForSeoCollectionScope({
      target: "accepted.example",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageTag: "en-GB",
      limit: 37,
    });
    const requestPayload = {
      provider: "dataforseo",
      operation: "keyword_gap_import",
      sourceConnectionId,
      collectionScope,
    };
    const claimed = {
      id: runId,
      workspace_id: workspaceId,
      project_id: projectId,
      attempt_count: 1,
      initiated_by: "00000000-0000-4000-8000-000000000004",
      request_payload: requestPayload,
    };
    const collectionRun = {
      id: runId,
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: siteId,
      provider: "dataforseo",
      operation: "keyword_gap_import",
      method_version: "dataforseo.ranked_keywords.v1",
      source_connection_id: sourceConnectionId,
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        siteId,
        collectionScope,
      }),
    };
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(claimed as never);
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue(
      collectionRun as never,
    );
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
      id: siteId,
      origin: "https://mutated.example",
      host: "mutated.example",
      market_codes: ["CA"],
      language_codes: ["fr-CA"],
    } as never);
    vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
      id: projectId,
      workspace_id: workspaceId,
      archived_at: null,
    } as never);
    vi.spyOn(
      SourceConnectionsRepository.prototype,
      "updateState",
    ).mockResolvedValue(undefined);
    vi.spyOn(
      SourceConnectionsRepository.prototype,
      "findConnectedById",
    ).mockResolvedValue({
      id: sourceConnectionId,
      provider: "dataforseo",
      config: {
        target: "mutated.example",
        marketCode: "CA",
        locationName: "Canada",
        languageCode: "fr",
        maxKeywords: 12,
      },
    } as never);
    mocks.persistCollectionResult.mockResolvedValue("snapshot-1");

    let providerBody: unknown;
    const providerFetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      providerBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
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
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const ctx = {
      db: {
        transaction: async (
          callback: (tx: CollectionWorkerContext["db"]) => Promise<unknown>,
        ) => callback({} as CollectionWorkerContext["db"]),
      } as CollectionWorkerContext["db"],
      blobStore: {},
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "google-id", clientSecret: "google-secret" },
      dataForSeo: {
        enabled: true,
        login: "provider-login",
        password: "provider-password",
        maxKeywords: 200,
        maxCompetitors: 100,
        fetch: providerFetch,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as CollectionWorkerContext;

    await runCollection(ctx, { runId, workspaceId, projectId });

    expect(providerBody).toEqual([
      expect.objectContaining({
        target: "accepted.example",
        location_name: "United Kingdom",
        language_code: "en",
        limit: 37,
      }),
    ]);
    expect(JSON.stringify(providerBody)).not.toContain("mutated.example");
    expect(mocks.persistCollectionResult).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        collectionRun,
        outcome: expect.objectContaining({
          capturedAt: expect.any(String),
          summary: {
            collectionScope,
            timing: {
              collectedAt: expect.any(String),
              dataAsOf: null,
              observedAt: null,
              freshness: "unknown",
            },
          },
        }),
      }),
    );
    const persisted = mocks.persistCollectionResult.mock.calls[0]?.[1] as {
      outcome: {
        capturedAt: string;
        summary: { timing: { collectedAt: string } };
      };
    };
    expect(persisted.outcome.summary.timing.collectedAt).toBe(
      persisted.outcome.capturedAt,
    );
  });

  it("executes one composite Search Landscape collection and persists one composite Snapshot input", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000102";
    const projectId = "00000000-0000-4000-8000-000000000103";
    const runId = "00000000-0000-4000-8000-000000000101";
    const siteId = "00000000-0000-4000-8000-000000000105";
    const sourceConnectionId = "00000000-0000-4000-8000-000000000106";
    const collectionScope = createDataForSeoSearchLandscapeScope({
      target: "accepted.example",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageTag: "en-GB",
      rankedKeywordsLimit: 37,
      competitorsDomainLimit: 19,
    });
    const requestPayload = {
      provider: "dataforseo",
      operation: "search_landscape",
      sourceConnectionId,
      collectionScope,
    };
    const claimed = {
      id: runId,
      workspace_id: workspaceId,
      project_id: projectId,
      attempt_count: 1,
      initiated_by: "00000000-0000-4000-8000-000000000104",
      request_payload: requestPayload,
    };
    const collectionRun = {
      id: runId,
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: siteId,
      provider: "dataforseo",
      operation: "search_landscape",
      method_version: "dataforseo.search_landscape.v1",
      source_connection_id: sourceConnectionId,
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "search_landscape",
        siteId,
        collectionScope,
      }),
    };
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(claimed as never);
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue(
      collectionRun as never,
    );
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
      id: siteId,
      origin: "https://mutated.example",
      host: "mutated.example",
      market_codes: ["CA"],
      language_codes: ["fr-CA"],
    } as never);
    vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
      id: projectId,
      workspace_id: workspaceId,
      archived_at: null,
    } as never);
    vi.spyOn(
      SourceConnectionsRepository.prototype,
      "updateState",
    ).mockResolvedValue(undefined);
    vi.spyOn(
      SourceConnectionsRepository.prototype,
      "findConnectedById",
    ).mockResolvedValue({
      id: sourceConnectionId,
      provider: "dataforseo",
      config: { target: "mutated.example" },
    } as never);
    mocks.persistCollectionResult.mockResolvedValue("snapshot-1");

    const providerRequests: Array<{
      readonly url: string;
      readonly body: unknown;
    }> = [];
    const providerFetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      providerRequests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({
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
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const ctx = {
      db: {
        transaction: async (
          callback: (tx: CollectionWorkerContext["db"]) => Promise<unknown>,
        ) => callback({} as CollectionWorkerContext["db"]),
      } as CollectionWorkerContext["db"],
      blobStore: {},
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "google-id", clientSecret: "google-secret" },
      dataForSeo: {
        enabled: true,
        login: "provider-login",
        password: "provider-password",
        maxKeywords: 100,
        maxCompetitors: 50,
        fetch: providerFetch,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as CollectionWorkerContext;

    await runCollection(ctx, { runId, workspaceId, projectId });

    expect(providerRequests).toHaveLength(2);
    expect(providerRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringContaining("/ranked_keywords/live"),
          body: [
            expect.objectContaining({
              target: "accepted.example",
              location_name: "United Kingdom",
              language_code: "en",
              limit: 37,
            }),
          ],
        }),
        expect.objectContaining({
          url: expect.stringContaining("/competitors_domain/live"),
          body: [
            expect.objectContaining({
              target: "accepted.example",
              location_name: "United Kingdom",
              language_code: "en",
              limit: 19,
            }),
          ],
        }),
      ]),
    );
    expect(JSON.stringify(providerRequests)).not.toContain("mutated.example");
    expect(mocks.persistCollectionResult).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        collectionRun,
        datasetKey: "dataforseo.search_landscape.v1",
        schemaVersion: "dataforseo.search_landscape.v1",
        outcome: expect.objectContaining({
          rowCount: 0,
          providerUsage: expect.objectContaining({ apiCalls: 2 }),
          raw: expect.objectContaining({
            schemaVersion: "dataforseo.search_landscape.v1",
            collectionScope,
          }),
          summary: {
            collectionScope,
            timing: {
              collectedAt: expect.any(String),
              dataAsOf: null,
              observedAt: null,
              freshness: "unknown",
            },
          },
        }),
        observations: [],
      }),
    );
  });

  it("fails enabled collection with AUTH_REQUIRED before any provider request when credentials are incomplete", async () => {
    const claimed = {
      id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "00000000-0000-4000-8000-000000000002",
      project_id: "00000000-0000-4000-8000-000000000003",
      attempt_count: 1,
      initiated_by: "00000000-0000-4000-8000-000000000004",
    };
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      {
        ...claimed,
        request_payload: {
          provider: "dataforseo",
          operation: "keyword_gap_import",
          sourceConnectionId:
            "00000000-0000-4000-8000-000000000006",
          collectionScope: createDataForSeoCollectionScope({
            target: "example.com",
            marketCode: "US",
            locationName: "United States",
            languageTag: "en",
            limit: 200,
          }),
        },
      } as never,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(claimed as never);
    const setTerminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    const collectionScope = createDataForSeoCollectionScope({
      target: "example.com",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en",
      limit: 200,
    });
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue({
      id: claimed.id,
      workspace_id: claimed.workspace_id,
      project_id: claimed.project_id,
      site_id: "00000000-0000-4000-8000-000000000005",
      provider: "dataforseo",
      operation: "keyword_gap_import",
      method_version: "dataforseo.ranked_keywords.v1",
      source_connection_id: "00000000-0000-4000-8000-000000000006",
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        siteId: "00000000-0000-4000-8000-000000000005",
        collectionScope,
      }),
    } as never);
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000005",
      origin: "https://www.example.com",
      host: "www.example.com",
      market_codes: ["US"],
      language_codes: ["en"],
    } as never);
    vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
      id: claimed.project_id,
      workspace_id: claimed.workspace_id,
      archived_at: null,
    } as never);
    const findConnection = vi.spyOn(
      SourceConnectionsRepository.prototype,
      "findConnectedById",
    );
    const updateState = vi
      .spyOn(SourceConnectionsRepository.prototype, "updateState")
      .mockResolvedValue(undefined);
    const providerFetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("provider fetch must not be reached");
    });
    const logLines: string[] = [];
    const append = (event: string, fields?: Record<string, unknown>): void => {
      logLines.push(JSON.stringify({ event, fields }));
    };
    const ctx = {
      db: {
        transaction: async (
          callback: (tx: CollectionWorkerContext["db"]) => Promise<unknown>,
        ) => callback({} as CollectionWorkerContext["db"]),
      } as CollectionWorkerContext["db"],
      blobStore: {},
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "google-id", clientSecret: "google-secret" },
      dataForSeo: {
        enabled: true,
        login: "provider-login-sentinel",
        password: null,
        maxKeywords: 200,
        maxCompetitors: 100,
        fetch: providerFetch,
      },
      logger: {
        info: append,
        warn: append,
        error: append,
      },
    } as unknown as CollectionWorkerContext;

    await expect(
      runCollection(ctx, {
        runId: claimed.id,
        workspaceId: claimed.workspace_id,
        projectId: claimed.project_id,
      }),
    ).resolves.toBeUndefined();

    expect(providerFetch).not.toHaveBeenCalled();
    expect(findConnection).not.toHaveBeenCalled();
    expect(updateState).toHaveBeenNthCalledWith(
      1,
      {
        workspaceId: claimed.workspace_id,
        projectId: claimed.project_id,
      },
      "00000000-0000-4000-8000-000000000006",
      "syncing",
    );
    expect(updateState).toHaveBeenNthCalledWith(
      2,
      {
        workspaceId: claimed.workspace_id,
        projectId: claimed.project_id,
      },
      "00000000-0000-4000-8000-000000000006",
      "permission_denied",
      "DataForSEO worker credentials are unavailable or no longer valid. Update the worker secrets before retrying.",
    );
    expect(setTerminal).toHaveBeenCalledWith(
      {
        workspaceId: claimed.workspace_id,
        projectId: claimed.project_id,
        runId: claimed.id,
        attemptCount: 1,
      },
      {
        status: "failed",
        lastErrorCode: "AUTH_REQUIRED",
        lastErrorSummary: "collection failed",
      },
    );
    expect(logLines.join("\n")).not.toContain("provider-login-sentinel");
  });
});
