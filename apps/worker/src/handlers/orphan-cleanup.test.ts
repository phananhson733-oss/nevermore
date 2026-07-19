import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageObjectReferencesRepository } from "@sf/db";
import type { Logger } from "@sf/observability";
import type { BlobListPage, BlobStore } from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  ORPHAN_CLEANUP_INTERVAL_MS,
  ORPHAN_CLEANUP_MIN_AGE_MS,
  runOrphanCleanupSweep,
  startOrphanCleanupLoop,
} from "./orphan-cleanup.ts";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const OLD = "2026-07-17T11:59:59.000Z";
const YOUNG = "2026-07-19T11:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("runOrphanCleanupSweep", () => {
  it("paginates every private kind and deletes only old, canonically unreferenced objects", async () => {
    const rawOrphan = "raw/p1/r1/orphan";
    const rawOrphan2 = "raw/p1/r2/orphan";
    const rawReferenced = "raw/p1/r3/referenced";
    const rawYoung = "raw/p1/r4/young";
    const snapshotDeleteFailure = "snapshot-raw/p1/r5/delete-failure";
    const exportReferenced = "export/p1/r6/referenced.zip";
    const exportOrphan = "export/p1/r7/orphan.zip";
    const pages = new Map<string, BlobListPage>([
      [
        "raw:first",
        {
          objects: [
            { key: rawOrphan, createdAt: OLD },
            { key: rawReferenced, createdAt: OLD },
            { key: rawYoung, createdAt: YOUNG },
          ],
          nextCursor: "raw-next",
        },
      ],
      [
        "raw:raw-next",
        {
          objects: [{ key: rawOrphan2, createdAt: OLD }],
          nextCursor: null,
        },
      ],
      ["raw-import:first", { objects: [], nextCursor: null }],
      [
        "snapshot-raw:first",
        {
          objects: [{ key: snapshotDeleteFailure, createdAt: OLD }],
          nextCursor: null,
        },
      ],
      [
        "export:first",
        {
          objects: [
            { key: exportReferenced, createdAt: OLD },
            { key: exportOrphan, createdAt: OLD },
          ],
          nextCursor: null,
        },
      ],
    ]);
    const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
      const page = pages.get(`${kind}:${cursor ?? "first"}`);
      if (!page) throw new Error("unexpected list request");
      return page;
    });
    const deleteObject = vi.fn<BlobStore["delete"]>(async (key) => {
      if (key === snapshotDeleteFailure) {
        throw new Error("customer-delete-secret");
      }
    });
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "findReferencedKeys",
    ).mockImplementation(async (keys) =>
      new Set(
        keys.filter(
          (key) => key === rawReferenced || key === exportReferenced,
        ),
      ),
    );
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toEqual({
      scannedCount: 7,
      eligibleCount: 6,
      referencedCount: 2,
      deletedCount: 3,
      deleteFailureCount: 1,
      kindFailureCount: 0,
    });

    expect(list).toHaveBeenCalledTimes(5);
    expect(list).toHaveBeenNthCalledWith(1, {
      kind: "raw",
      cursor: null,
      limit: 100,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      kind: "raw",
      cursor: "raw-next",
      limit: 100,
    });
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([
      rawOrphan,
      rawOrphan2,
      snapshotDeleteFailure,
      exportOrphan,
    ]);
    expect(lines).toContainEqual({
      level: "error",
      event: "orphan_cleanup_delete_failed",
      fields: { code: "STORAGE_DELETE_FAILED", kind: "snapshot-raw" },
    });
    expect(lines.at(-1)).toEqual({
      level: "info",
      event: "orphan_cleanup_completed",
      fields: {
        scannedCount: 7,
        eligibleCount: 6,
        referencedCount: 2,
        deletedCount: 3,
        deleteFailureCount: 1,
        kindFailureCount: 0,
      },
    });
    expect(JSON.stringify(lines)).not.toMatch(
      /orphan\.zip|delete-failure|customer-delete-secret/,
    );
  });

  it("fails one kind closed on list/protocol errors, redacts details, and continues", async () => {
    const exportOrphan = "export/p1/r1/export-customer-secret";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => {
      if (kind === "raw") {
        throw new Error("raw/p1/r1/list-customer-secret");
      }
      if (kind === "raw-import") {
        return {
          objects: [
            {
              key: "export/p1/r1/wrong-kind-customer-secret",
              createdAt: OLD,
            },
          ],
          nextCursor: null,
        };
      }
      if (kind === "export") {
        return {
          objects: [{ key: exportOrphan, createdAt: OLD }],
          nextCursor: null,
        };
      }
      return { objects: [], nextCursor: null };
    });
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "findReferencedKeys",
    ).mockResolvedValue(new Set());
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    const result = await runOrphanCleanupSweep(ctx, { now: NOW });

    expect(result).toMatchObject({
      deletedCount: 1,
      kindFailureCount: 2,
    });
    expect(deleteObject).toHaveBeenCalledWith(exportOrphan);
    expect(deleteObject).not.toHaveBeenCalledWith(
      "export/p1/r1/wrong-kind-customer-secret",
    );
    expect(lines).toContainEqual({
      level: "error",
      event: "orphan_cleanup_kind_failed",
      fields: { code: "ORPHAN_CLEANUP_KIND_FAILED", kind: "raw" },
    });
    expect(JSON.stringify(lines)).not.toMatch(
      /list-customer-secret|wrong-kind-customer-secret|export-customer-secret/,
    );
  });

  it("uses the database clock by default so worker clock skew cannot shorten the age gate", async () => {
    const oldOrphan = "export/p1/r1/db-clock-orphan";
    const databaseNow = vi
      .spyOn(StorageObjectReferencesRepository.prototype, "databaseNow")
      .mockResolvedValue(NOW);
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "findReferencedKeys",
    ).mockResolvedValue(new Set());
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export" ? [{ key: oldOrphan, createdAt: OLD }] : [],
      nextCursor: null,
    }));
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await runOrphanCleanupSweep(ctx);

    expect(databaseNow).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(oldOrphan);
  });
});

