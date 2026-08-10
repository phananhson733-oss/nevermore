import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  ImportPreviewsRepository,
  ProjectsRepository,
  SitesRepository,
} from "@sf/db";
import {
  runCollection,
  type CollectionWorkerContext,
} from "./run-collection.ts";

const mocks = vi.hoisted(() => ({
  persistCollectionResult: vi.fn(),
}));

vi.mock("./persist.ts", () => ({
  persistCollectionResult: mocks.persistCollectionResult,
}));

const IDS = {
  run: "00000000-0000-4000-8000-000000000301",
  workspace: "00000000-0000-4000-8000-000000000302",
  project: "00000000-0000-4000-8000-000000000303",
  actor: "00000000-0000-4000-8000-000000000304",
  site: "00000000-0000-4000-8000-000000000305",
  preview: "00000000-0000-4000-8000-000000000306",
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  mocks.persistCollectionResult.mockReset();
});

describe("CSV Keyword governance suggestion scheduling", () => {
  it("dispatches the durable request after a persisted keyword-gap import and preserves success when dispatch fails", async () => {
    const claimed = {
      id: IDS.run,
      workspace_id: IDS.workspace,
      project_id: IDS.project,
      attempt_count: 1,
      initiated_by: IDS.actor,
      request_payload: {
        mapping: { keyword: "keyword", searchVolume: "search_volume" },
        marketFallback: "US",
        languageFallback: "en",
      },
    };
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(claimed as never);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(
      claimed as never,
    );
    const setTerminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue({
      id: IDS.run,
      workspace_id: IDS.workspace,
      project_id: IDS.project,
      site_id: IDS.site,
      provider: "csv",
      operation: "keyword_gap_import",
      method_version: "csv.keyword_gap.v1",
      source_connection_id: null,
      import_preview_id: IDS.preview,
    } as never);
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
      id: IDS.site,
      origin: "https://example.test",
      host: "example.test",
    } as never);
    vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
      id: IDS.project,
      workspace_id: IDS.workspace,
      archived_at: null,
    } as never);
    vi.spyOn(ImportPreviewsRepository.prototype, "findById").mockResolvedValue({
      raw_object_key: "csv/keyword-gap.csv",
      detected_columns: ["keyword", "search_volume"],
    } as never);
    const requestId = "00000000-0000-4000-8000-000000000307";
    mocks.persistCollectionResult.mockImplementation(
      async (_ctx, input: { onKeywordGovernanceScheduleRequest?: (id: string) => void }) => {
        input.onKeywordGovernanceScheduleRequest?.(requestId);
        return IDS.preview;
      },
    );
    const dispatchScheduleRequest = vi.fn(async () => {
      throw new Error("suggestion queue unavailable");
    });
    const ctx = {
      db: {
        transaction: async (
          callback: (tx: CollectionWorkerContext["db"]) => Promise<unknown>,
        ) => callback({} as CollectionWorkerContext["db"]),
      } as CollectionWorkerContext["db"],
      boss: {},
      blobStore: {
        get: vi.fn(async () =>
          Buffer.from("keyword,search_volume\nrunning shoes,1000\n", "utf8"),
        ),
      },
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      dispatchKeywordGovernanceScheduleRequest: dispatchScheduleRequest,
    } as unknown as CollectionWorkerContext;

    await expect(
      runCollection(ctx, {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.persistCollectionResult).toHaveBeenCalledOnce();
    expect(dispatchScheduleRequest).toHaveBeenCalledWith(
      ctx,
      {
        scope: { workspaceId: IDS.workspace, projectId: IDS.project },
        requestId,
      },
    );
    expect(setTerminal).not.toHaveBeenCalled();
  });
});
