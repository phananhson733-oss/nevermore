import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageObjectReferencesRepository } from "@sf/db";
import type { Logger } from "@sf/observability";
import type { BlobListPage, BlobStore } from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  EXPORT_OBJECT_RETENTION_MS,
  RAW_OBJECT_RETENTION_MS,
  RETENTION_CLEANUP_INTERVAL_MS,
  RETENTION_CLEANUP_PAGE_SIZE,
  runRetentionCleanupSweep,
  startRetentionCleanupLoop,
} from "./retention-cleanup.ts";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const atAge = (ageMs: number, offsetMs = 0): string =>
  new Date(NOW.getTime() - ageMs + offsetMs).toISOString();

beforeEach(() => {
  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "findExportDeletionFences",
  ).mockResolvedValue(new Map());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("runRetentionCleanupSweep", () => {
  it("deletes referenced and unreferenced bytes at the exact 90/30-day boundaries", async () => {
    const rawAtBoundary = "raw/p1/r1/raw-at-boundary";
    const rawOlder = "raw/p1/r4/raw-older";
    const rawStillRetained = "raw/p1/r3/raw-young";
    const importAtBoundary = "raw-import/p1/r4/import-at-boundary";
    const snapshotDeleteFailure =
      "snapshot-raw/p1/r5/snapshot-delete-failure";
    const exportAtBoundary = "export/p1/r6/export-at-boundary.zip";
    const exportStillRetained = "export/p1/r7/export-young.zip";
    const pages = new Map<string, BlobListPage>([
      [
        "raw:first",
        {
          objects: [
            { key: rawAtBoundary, createdAt: atAge(RAW_OBJECT_RETENTION_MS) },
            {
              key: rawStillRetained,
              createdAt: atAge(RAW_OBJECT_RETENTION_MS, 1),
            },
          ],
          nextCursor: "raw-next",
        },
      ],
      [
        "raw:raw-next",
        {
          objects: [
            { key: rawOlder, createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1) },
          ],
          nextCursor: null,
        },
      ],
      [
        "raw-import:first",
        {
          objects: [
            {
              key: importAtBoundary,
              createdAt: atAge(RAW_OBJECT_RETENTION_MS),
            },
          ],
          nextCursor: null,
        },
      ],
      [
        "snapshot-raw:first",
        {
          objects: [
            {
              key: snapshotDeleteFailure,
              createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1),
            },
          ],
          nextCursor: null,
        },
      ],
      [
        "export:first",
        {
          objects: [
            {
              key: exportAtBoundary,
              createdAt: atAge(EXPORT_OBJECT_RETENTION_MS),
            },
            {
              key: exportStillRetained,
              createdAt: atAge(EXPORT_OBJECT_RETENTION_MS, 1),
            },
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
        throw new Error("snapshot-delete-customer-secret");
      }
    });
    const referenceLookup = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      .mockResolvedValue(
        new Set([rawAtBoundary, importAtBoundary, exportAtBoundary]),
      );
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runRetentionCleanupSweep(ctx, { now: NOW }),
    ).resolves.toEqual({
      scannedCount: 7,
      expiredCount: 5,
      deletedCount: 4,
      deleteFailureCount: 1,
      kindFailureCount: 0,
    });

    expect(referenceLookup).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(5);
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([
      rawAtBoundary,
      rawOlder,
      importAtBoundary,
      snapshotDeleteFailure,
      exportAtBoundary,
    ]);
    const deletedKeys = deleteObject.mock.calls.map(([key]) => key);
    expect(deletedKeys).not.toContain(rawStillRetained);
    expect(deletedKeys).not.toContain(exportStillRetained);
    expect(lines).toContainEqual({
      level: "error",
      event: "retention_cleanup_delete_failed",
      fields: { code: "STORAGE_RETENTION_DELETE_FAILED", kind: "snapshot-raw" },
    });
    expect(lines.at(-1)).toEqual({
      level: "info",
      event: "retention_cleanup_completed",
      fields: {
        scannedCount: 7,
        expiredCount: 5,
        deletedCount: 4,
        deleteFailureCount: 1,
        kindFailureCount: 0,
      },
    });
    expect(JSON.stringify(lines)).not.toMatch(
      /raw-at-boundary|import-at-boundary|export-at-boundary|snapshot-delete|customer-secret/,
    );
  });

  it("retains an uploaded export until both blob age and canonical completion age expire", async () => {
    const commitGapRetained = "export/p1/r1/commit-gap-retained";
    const bothExpired = "export/p1/r2/both-expired";
    const orphan = "export/p1/r3/orphan";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export"
          ? [commitGapRetained, bothExpired, orphan].map((key) => ({
              key,
              // Every candidate has reached Storage's blob-createdAt boundary.
              createdAt: atAge(EXPORT_OBJECT_RETENTION_MS),
            }))
          : [],
      nextCursor: null,
    }));
    const completionLookup = vi
      .mocked(
        StorageObjectReferencesRepository.prototype
          .findExportDeletionFences,
      )
      .mockResolvedValue(
        new Map([
          // Upload happened first; finalize committed two days later. Retain.
          [
            commitGapRetained,
            {
              referenced: true,
              completedAt: atAge(
                EXPORT_OBJECT_RETENTION_MS,
                2 * 86_400_000,
              ),
            },
          ],
          [
            bothExpired,
            {
              referenced: true,
              completedAt: atAge(EXPORT_OBJECT_RETENTION_MS),
            },
          ],
        ]),
      );
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runRetentionCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({
      expiredCount: 3,
      deletedCount: 2,
      deleteFailureCount: 0,
      kindFailureCount: 0,
    });

    expect(completionLookup).toHaveBeenCalledWith([
      { key: commitGapRetained, projectId: "p1", runId: "r1" },
      { key: bothExpired, projectId: "p1", runId: "r2" },
      { key: orphan, projectId: "p1", runId: "r3" },
    ]);
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([
      bothExpired,
      orphan,
    ]);
  });

  it("retains a pre-finalize upload while its canonical export run is active", async () => {
    const uploadedBeforeFinalize = "export/p1/r-active/uploaded-before-finalize";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export"
          ? [
              {
                key: uploadedBeforeFinalize,
                createdAt: atAge(EXPORT_OBJECT_RETENTION_MS),
              },
            ]
          : [],
      nextCursor: null,
    }));
    const completionLookup = vi
      .mocked(
        StorageObjectReferencesRepository.prototype
          .findExportDeletionFences,
      )
      .mockResolvedValue(
        new Map([
          [
            uploadedBeforeFinalize,
            { referenced: false, completedAt: null },
          ],
        ]),
      );
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runRetentionCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ expiredCount: 1, deletedCount: 0 });

    expect(completionLookup).toHaveBeenCalledWith([
      {
        key: uploadedBeforeFinalize,
        projectId: "p1",
        runId: "r-active",
      },
    ]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("keeps the active-run fence when finalize commits after lookup", async () => {
    const racingFinalize = "export/p1/r-racing/finalize-after-lookup";
    let canonicalStatus: "running" | "completed" = "running";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export"
          ? [
              {
                key: racingFinalize,
                createdAt: atAge(EXPORT_OBJECT_RETENTION_MS),
              },
            ]
          : [],
      nextCursor: null,
    }));
    vi.mocked(
      StorageObjectReferencesRepository.prototype.findExportDeletionFences,
    ).mockImplementation(async () => {
      // The SELECT snapshot observes running. The finalize transaction commits
      // immediately afterward, before cleanup could issue its external delete.
      const observedStatus = canonicalStatus;
      canonicalStatus = "completed";
      return new Map([
        [
          racingFinalize,
          {
            referenced: false,
            completedAt: observedStatus === "running" ? null : atAge(0),
          },
        ],
      ]);
    });
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await runRetentionCleanupSweep(ctx, { now: NOW });

    expect(canonicalStatus).toBe("completed");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("fully enumerates a kind before deleting and fails malformed/listing kinds closed", async () => {
    const rawCandidate = "raw/p1/r1/raw-customer-secret";
    const exportCandidate = "export/p1/r2/export-customer-secret.zip";
    const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
      if (kind === "raw" && cursor === null) {
        return {
          objects: [
            { key: rawCandidate, createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1) },
          ],
          nextCursor: "raw-next",
        };
      }
      if (kind === "raw" && cursor === "raw-next") {
        throw new Error("raw-list-customer-secret");
      }
      if (kind === "raw-import") {
        return {
          objects: [
            {
              key: "export/p1/r3/wrong-kind-customer-secret.zip",
              createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1),
            },
          ],
          nextCursor: null,
        };
      }
      if (kind === "snapshot-raw") {
        return { objects: [], nextCursor: "" };
      }
      if (kind === "export") {
        return {
          objects: [
            {
              key: exportCandidate,
              createdAt: atAge(EXPORT_OBJECT_RETENTION_MS, -1),
            },
          ],
          nextCursor: null,
        };
      }
      return { objects: [], nextCursor: null };
    });
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    const result = await runRetentionCleanupSweep(ctx, { now: NOW });

    expect(result).toMatchObject({ deletedCount: 1, kindFailureCount: 3 });
    expect(deleteObject.mock.calls.map(([key]) => key)).not.toContain(
      rawCandidate,
    );
    expect(deleteObject).toHaveBeenCalledWith(exportCandidate, {
      signal: expect.any(AbortSignal),
    });
    expect(lines).toContainEqual({
      level: "error",
      event: "retention_cleanup_kind_failed",
      fields: { code: "STORAGE_RETENTION_KIND_FAILED", kind: "raw" },
    });
    expect(JSON.stringify(lines)).not.toMatch(
      /raw-customer-secret|export-customer-secret|wrong-kind-customer-secret|list-customer-secret/,
    );
  });

  it("fails a kind closed when a backend returns a non-string cursor", async () => {
    const expiredKey = "export/p1/r1/non-string-cursor-secret.zip";
    const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
      if (kind !== "export") return { objects: [], nextCursor: null };
      if (cursor === null) {
        return {
          objects: [
            {
              key: expiredKey,
              createdAt: atAge(EXPORT_OBJECT_RETENTION_MS, -1),
            },
          ],
          nextCursor: 42 as unknown as string,
        };
      }
      return { objects: [], nextCursor: null };
    });
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runRetentionCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

    expect(deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toContain("non-string-cursor-secret");
  });

  it("uses one validated database clock value by default", async () => {
    const databaseNow = vi
      .spyOn(StorageObjectReferencesRepository.prototype, "databaseNow")
      .mockResolvedValue(NOW);
    const oldExport = "export/p1/r1/db-clock-expired";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export"
          ? [
              {
                key: oldExport,
                createdAt: atAge(EXPORT_OBJECT_RETENTION_MS),
              },
            ]
          : [],
      nextCursor: null,
    }));
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await runRetentionCleanupSweep(ctx);

    expect(databaseNow).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(oldExport, {
      signal: expect.any(AbortSignal),
    });
  });

  it("is idempotent when a later sweep no longer lists already-deleted bytes", async () => {
    const expiredKey = "export/p1/r1/idempotent-expired";
    let present = true;
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        present && kind === "export"
          ? [
              {
                key: expiredKey,
                createdAt: atAge(EXPORT_OBJECT_RETENTION_MS, -1),
              },
            ]
          : [],
      nextCursor: null,
    }));
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => {
      present = false;
    });
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runRetentionCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ deletedCount: 1, deleteFailureCount: 0 });
    await expect(
      runRetentionCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ deletedCount: 0, deleteFailureCount: 0 });

    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      capacity: "objects" as const,
      options: { maxObjectsPerKind: 1, maxExpiredPerKind: 10 },
      createdAt: atAge(RAW_OBJECT_RETENTION_MS, 1),
    },
    {
      capacity: "expired" as const,
      options: { maxObjectsPerKind: 10, maxExpiredPerKind: 1 },
      createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1),
    },
  ])(
    "fails a kind closed with fixed metadata when the $capacity cap is exceeded",
    async ({ capacity, options, createdAt }) => {
      const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
        objects:
          kind === "raw"
            ? [
                { key: "raw/p1/r1/a-secret", createdAt },
                { key: "raw/p1/r1/b-secret", createdAt },
              ]
            : [],
        nextCursor: null,
      }));
      const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
      const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

      await expect(
        runRetentionCleanupSweep(ctx, { now: NOW, ...options }),
      ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

      expect(deleteObject).not.toHaveBeenCalled();
      expect(lines).toContainEqual({
        level: "error",
        event: "retention_cleanup_capacity_exceeded",
        fields: {
          code: "STORAGE_RETENTION_CAPACITY_EXCEEDED",
          kind: "raw",
          capacity,
        },
      });
      expect(JSON.stringify(lines)).not.toContain("secret");
    },
  );

  it("fails a kind closed when its page cap is exhausted", async () => {
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects: [],
      nextCursor: kind === "raw" ? "next-page" : null,
    }));
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runRetentionCleanupSweep(ctx, { now: NOW, maxPagesPerKind: 1 }),
    ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

    expect(deleteObject).not.toHaveBeenCalled();
    expect(lines).toContainEqual({
      level: "error",
      event: "retention_cleanup_capacity_exceeded",
      fields: {
        code: "STORAGE_RETENTION_CAPACITY_EXCEEDED",
        kind: "raw",
        capacity: "pages",
      },
    });
  });

  it(
    "streams 100k expired objects through a 0600 spool with fixed delete concurrency",
    async () => {
      const spoolParent = await mkdtemp(join(tmpdir(), "sf-retention-test-"));
      const total = 100_000;
      const pageCount = Math.ceil(total / RETENTION_CLEANUP_PAGE_SIZE);
      let deletedCount = 0;
      let activeDeletes = 0;
      let maxActiveDeletes = 0;
      let listCallsAtFirstDelete: number | undefined;
      let spoolModePromise: Promise<number> | undefined;
      const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
        if (kind !== "raw") return { objects: [], nextCursor: null };
        const pageIndex =
          cursor === null ? 0 : Number(cursor.replace("page-", ""));
        const start = pageIndex * RETENTION_CLEANUP_PAGE_SIZE;
        const length = Math.min(RETENTION_CLEANUP_PAGE_SIZE, total - start);
        return {
          objects: Array.from({ length }, (_, offset) => ({
            key: `raw/p1/r1/${String(start + offset).padStart(6, "0")}`,
            createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1),
          })),
          nextCursor:
            pageIndex + 1 < pageCount ? `page-${pageIndex + 1}` : null,
        };
      });
      const deleteObject: BlobStore["delete"] = async () => {
        listCallsAtFirstDelete ??= list.mock.calls.length;
        spoolModePromise ??= (async () => {
          const directories = await readdir(spoolParent);
          const files = await readdir(join(spoolParent, directories[0]!));
          return (
            await stat(
              join(
                spoolParent,
                directories[0]!,
                files.find((file) => file.endsWith(".expired"))!,
              ),
            )
          ).mode & 0o777;
        })();
        activeDeletes += 1;
        maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
        await Promise.resolve();
        activeDeletes -= 1;
        deletedCount += 1;
      };
      const { ctx } = contextWithCapturedLogger(list, deleteObject);

      try {
        await expect(
          runRetentionCleanupSweep(ctx, {
            now: NOW,
            spoolDirectory: spoolParent,
            maxObjectsPerKind: total,
            maxExpiredPerKind: total,
            deadlineMs: 30_000,
          }),
        ).resolves.toMatchObject({
          scannedCount: total,
          expiredCount: total,
          deletedCount: total,
          deleteFailureCount: 0,
          kindFailureCount: 0,
        });

        expect(list).toHaveBeenCalledTimes(pageCount + 3);
        expect(listCallsAtFirstDelete).toBe(pageCount);
        expect(await spoolModePromise).toBe(0o600);
        expect(maxActiveDeletes).toBe(4);
        expect(deletedCount).toBe(total);
        expect(await readdir(spoolParent)).toEqual([]);
      } finally {
        await rm(spoolParent, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it("passes one AbortSignal to list/delete and caps delete concurrency at four", async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      key: `raw/p1/r1/${String(index).padStart(2, "0")}`,
      createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1),
    }));
    let activeDeletes = 0;
    let maxActiveDeletes = 0;
    const releases: Array<() => void> = [];
    const listSignals: AbortSignal[] = [];
    const deleteSignals: AbortSignal[] = [];
    const list = vi.fn<BlobStore["list"]>(async (input) => {
      const signal = (input as typeof input & { signal?: AbortSignal }).signal;
      if (signal) listSignals.push(signal);
      return {
        objects: input.kind === "raw" ? candidates : [],
        nextCursor: null,
      };
    });
    const deleteObject = vi.fn(async (...args: unknown[]) => {
      const options = args[1] as { signal?: AbortSignal } | undefined;
      if (options?.signal) deleteSignals.push(options.signal);
      activeDeletes += 1;
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
      await new Promise<void>((resolve) => releases.push(resolve));
      activeDeletes -= 1;
    }) as BlobStore["delete"] & ReturnType<typeof vi.fn>;
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    const sweep = runRetentionCleanupSweep(ctx, {
      now: NOW,
      deadlineMs: 10_000,
    });
    await vi.waitFor(() => expect(deleteObject).toHaveBeenCalledTimes(4));
    expect(maxActiveDeletes).toBe(4);
    while (deleteObject.mock.calls.length < candidates.length || activeDeletes > 0) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      releases.splice(0).forEach((release) => release());
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await expect(sweep).resolves.toMatchObject({ deletedCount: 10 });

    expect(listSignals.length).toBeGreaterThan(0);
    expect(deleteSignals).toHaveLength(10);
    expect(new Set([...listSignals, ...deleteSignals]).size).toBe(1);
  });

  it("aborts a never-settling list at the overall sweep deadline", async () => {
    vi.useFakeTimers();
    const list = vi.fn<BlobStore["list"]>(
      () => new Promise<BlobListPage>(() => undefined),
    );
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    const sweep = runRetentionCleanupSweep(ctx, {
      now: NOW,
      deadlineMs: 50,
    });
    const rejected = expect(sweep).rejects.toMatchObject({
      code: "STORAGE_RETENTION_ABORTED",
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe("startRetentionCleanupLoop", () => {
  it("runs immediately and daily until stopped without duplicating an in-flight sweep", async () => {
    expect(RETENTION_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1_000);
    expect(RAW_OBJECT_RETENTION_MS).toBe(90 * 24 * 60 * 60 * 1_000);
    expect(EXPORT_OBJECT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1_000);
    vi.useFakeTimers();
    let resolveSweep!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveSweep = resolve;
    });
    const cleanup = vi.fn(() => pending);
    const { ctx } = contextWithCapturedLogger(
      vi.fn<BlobStore["list"]>(async () => ({ objects: [], nextCursor: null })),
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    const loop = startRetentionCleanupLoop(ctx, {
      intervalMs: 1_000,
      cleanup,
    });
    const sameRun = loop.runNow();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);

    resolveSweep();
    await sameRun;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
    await loop.stop();
    await loop.stop();
    await loop.runNow();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("uses the real sweep by default and rejects invalid intervals", async () => {
    vi.useFakeTimers();
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "databaseNow",
    ).mockResolvedValue(NOW);
    const list = vi.fn<BlobStore["list"]>(async () => ({
      objects: [],
      nextCursor: null,
    }));
    const { ctx } = contextWithCapturedLogger(
      list,
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    expect(() =>
      startRetentionCleanupLoop(ctx, { intervalMs: 0 }),
    ).toThrow(/interval must be a positive integer/);

    const loop = startRetentionCleanupLoop(ctx, { intervalMs: 1_000 });
    await loop.runNow();
    expect(list).toHaveBeenCalledTimes(4);
    await loop.stop();
  });

  it("redacts a failed sweep and permits the next scheduled retry", async () => {
    vi.useFakeTimers();
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("export/p1/r1/loop-customer-secret"))
      .mockResolvedValue(undefined);
    const { ctx, lines } = contextWithCapturedLogger(
      vi.fn<BlobStore["list"]>(async () => ({ objects: [], nextCursor: null })),
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    const loop = startRetentionCleanupLoop(ctx, {
      intervalMs: 1_000,
      cleanup,
    });
    await expect(loop.runNow()).resolves.toBeUndefined();
    expect(lines).toContainEqual({
      level: "error",
      event: "retention_cleanup_failed",
      fields: { code: "STORAGE_RETENTION_SWEEP_FAILED" },
    });
    expect(JSON.stringify(lines)).not.toContain("loop-customer-secret");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it.each(["list", "delete"] as const)(
    "stops without waiting for a never-settling storage %s and schedules no later DB work",
    async (operation) => {
      vi.useFakeTimers();
      const candidate = "raw/p1/r1/never-settles";
      const databaseNow = vi
        .spyOn(StorageObjectReferencesRepository.prototype, "databaseNow")
        .mockResolvedValue(NOW);
      const list = vi.fn<BlobStore["list"]>(async ({ kind }) => {
        if (operation === "list" && kind === "raw") {
          return new Promise<BlobListPage>(() => undefined);
        }
        return {
          objects:
            operation === "delete" && kind === "raw"
              ? [
                  {
                    key: candidate,
                    createdAt: atAge(RAW_OBJECT_RETENTION_MS, -1),
                  },
                ]
              : [],
          nextCursor: null,
        };
      });
      const deleteObject = vi.fn<BlobStore["delete"]>(
        () => new Promise<void>(() => undefined),
      );
      const { ctx } = contextWithCapturedLogger(list, deleteObject);
      const loop = startRetentionCleanupLoop(ctx, {
        intervalMs: 60_000,
        sweepTimeoutMs: 60_000,
        stopTimeoutMs: 50,
      });
      await vi.waitFor(() => {
        if (operation === "list") expect(list).toHaveBeenCalled();
        else expect(deleteObject).toHaveBeenCalledTimes(1);
      });

      const firstStop = loop.stop();
      const secondStop = loop.stop();
      expect(secondStop).toBe(firstStop);
      await vi.advanceTimersByTimeAsync(50);
      await expect(firstStop).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(databaseNow).toHaveBeenCalledTimes(1);
      if (operation === "list") expect(list).toHaveBeenCalledTimes(1);
      else expect(deleteObject).toHaveBeenCalledTimes(1);
    },
  );
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
      findingSummariesEnabled: true,
      logger,
    },
    lines,
  };
}