describe("startOrphanCleanupLoop", () => {
  it("runs immediately and then once per configured daily interval until stopped", async () => {
    expect(ORPHAN_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1_000);
    expect(ORPHAN_CLEANUP_MIN_AGE_MS).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1_000,
    );
    vi.useFakeTimers();
    const cleanup = vi.fn(async () => undefined);
    const { ctx } = contextWithCapturedLogger(
      vi.fn<BlobStore["list"]>(async () => ({ objects: [], nextCursor: null })),
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    const loop = startOrphanCleanupLoop(ctx, {
      intervalMs: 1_000,
      cleanup,
    });
    await loop.runNow();
    expect(cleanup).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
    await loop.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("fails the initial sweep open without duplicating it, leaking its error, or blocking later runs", async () => {
    vi.useFakeTimers();
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("raw/p1/r1/customer-error-secret"))
      .mockResolvedValue(undefined);
    const { ctx, lines } = contextWithCapturedLogger(
      vi.fn<BlobStore["list"]>(async () => ({ objects: [], nextCursor: null })),
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    const loop = startOrphanCleanupLoop(ctx, {
      intervalMs: 1_000,
      cleanup,
    });
    await expect(loop.runNow()).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(lines).toContainEqual({
      level: "error",
      event: "orphan_cleanup_failed",
      fields: { code: "ORPHAN_CLEANUP_SWEEP_FAILED" },
    });
    expect(JSON.stringify(lines)).not.toContain("customer-error-secret");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
    await expect(loop.stop()).resolves.toBeUndefined();
  });
});

function contextWithCapturedLogger(
  list: BlobStore["list"],
  deleteObject: BlobStore["delete"],
): {
  readonly ctx: WorkerContext;
  readonly lines: Array<{
    level: string;
    event: string;
    fields: Record<string, unknown> | undefined;
  }>;
} {
  const lines: Array<{
    level: string;
    event: string;
    fields: Record<string, unknown> | undefined;
  }> = [];
  const append =
    (level: string) =>
    (event: string, fields?: Record<string, unknown>): void => {
      lines.push({ level, event, fields });
    };
  const logger: Logger = {
    context: { service: "worker", environment: "test" },
    child: () => logger,
    debug: append("debug"),
    info: append("info"),
    warn: append("warn"),
    error: append("error"),
  };
  return {
    ctx: {
      db: {} as WorkerContext["db"],
      boss: {} as WorkerContext["boss"],
      blobStore: {
        put: vi.fn(),
        get: vi.fn(),
        signedUrl: vi.fn(),
        delete: deleteObject,
        list,
      },
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test", clientSecret: "test" },
      openai: { apiKey: "test", model: "test" },
      logger,
    },
    lines,
  };
}
