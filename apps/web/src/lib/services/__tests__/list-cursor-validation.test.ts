import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

const { listProjectSnapshots } = await import("../snapshots.ts");
const { listProjectFindings } = await import("../findings-list.ts");
const { listProjectArtifacts } = await import("../artifacts.ts");

const scope = { workspaceId: "00000000-0000-4000-8000-000000000001" };
const projectId = "00000000-0000-4000-8000-000000000002";

const LISTS = [
  {
    name: "snapshots",
    list: (cursor: string) =>
      listProjectSnapshots(scope, projectId, { limit: 50, cursor }),
  },
  {
    name: "findings",
    list: (cursor: string) =>
      listProjectFindings(scope, projectId, {
        limit: 50,
        cursor,
        activeOnly: false,
      }),
  },
  {
    name: "artifacts",
    list: (cursor: string) =>
      listProjectArtifacts(scope, projectId, { limit: 50, cursor }),
  },
] as const;

const INVALID_DECODED_KEYSETS = [
  "customer-private-malformed-keyset",
  "2026-02-31T00:00:00.000Z 00000000-0000-4000-8000-000000000003",
  "2026-07-19T00:00:00.000Z customer-private-invalid-uuid",
] as const;

describe("timestamp/UUID list cursor validation", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  for (const entry of LISTS) {
    it.each(INVALID_DECODED_KEYSETS)(
      `${entry.name} rejects a semantically invalid decoded keyset before any database access: %j`,
      async (privatePayload) => {
        // The outer query parser accepts this canonical base64url spelling; only
        // the decoded timestamp/UUID tuple is invalid.
        const cursor = Buffer.from(privatePayload, "utf8").toString("base64url");

        let caught: unknown;
        try {
          await entry.list(cursor);
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
        expect(
          JSON.stringify({
            message: (caught as ProblemError).message,
            fieldErrors: (caught as ProblemError).fieldErrors,
          }),
        ).not.toContain(privatePayload);
        expect((caught as ProblemError).message).not.toContain(cursor);
      },
    );
  }
});
