import {
  DataSnapshotsRepository,
  GrowthMapReadRepository,
  ProjectsRepository,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getProjectAuditUrl, listProjectAuditUrls } = await import(
  "./growth-map.ts"
);

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  uiLocale: "zh-CN" as const,
};
const projectId = "00000000-0000-4000-8000-000000000002";

describe("Growth Map list input boundary", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the latest frozen run when its output locale differs from the workbench locale", async () => {
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
      id: projectId,
    } as never);
    const latestRun = vi
      .spyOn(GrowthMapReadRepository.prototype, "findLatestReadableRun")
      .mockResolvedValue({
        output_locale: "en-US",
        input_manifest: {
          snapshots: [
            { snapshotId: "00000000-0000-4000-8000-000000000004" },
          ],
        },
      } as never);
    const sentinel = new Error("reached frozen snapshot lookup");
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    ).mockRejectedValue(sentinel);

    await expect(
      listProjectAuditUrls(
        scope,
        projectId,
        { limit: 50, cursor: null },
        {} as never,
      ),
    ).rejects.toBe(sentinel);
    expect(latestRun).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      projectId,
    });
    expect(latestRun).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveBeenCalledTimes(1);
  });

  it.each([
    "customer-private-malformed-keyset",
    "2026-02-31T00:00:00.000Z 00000000-0000-4000-8000-000000000003",
    "2026-07-19T00:00:00.000Z customer-private-invalid-uuid",
  ])(
    "rejects a semantically invalid timestamp/UUID cursor before database access: %j",
    async (privatePayload) => {
      const cursor = Buffer.from(privatePayload, "utf8").toString("base64url");

      let caught: unknown;
      try {
        await listProjectAuditUrls(scope, projectId, {
          limit: 50,
          cursor,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProblemError);
      expect(caught).toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Query parameter failed validation.",
      });
      expect((caught as ProblemError).fieldErrors).toEqual([
        {
          pointer: "/cursor",
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ]);
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect((caught as ProblemError).message).not.toContain(privatePayload);
      expect((caught as ProblemError).message).not.toContain(cursor);
    },
  );

  it.each([
    {
      name: "portfolio",
      read: () =>
        listProjectAuditUrls(scope, projectId, { limit: 50, cursor: null }),
    },
    {
      name: "detail",
      read: () =>
        getProjectAuditUrl(
          scope,
          projectId,
          "00000000-0000-4000-8000-000000000003",
        ),
    },
  ])(
    "uses one repeatable-read, read-only transaction for a production $name read",
    async ({ read }) => {
      const sentinel = new Error("stop before repository reads");
      const transaction = vi.fn(
        async (
          callback: (tx: unknown) => Promise<unknown>,
          options: Record<string, unknown>,
        ) => {
          expect(callback).toEqual(expect.any(Function));
          expect(options).toEqual({
            isolationLevel: "repeatable read",
            accessMode: "read only",
          });
          throw sentinel;
        },
      );
      mocks.getDb.mockReturnValue({ db: { transaction } });

      await expect(read()).rejects.toBe(sentinel);
      expect(mocks.getDb).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );
});
