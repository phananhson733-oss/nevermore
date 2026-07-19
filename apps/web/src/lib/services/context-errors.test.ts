import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: { transaction } }),
}));

const { updateContext } = await import("./context");

const args = [
  { workspaceId: "workspace-1" },
  "project-1",
  "actor-1",
  {
    mode: "draft" as const,
    baseVersion: 2,
    profile: { productName: "Nested database error" },
  },
] as const;

describe("updateContext database errors", () => {
  beforeEach(() => {
    transaction.mockReset();
  });

  it("maps a deeply wrapped unique violation to VERSION_CONFLICT", async () => {
    transaction.mockRejectedValueOnce({
      cause: {
        cause: {
          code: "23505",
          constraint: "icp_profiles_project_id_content_hash_key",
        },
      },
    });

    await expect(updateContext(...args)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
  });

  it("preserves a wrapped non-unique failure", async () => {
    const failure = { cause: { cause: { code: "23503" } } };
    transaction.mockRejectedValueOnce(failure);
    await expect(updateContext(...args)).rejects.toBe(failure);
  });
});
