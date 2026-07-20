import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
} from "@sf/db";
import {
  runCollection,
  type CollectionWorkerContext,
} from "./run-collection.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DataForSEO worker gates", () => {
  it("fails enabled collection with AUTH_REQUIRED before any provider request when credentials are incomplete", async () => {
    const claimed = {
      id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "00000000-0000-4000-8000-000000000002",
      project_id: "00000000-0000-4000-8000-000000000003",
      attempt_count: 1,
      initiated_by: "00000000-0000-4000-8000-000000000004",
    };
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(claimed as never);
    const setTerminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue({
      id: claimed.id,
      workspace_id: claimed.workspace_id,
      project_id: claimed.project_id,
      site_id: "00000000-0000-4000-8000-000000000005",
      provider: "dataforseo",
      method_version: "dataforseo.ranked_keywords.v1",
      source_connection_id: "00000000-0000-4000-8000-000000000006",
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
