import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImportPreviewsRepository,
  ProjectsRepository,
  SitesRepository,
  type ProjectRow,
} from "@sf/db";
import { KEYWORD_GAP_TEMPLATE_ID } from "@sf/sources";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: {} }),
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

  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: projectId,
    workspace_id: scope.workspaceId,
    archived_at: null,
  } as ProjectRow);
  vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
    id: "site-1",
    workspace_id: scope.workspaceId,
    project_id: projectId,
  } as never);
});

describe("previewImport orphan cleanup", () => {
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
});
