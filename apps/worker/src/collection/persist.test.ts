import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ObservationsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  StorageObjectReferencesRepository,
  TelemetryRepository,
  type CollectionRunRow,
  type RunAttempt,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { persistCollectionResult, type CollectionOutcome } from "./persist.ts";

const attempt = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  runId: "run-1",
  attemptCount: 1,
} satisfies RunAttempt;

const collectionRun = {
  id: attempt.runId,
  workspace_id: attempt.workspaceId,
  project_id: attempt.projectId,
  site_id: "site-1",
  source_connection_id: null,
  provider: "crawl",
  operation: "site_graph",
  method_version: "crawl.site_graph.v1",
} as CollectionRunRow;

const outcome = {
  availability: "available",
  capturedAt: "2026-07-19T00:00:00.000Z",
  sourceWindow: {
    start: "2026-07-18T00:00:00.000Z",
    end: "2026-07-19T00:00:00.000Z",
  },
  rowCount: 0,
  stopReason: null,
  providerUsage: {},
  limitation: "fixture",
  raw: { fixture: true },
} satisfies CollectionOutcome;

const uploadedKey = "snapshot-raw/project-1/run-1/attempt-object";
const transaction = vi.fn();
const put = vi.fn();
const deleteObject = vi.fn();
const ctx = {
  db: { transaction },
  blobStore: { put, delete: deleteObject },
} as unknown as WorkerContext;

function persist(): Promise<string | null> {
  return persistCollectionResult(ctx, {
    collectionRun,
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    actorId: "actor-1",
    startedAtMs: Date.now(),
    attempt,
    outcome,
    observations: [],
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  transaction.mockReset();
  put.mockReset().mockResolvedValue({
    key: uploadedKey,
    sha256: "sha256",
    bytes: 17,
  });
  deleteObject.mockReset().mockResolvedValue(undefined);

  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "lockObjectKeysForTransaction",
  ).mockResolvedValue();
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockAttemptForUpdate",
  ).mockResolvedValue({} as never);
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue(true);
  vi.spyOn(
    ProviderDiscrepanciesRepository.prototype,
    "lockCollectionWindow",
  ).mockResolvedValue();
  vi.spyOn(
    ProviderDiscrepanciesRepository.prototype,
    "detectForSnapshot",
  ).mockResolvedValue([]);
  vi.spyOn(DataSnapshotsRepository.prototype, "insert").mockResolvedValue({
    id: "snapshot-1",
  } as never);
  vi.spyOn(ObservationsRepository.prototype, "insertMany").mockResolvedValue(0);
  vi.spyOn(CollectionRunsRepository.prototype, "finalize").mockResolvedValue();
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
    id: attempt.projectId,
    workspace_id: attempt.workspaceId,
    archived_at: null,
  } as never);
  vi.spyOn(
    ProjectsRepository.prototype,
    "setReadyToDiagnoseIfEligible",
  ).mockResolvedValue(false);
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue();
});

describe("persistCollectionResult transaction outcomes", () => {
  it("deletes its upload when the transaction callback explicitly fails", async () => {
    const callbackFailure = Object.assign(new Error("constraint violation"), {
      code: "23514",
    });
    vi.mocked(
      AsyncRunsRepository.prototype.lockAttemptForUpdate,
    ).mockRejectedValueOnce(callbackFailure);
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(persist()).rejects.toBe(callbackFailure);

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith(uploadedKey);
    expect(
      StorageObjectReferencesRepository.prototype.lockObjectKeysForTransaction,
    ).toHaveBeenCalledWith([expect.stringMatching(/^snapshot-raw\/project-1\/run-1\//)]);
    expect(
      vi.mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(put.mock.invocationCallOrder[0]!);
  });

  it("keeps its upload when the callback finished before COMMIT became unknown", async () => {
    const unknownCommit = Object.assign(new Error("commit result unknown"), {
      code: "08006",
    });
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => {
        await callback({});
        throw unknownCommit;
      },
    );

    await expect(persist()).rejects.toBe(unknownCommit);

    expect(DataSnapshotsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({ rawObjectKey: uploadedKey }),
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(
      vi.mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(put.mock.invocationCallOrder[0]!);
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(DataSnapshotsRepository.prototype.insert).mock
        .invocationCallOrder[0]!,
    );
  });

  it("does not upload when a transaction cannot start", async () => {
    const checkoutFailure = Object.assign(new Error("pool checkout timeout"), {
      code: "ETIMEDOUT",
    });
    transaction.mockRejectedValueOnce(checkoutFailure);

    await expect(persist()).rejects.toBe(checkoutFailure);

    expect(put).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
