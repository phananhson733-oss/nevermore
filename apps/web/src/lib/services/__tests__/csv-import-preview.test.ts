import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImportPreviewsRepository,
  ProjectsRepository,
  SitesRepository,
  StorageObjectReferencesRepository,
  type ProjectRow,
} from "@sf/db";
import { KEYWORD_GAP_TEMPLATE_ID } from "@sf/sources";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  deleteObject: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: { transaction: mocks.transaction } }),
}));
vi.mock("@/lib/boss", () => ({ getBoss: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  getBlobStore: () => ({
    put: mocks.put,
    delete: mocks.deleteObject,
  }),
}));

const { previewImport } = await import("../csv-import.ts");

const scope = { workspaceId: "workspace-1" };
const projectId = "project-1";
const actorId = "operator-1";
const uploadedKey = `raw-import/${projectId}/preview-run/preview-object`;
const csv = Buffer.from(
  [
    "keyword,search_volume,market,language",
    "running shoes,1200,US,en",
  ].join("\n"),
  "utf8",
);

function runPreview() {
  return previewImport(scope, projectId, actorId, {
    bytes: csv,
    templateId: KEYWORD_GAP_TEMPLATE_ID,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.put.mockReset().mockResolvedValue({
    key: uploadedKey,
    sha256: "fixture-sha256",
    bytes: csv.byteLength,
  });
  mocks.deleteObject.mockReset().mockResolvedValue(undefined);
  mocks.transaction
    .mockReset()
    .mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({}),
    );

  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: projectId,
    workspace_id: scope.workspaceId,
    archived_at: null,
  } as ProjectRow);
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
    id: projectId,
    workspace_id: scope.workspaceId,
    archived_at: null,
  } as ProjectRow);
  vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
    id: "site-1",
    workspace_id: scope.workspaceId,
    project_id: projectId,
  } as never);
  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "lockObjectKeysForTransaction",
  ).mockResolvedValue();
});

describe("previewImport orphan cleanup", () => {
  it("deletes the upload and writes no preview when the tx re-read finds an archived project", async () => {
    const insert = vi.spyOn(ImportPreviewsRepository.prototype, "insert");
    vi.mocked(
      ProjectsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce({
      id: projectId,
      workspace_id: scope.workspaceId,
      archived_at: "2026-07-20T00:00:00.000Z",
    } as ProjectRow);

    await expect(runPreview()).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
      status: 422,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(mocks.deleteObject).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledWith(uploadedKey);
    expect(
      vi.mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.put.mock.invocationCallOrder[0]!);
  });

  it("deletes the uploaded CSV when the preview row insert fails", async () => {
    const databaseFailure = new Error("preview row insert failed");
    vi.spyOn(ImportPreviewsRepository.prototype, "insert").mockRejectedValueOnce(
      databaseFailure,
    );

    await expect(runPreview()).rejects.toBe(databaseFailure);

    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledWith(uploadedKey);
  });

  it("does not mask or log customer data when orphan cleanup also fails", async () => {
    const databaseFailure = new Error("preview row insert failed");
    const cleanupFailure = new Error(
      `could not delete ${uploadedKey}: ${csv.toString("utf8")}`,
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ImportPreviewsRepository.prototype, "insert").mockRejectedValueOnce(
      databaseFailure,
    );
    mocks.deleteObject.mockRejectedValueOnce(cleanupFailure);

    await expect(runPreview()).rejects.toBe(databaseFailure);

    expect(mocks.deleteObject).toHaveBeenCalledWith(uploadedKey);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("does not delete a possibly committed object when COMMIT acknowledgement is lost", async () => {
    const commitUnknown = Object.assign(
      new Error("connection lost after server commit"),
      { code: "08006" },
    );
    vi.spyOn(ImportPreviewsRepository.prototype, "insert").mockResolvedValueOnce(
      {} as never,
    );
    mocks.transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback({});
        throw commitUnknown;
      },
    );

    await expect(runPreview()).rejects.toBe(commitUnknown);

    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(
      vi.mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.put.mock.invocationCallOrder[0]!);
    expect(mocks.put.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ImportPreviewsRepository.prototype.insert).mock
        .invocationCallOrder[0]!,
    );
  });
});
