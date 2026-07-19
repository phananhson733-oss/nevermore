import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemError } from "@sf/observability";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  delete: vi.fn(),
  deleteWhere: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    db: {
      transaction: mocks.transaction,
    },
  }),
}));

const { assertWorkspaceAttemptRateLimit, assertWorkspaceRateLimit } =
  await import("../rate-limit.ts");

describe("assertWorkspaceRateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.execute
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(async () => ({ rows: [{ now: new Date() }] }));
    mocks.limit.mockReset().mockResolvedValue([]);
    mocks.where
      .mockReset()
      .mockReturnValueOnce({ limit: mocks.limit })
      .mockResolvedValueOnce([{ count: 0, oldest: null }]);
    mocks.from.mockReset().mockReturnValue({ where: mocks.where });
    mocks.select.mockReset().mockReturnValue({ from: mocks.from });
    mocks.deleteWhere.mockReset().mockResolvedValue(undefined);
    mocks.delete.mockReset().mockReturnValue({ where: mocks.deleteWhere });
    mocks.values.mockReset().mockResolvedValue(undefined);
    mocks.insert.mockReset().mockReturnValue({ values: mocks.values });
    mocks.transaction.mockReset().mockImplementation(async (callback) =>
      callback({
        execute: mocks.execute,
        select: mocks.select,
        delete: mocks.delete,
        insert: mocks.insert,
      }),
    );
  });

  it("records an accepted attempt below the threshold", async () => {
    await expect(
      assertWorkspaceRateLimit("workspace-1", {
        idempotencyKey: "request-key-1",
        scope: "artifact_generation",
        maxAttempts: 3,
        windowMs: 60_000,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "workspace-1",
        scope: "rate_limit:artifact_generation",
        status: "completed",
      }),
    );
    const stored = mocks.values.mock.calls[0]?.[0] as {
      idempotency_key: string;
    };
    expect(stored.idempotency_key).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.idempotency_key).not.toContain("request-key-1");
  });

  it("mints an opaque server-side key for a non-idempotent expensive attempt", async () => {
    await expect(
      assertWorkspaceAttemptRateLimit("workspace-1", {
        scope: "csv_import_preview",
        maxAttempts: 20,
        windowMs: 60_000,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "workspace-1",
        scope: "rate_limit:csv_import_preview",
        idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("does not count an exact Idempotency-Key replay again", async () => {
    mocks.limit.mockResolvedValueOnce([{ id: "existing-attempt" }]);

    await expect(
      assertWorkspaceRateLimit("workspace-1", {
        idempotencyKey: "same-request-key",
        scope: "artifact_generation",
        maxAttempts: 1,
        windowMs: 60_000,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects once the threshold is reached and returns retry-after", async () => {
    vi.useFakeTimers();
    const oldest = "2026-07-18T15:00:00.000Z";
    vi.setSystemTime(new Date("2026-07-18T15:00:30.000Z"));
    mocks.where
      .mockReset()
      .mockReturnValueOnce({ limit: mocks.limit })
      .mockResolvedValueOnce([{ count: 2, oldest }]);

    const promise = assertWorkspaceRateLimit("workspace-1", {
      idempotencyKey: "request-key-2",
      scope: "artifact_generation",
      maxAttempts: 2,
      windowMs: 60_000,
    });

    await expect(promise).rejects.toBeInstanceOf(ProblemError);
    await expect(promise).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      extraHeaders: { "Retry-After": "30" },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
