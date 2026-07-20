import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageObjectReferencesRepository } from "@sf/db";
import type { Logger } from "@sf/observability";
import type { BlobListPage, BlobStore } from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  ORPHAN_CLEANUP_INTERVAL_MS,
  ORPHAN_CLEANUP_MIN_AGE_MS,
  ORPHAN_CLEANUP_PAGE_SIZE,
  runOrphanCleanupSweep,
  startOrphanCleanupLoop,
} from "./orphan-cleanup.ts";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const OLD = "2026-07-17T11:59:59.000Z";
const YOUNG = "2026-07-19T11:00:00.000Z";

beforeEach(() => {
  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "findExportDeletionFences",
  ).mockResolvedValue(new Map());
  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "lockObjectKeysForTransaction",
  ).mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("runOrphanCleanupSweep", () => {
  it("rejects unsafe options before touching storage", async () => {
    const list = vi.fn<BlobStore["list"]>(async () => ({
      objects: [],
      nextCursor: null,
    }));
    const { ctx } = contextWithCapturedLogger(
      list,
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    await expect(
      runOrphanCleanupSweep(ctx, {
        now: NOW,
        minAgeMs: ORPHAN_CLEANUP_MIN_AGE_MS - 1,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW, deadlineMs: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      runOrphanCleanupSweep(ctx, {
        now: NOW,
        spoolDirectory: "relative-spool",
      }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      runOrphanCleanupSweep(ctx, { now: new Date(Number.NaN) }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(list).not.toHaveBeenCalled();
  });

  it("maps an already-aborted external signal to a fixed error before storage I/O", async () => {
    const controller = new AbortController();
    controller.abort(new Error("abort-reason-customer-secret"));
    const list = vi.fn<BlobStore["list"]>(async () => ({
      objects: [],
      nextCursor: null,
    }));
    const { ctx, lines } = contextWithCapturedLogger(
      list,
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ORPHAN_CLEANUP_ABORTED" });

    expect(list).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toContain("customer-secret");
  });

  it("maps database clock rejection and malformed results to a fixed sweep error", async () => {
    const databaseNow = vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "databaseNow",
    );
    const list = vi.fn<BlobStore["list"]>(async () => ({
      objects: [],
      nextCursor: null,
    }));
    const { ctx } = contextWithCapturedLogger(
      list,
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );

    databaseNow.mockRejectedValueOnce(Symbol("database-secret"));
    await expect(runOrphanCleanupSweep(ctx)).rejects.toMatchObject({
      code: "ORPHAN_CLEANUP_SWEEP_FAILED",
    });
    databaseNow.mockResolvedValueOnce(new Date(Number.NaN));
    await expect(runOrphanCleanupSweep(ctx)).rejects.toMatchObject({
      code: "ORPHAN_CLEANUP_SWEEP_FAILED",
    });

    expect(list).not.toHaveBeenCalled();
  });

  it("paginates every private kind and deletes only old, canonically unreferenced objects", async () => {
    const rawOrphan = "raw/p1/r1/orphan";
    const rawOrphan2 = "raw/p1/r5/orphan";
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
      signal: expect.any(AbortSignal),
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      kind: "raw",
      cursor: "raw-next",
      limit: 100,
      signal: expect.any(AbortSignal),
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

  it("retains active pre-finalize and referenced completed exports while deleting safe orphans", async () => {
    const activeUpload = "export/p1/r-active/pre-finalize";
    const completedReferenced = "export/p1/r-completed/referenced";
    const failedUnreferenced = "export/p1/r-failed/unreferenced";
    const missingRun = "export/p1/r-missing/unreferenced";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export"
          ? [
              activeUpload,
              completedReferenced,
              failedUnreferenced,
              missingRun,
            ].map((key) => ({ key, createdAt: OLD }))
          : [],
      nextCursor: null,
    }));
    const fenceLookup = vi
      .mocked(
        StorageObjectReferencesRepository.prototype
          .findExportDeletionFences,
      )
      .mockResolvedValue(
        new Map([
          [activeUpload, { referenced: false, completedAt: null }],
          [
            completedReferenced,
            {
              referenced: true,
              completedAt: "2026-07-18T00:00:00.000Z",
            },
          ],
          // Failed and missing runs are deliberately absent: both are safe
          // orphan states after the immutable 24-hour storage age gate.
        ]),
      );
    const referenceLookup = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      // The single-snapshot export descriptor must retain its exact reference
      // even if a later generic reference lookup is stale or inconsistent.
      .mockResolvedValue(new Set());
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({
      eligibleCount: 4,
      referencedCount: 1,
      deletedCount: 2,
      kindFailureCount: 0,
    });

    expect(fenceLookup).toHaveBeenCalledWith([
      { key: activeUpload, projectId: "p1", runId: "r-active" },
      {
        key: completedReferenced,
        projectId: "p1",
        runId: "r-completed",
      },
      {
        key: failedUnreferenced,
        projectId: "p1",
        runId: "r-failed",
      },
      { key: missingRun, projectId: "p1", runId: "r-missing" },
    ]);
    expect(fenceLookup.mock.invocationCallOrder[0]).toBeLessThan(
      referenceLookup.mock.invocationCallOrder.at(-1)!,
    );
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([
      failedUnreferenced,
      missingRun,
    ]);
  });

  it("retains an export when finalize commits between the run fence and reference lookup", async () => {
    const racingFinalize = "export/p1/r-racing/pre-finalize";
    let canonicalStatus: "running" | "completed" = "running";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export"
          ? [{ key: racingFinalize, createdAt: OLD }]
          : [],
      nextCursor: null,
    }));
    const fenceLookup = vi
      .mocked(
        StorageObjectReferencesRepository.prototype
          .findExportDeletionFences,
      )
      .mockImplementation(async () => {
        const observedStatus = canonicalStatus;
        canonicalStatus = "completed";
        return new Map([
          [
            racingFinalize,
            {
              referenced: false,
              completedAt: observedStatus === "running" ? null : OLD,
            },
          ],
        ]);
      });
    const referenceLookup = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      // Model the narrowest race: the later reference read still does not
      // observe a key, so only the earlier active-run fence prevents deletion.
      .mockResolvedValue(new Set());
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ eligibleCount: 1, deletedCount: 0 });

    expect(canonicalStatus).toBe("completed");
    expect(fenceLookup.mock.invocationCallOrder[0]).toBeLessThan(
      referenceLookup.mock.invocationCallOrder.at(-1)!,
    );
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("rechecks a raw key and retains a reference created after staging", async () => {
    const lateReference = "raw/p1/r1/referenced-after-stage";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "raw" ? [{ key: lateReference, createdAt: OLD }] : [],
      nextCursor: null,
    }));
    let candidateLookupCount = 0;
    const referenceLookup = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      .mockImplementation(async (keys) => {
        if (!keys.includes(lateReference)) return new Set();
        candidateLookupCount += 1;
        return candidateLookupCount === 1
          ? new Set()
          : new Set([lateReference]);
      });
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ eligibleCount: 1, deletedCount: 0 });

    expect(candidateLookupCount).toBe(2);
    expect(referenceLookup).toHaveBeenCalledTimes(2);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("holds the sorted key lock across canonical recheck and external delete", async () => {
    const candidate = "raw/p1/r1/locked-delete";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects: kind === "raw" ? [{ key: candidate, createdAt: OLD }] : [],
      nextCursor: null,
    }));
    const referenceLookup = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      .mockResolvedValue(new Set());
    const keyLock = vi.mocked(
      StorageObjectReferencesRepository.prototype
        .lockObjectKeysForTransaction,
    );
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx, transaction, txExecutor } = contextWithCapturedLogger(
      list,
      deleteObject,
    );

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ deletedCount: 1, kindFailureCount: 0 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(keyLock).toHaveBeenCalledWith([candidate]);
    expect(keyLock.mock.contexts[0]).toMatchObject({ exec: txExecutor });
    expect(referenceLookup.mock.contexts.at(-1)).toMatchObject({
      exec: txExecutor,
    });
    expect(keyLock.mock.invocationCallOrder[0]).toBeLessThan(
      referenceLookup.mock.invocationCallOrder.at(-1)!,
    );
    expect(referenceLookup.mock.invocationCallOrder.at(-1)).toBeLessThan(
      deleteObject.mock.invocationCallOrder[0]!,
    );
  });

  it("does not start a late delete after aborting while the key lock is pending", async () => {
    const candidate = "raw/p1/r1/abort-during-key-lock";
    const controller = new AbortController();
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects: kind === "raw" ? [{ key: candidate, createdAt: OLD }] : [],
      nextCursor: null,
    }));
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "findReferencedKeys",
    ).mockResolvedValue(new Set());
    let releaseLock!: () => void;
    const pendingLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const keyLock = vi
      .mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      )
      .mockReturnValue(pendingLock);
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx, transaction } = contextWithCapturedLogger(list, deleteObject);

    const sweep = runOrphanCleanupSweep(ctx, {
      now: NOW,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(keyLock).toHaveBeenCalledWith([candidate]));
    const transactionPromise = transaction.mock.results[0]!.value as Promise<unknown>;
    let sweepSettled = false;
    void sweep.then(
      () => {
        sweepSettled = true;
      },
      () => {
        sweepSettled = true;
      },
    );
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sweepSettled).toBe(false);
    releaseLock();
    await transactionPromise;
    await expect(sweep).rejects.toMatchObject({ code: "ORPHAN_CLEANUP_ABORTED" });

    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("keeps the key lock until a started delete really settles after abort", async () => {
    const candidate = "raw/p1/r1/abort-during-delete";
    const controller = new AbortController();
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects: kind === "raw" ? [{ key: candidate, createdAt: OLD }] : [],
      nextCursor: null,
    }));
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "findReferencedKeys",
    ).mockResolvedValue(new Set());
    let releaseDelete!: () => void;
    const pendingDelete = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deleteObject = vi
      .fn<BlobStore["delete"]>()
      .mockReturnValue(pendingDelete);
    const { ctx, transaction } = contextWithCapturedLogger(list, deleteObject);

    let sweepSettled = false;
    const sweep = runOrphanCleanupSweep(ctx, {
      now: NOW,
      signal: controller.signal,
    });
    void sweep.then(
      () => {
        sweepSettled = true;
      },
      () => {
        sweepSettled = true;
      },
    );
    await vi.waitFor(() => expect(deleteObject).toHaveBeenCalled());
    const transactionPromise = transaction.mock.results[0]!.value as Promise<unknown>;
    let transactionSettled = false;
    void transactionPromise.finally(() => {
      transactionSettled = true;
    });

    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sweepSettled).toBe(false);
    expect(transactionSettled).toBe(false);

    releaseDelete();
    await transactionPromise;
    await expect(sweep).rejects.toMatchObject({ code: "ORPHAN_CLEANUP_ABORTED" });
    expect(deleteObject).toHaveBeenCalledWith(candidate);
  });

  it("rechecks an export descriptor and retains an exact reference created after staging", async () => {
    const lateReference = "export/p1/r-completed/referenced-after-stage";
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects:
        kind === "export" ? [{ key: lateReference, createdAt: OLD }] : [],
      nextCursor: null,
    }));
    let fenceLookupCount = 0;
    const fenceLookup = vi
      .mocked(
        StorageObjectReferencesRepository.prototype
          .findExportDeletionFences,
      )
      .mockImplementation(async () => {
        fenceLookupCount += 1;
        return new Map([
          [
            lateReference,
            {
              referenced: fenceLookupCount > 1,
              completedAt: "2026-07-17T00:00:00.000Z",
            },
          ],
        ]);
      });
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "findReferencedKeys",
    ).mockResolvedValue(new Set());
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ eligibleCount: 1, deletedCount: 0 });

    expect(fenceLookupCount).toBe(2);
    expect(fenceLookup).toHaveBeenNthCalledWith(1, [
      {
        key: lateReference,
        projectId: "p1",
        runId: "r-completed",
      },
    ]);
    expect(fenceLookup).toHaveBeenNthCalledWith(2, [
      {
        key: lateReference,
        projectId: "p1",
        runId: "r-completed",
      },
    ]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it.each(["raw", "export"] as const)(
    "fails the %s kind closed when its delete-time canonical recheck fails",
    async (kind) => {
      const candidate = `${kind}/p1/r1/delete-recheck-failure`;
      const list = vi.fn<BlobStore["list"]>(async ({ kind: listedKind }) => ({
        objects:
          listedKind === kind ? [{ key: candidate, createdAt: OLD }] : [],
        nextCursor: null,
      }));
      const referenceLookup = vi.spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      );
      const fenceLookup = vi.mocked(
        StorageObjectReferencesRepository.prototype.findExportDeletionFences,
      );
      if (kind === "raw") {
        referenceLookup
          .mockResolvedValueOnce(new Set())
          .mockRejectedValueOnce(new Error("raw-recheck-customer-secret"));
      } else {
        referenceLookup.mockResolvedValue(new Set());
        fenceLookup
          .mockResolvedValueOnce(
            new Map([
              [
                candidate,
                {
                  referenced: false,
                  completedAt: "2026-07-17T00:00:00.000Z",
                },
              ],
            ]),
          )
          .mockRejectedValueOnce(
            new Error("export-recheck-customer-secret"),
          );
      }
      const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
      const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

      await expect(
        runOrphanCleanupSweep(ctx, { now: NOW }),
      ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

      expect(deleteObject).not.toHaveBeenCalled();
      expect(JSON.stringify(lines)).not.toMatch(
        /delete-recheck-failure|recheck-customer-secret/,
      );
    },
  );

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

  it("does not delete any object from a kind when a later enumeration page fails", async () => {
    const first = "raw/p1/r1/a-customer-secret";
    const second = "raw/p1/r1/b-customer-secret";
    const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
      if (kind !== "raw") return { objects: [], nextCursor: null };
      if (cursor === null) {
        return {
          objects: [{ key: first, createdAt: OLD }],
          nextCursor: "opaque-next",
        };
      }
      if (cursor === "opaque-next") {
        throw new Error(`late-list-failure:${second}`);
      }
      throw new Error("unexpected cursor");
    });
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const findReferenced = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      .mockResolvedValue(new Set());
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

    expect(findReferenced).not.toHaveBeenCalledWith([first]);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toMatch(
      /a-customer-secret|b-customer-secret|late-list-failure/,
    );
  });

  it("does not delete from a kind when a later bounded reference chunk fails", async () => {
    const candidates = Array.from({ length: 501 }, (_, index) => ({
      key: `raw/p1/r1/${String(index).padStart(6, "0")}`,
      createdAt: OLD,
    }));
    const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
      if (kind !== "raw") return { objects: [], nextCursor: null };
      const pageIndex = cursor === null ? 0 : Number(cursor.slice(5));
      const start = pageIndex * ORPHAN_CLEANUP_PAGE_SIZE;
      const objects = candidates.slice(
        start,
        start + ORPHAN_CLEANUP_PAGE_SIZE,
      );
      return {
        objects,
        nextCursor:
          start + objects.length < candidates.length
            ? `page-${pageIndex + 1}`
            : null,
      };
    });
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const findReferenced = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      .mockResolvedValueOnce(new Set())
      .mockRejectedValueOnce(
        new Proxy(
          {},
          {
            get() {
              throw new Error("reference-error-customer-secret");
            },
          },
        ),
      );
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

    expect(findReferenced).toHaveBeenCalledTimes(2);
    expect(findReferenced.mock.calls.every(([keys]) => keys.length <= 500)).toBe(
      true,
    );
    expect(deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toContain("customer-secret");
  });

  it.each([
    {
      capacity: "objects" as const,
      options: { maxObjectsPerKind: 1, maxCandidatesPerKind: 10 },
      createdAt: YOUNG,
    },
    {
      capacity: "candidates" as const,
      options: { maxObjectsPerKind: 10, maxCandidatesPerKind: 1 },
      createdAt: OLD,
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
      const findReferenced = vi
        .spyOn(
          StorageObjectReferencesRepository.prototype,
          "findReferencedKeys",
        )
        .mockResolvedValue(new Set());
      const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

      await expect(
        runOrphanCleanupSweep(ctx, { now: NOW, ...options }),
      ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

      expect(findReferenced).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
      expect(lines).toContainEqual({
        level: "error",
        event: "orphan_cleanup_capacity_exceeded",
        fields: {
          code: "ORPHAN_CLEANUP_CAPACITY_EXCEEDED",
          kind: "raw",
          capacity,
        },
      });
      expect(JSON.stringify(lines)).not.toContain("secret");
    },
  );

  it("fails a kind closed with fixed metadata when its page cap is exhausted", async () => {
    const list = vi.fn<BlobStore["list"]>(async ({ kind }) => ({
      objects: [],
      nextCursor: kind === "raw" ? "another-page" : null,
    }));
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const findReferenced = vi
      .spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      )
      .mockResolvedValue(new Set());
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW, maxPagesPerKind: 1 }),
    ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 1 });

    expect(findReferenced).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(lines).toContainEqual({
      level: "error",
      event: "orphan_cleanup_capacity_exceeded",
      fields: {
        code: "ORPHAN_CLEANUP_CAPACITY_EXCEEDED",
        kind: "raw",
        capacity: "pages",
      },
    });
  });

  it("rejects oversize pages and cursor loops without deleting or leaking cursor/key details", async () => {
    const secretKey = "raw-import/p1/r1/cursor-loop-secret";
    const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
      if (kind === "raw") {
        return {
          objects: Array.from(
            { length: ORPHAN_CLEANUP_PAGE_SIZE + 1 },
            (_, index) => ({
              key: `raw/p1/r1/${String(index).padStart(6, "0")}`,
              createdAt: OLD,
            }),
          ),
          nextCursor: null,
        };
      }
      if (kind === "raw-import") {
        return {
          objects:
            cursor === null ? [{ key: secretKey, createdAt: OLD }] : [],
          nextCursor: cursor === null ? "opaque-secret" : "opaque-secret",
        };
      }
      if (kind === "snapshot-raw") {
        return {
          objects: [],
          nextCursor: 42 as unknown as string,
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

    await expect(
      runOrphanCleanupSweep(ctx, { now: NOW }),
    ).resolves.toMatchObject({ deletedCount: 0, kindFailureCount: 3 });

    expect(deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toMatch(
      /cursor-loop-secret|opaque-secret/,
    );
  });

  it(
    "enumerates 100k synthetic objects through a 0600 spool and bounded reference chunks",
    async () => {
      const spoolParent = await mkdtemp(join(tmpdir(), "sf-orphan-test-"));
      const total = 100_000;
      const pageCount = Math.ceil(total / ORPHAN_CLEANUP_PAGE_SIZE);
      let largestReferenceChunk = 0;
      let observedSpoolMode: number | undefined;
      const list = vi.fn<BlobStore["list"]>(async ({ kind, cursor }) => {
        if (kind !== "raw") return { objects: [], nextCursor: null };
        const pageIndex =
          cursor === null ? 0 : Number(cursor.replace("page-", ""));
        const start = pageIndex * ORPHAN_CLEANUP_PAGE_SIZE;
        const length = Math.min(ORPHAN_CLEANUP_PAGE_SIZE, total - start);
        return {
          objects: Array.from({ length }, (_, offset) => ({
            key: `raw/p1/r1/${String(start + offset).padStart(6, "0")}`,
            createdAt: OLD,
          })),
          nextCursor:
            pageIndex + 1 < pageCount ? `page-${pageIndex + 1}` : null,
        };
      });
      vi.spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      ).mockImplementation(async (keys) => {
        largestReferenceChunk = Math.max(largestReferenceChunk, keys.length);
        if (observedSpoolMode === undefined) {
          const directories = await readdir(spoolParent);
          const files = await readdir(join(spoolParent, directories[0]!));
          observedSpoolMode =
            (await stat(join(spoolParent, directories[0]!, files[0]!))).mode &
            0o777;
        }
        return new Set(keys);
      });
      const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
      const { ctx } = contextWithCapturedLogger(list, deleteObject);

      try {
        await expect(
          runOrphanCleanupSweep(ctx, {
            now: NOW,
            spoolDirectory: spoolParent,
            maxObjectsPerKind: total,
            maxCandidatesPerKind: total,
            deadlineMs: 30_000,
          }),
        ).resolves.toMatchObject({
          scannedCount: total,
          eligibleCount: total,
          referencedCount: total,
          deletedCount: 0,
          kindFailureCount: 0,
        });

        expect(list).toHaveBeenCalledTimes(pageCount + 3);
        expect(largestReferenceChunk).toBeLessThanOrEqual(500);
        expect(observedSpoolMode).toBe(0o600);
        expect(await readdir(spoolParent)).toEqual([]);
        expect(deleteObject).not.toHaveBeenCalled();
      } finally {
        await rm(spoolParent, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it("bounds delete concurrency and does not cancel a delete after it starts", async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      key: `raw/p1/r1/${String(index).padStart(2, "0")}`,
      createdAt: OLD,
    }));
    let activeDeletes = 0;
    let maxActiveDeletes = 0;
    const releases: Array<() => void> = [];
    const listSignals: AbortSignal[] = [];
    const list = vi.fn<BlobStore["list"]>(async (input) => {
      const signal = (input as typeof input & { signal?: AbortSignal }).signal;
      if (signal) listSignals.push(signal);
      return {
        objects: input.kind === "raw" ? candidates : [],
        nextCursor: null,
      };
    });
    const deleteObject = vi.fn(async () => {
      activeDeletes += 1;
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
      await new Promise<void>((resolve) => releases.push(resolve));
      activeDeletes -= 1;
    }) as BlobStore["delete"] & ReturnType<typeof vi.fn>;
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "findReferencedKeys",
    ).mockResolvedValue(new Set());
    const { ctx } = contextWithCapturedLogger(list, deleteObject);

    const sweep = runOrphanCleanupSweep(ctx, {
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
    expect(new Set(listSignals).size).toBe(1);
    expect(deleteObject.mock.calls.every((args) => args.length === 1)).toBe(true);
  });

  it("aborts a never-settling list at the single sweep deadline with zero deletes", async () => {
    vi.useFakeTimers();
    const list = vi.fn<BlobStore["list"]>(
      () => new Promise<BlobListPage>(() => undefined),
    );
    const deleteObject = vi.fn<BlobStore["delete"]>(async () => undefined);
    const { ctx, lines } = contextWithCapturedLogger(list, deleteObject);

    const sweep = runOrphanCleanupSweep(ctx, {
      now: NOW,
      deadlineMs: 50,
    });
    const rejected = expect(sweep).rejects.toMatchObject({
      code: "ORPHAN_CLEANUP_ABORTED",
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;

    expect(deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toContain("customer");
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

  it("aborts and stops within its own deadline when injected cleanup never settles", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn(
      (_signal: AbortSignal) => new Promise<void>(() => undefined),
    );
    const { ctx } = contextWithCapturedLogger(
      vi.fn<BlobStore["list"]>(async () => ({ objects: [], nextCursor: null })),
      vi.fn<BlobStore["delete"]>(async () => undefined),
    );
    const loop = startOrphanCleanupLoop(ctx, {
      intervalMs: 1_000,
      sweepTimeoutMs: 60_000,
      stopTimeoutMs: 50,
      cleanup,
    });
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);

    const stop = loop.stop();
    await vi.advanceTimersByTimeAsync(50);
    await expect(stop).resolves.toBeUndefined();
    await expect(loop.stop()).resolves.toBeUndefined();
  });

  it.each(["list", "delete"] as const)(
    "stops without waiting for a never-settling storage %s operation",
    async (operation) => {
      vi.useFakeTimers();
      const candidate = "raw/p1/r1/never-settles";
      const list = vi.fn<BlobStore["list"]>(async ({ kind }) => {
        if (operation === "list" && kind === "raw") {
          return new Promise<BlobListPage>(() => undefined);
        }
        return {
          objects:
            operation === "delete" && kind === "raw"
              ? [{ key: candidate, createdAt: OLD }]
              : [],
          nextCursor: null,
        };
      });
      const deleteObject = vi.fn<BlobStore["delete"]>(
        () => new Promise<void>(() => undefined),
      );
      vi.spyOn(
        StorageObjectReferencesRepository.prototype,
        "findReferencedKeys",
      ).mockResolvedValue(new Set());
      const { ctx } = contextWithCapturedLogger(list, deleteObject);
      const loop = startOrphanCleanupLoop(ctx, {
        intervalMs: 60_000,
        sweepTimeoutMs: 60_000,
        stopTimeoutMs: 50,
        cleanup: async (signal) => {
          await runOrphanCleanupSweep(ctx, {
            now: NOW,
            deadlineMs: 60_000,
            signal,
          });
        },
      });
      await vi.waitFor(() => {
        if (operation === "list") {
          expect(list).toHaveBeenCalled();
        } else {
          expect(deleteObject).toHaveBeenCalledTimes(1);
        }
      });

      const stop = loop.stop();
      await vi.advanceTimersByTimeAsync(50);
      await expect(stop).resolves.toBeUndefined();
    },
  );
});

function contextWithCapturedLogger(
  list: BlobStore["list"],
  deleteObject: BlobStore["delete"],
): {
  readonly ctx: WorkerContext;
  readonly transaction: ReturnType<typeof vi.fn>;
  readonly txExecutor: object;
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
  const txExecutor = { role: "orphan-cleanup-key-lock-transaction" };
  const transaction = vi.fn(
    async (callback: (tx: object) => Promise<unknown>) => callback(txExecutor),
  );
  return {
    ctx: {
      db: { transaction } as unknown as WorkerContext["db"],
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
    transaction,
    txExecutor,
    lines,
  };
}
