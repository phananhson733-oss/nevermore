import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import {
  EXPORT_OBJECT_RETENTION_MS,
  RAW_OBJECT_RETENTION_MS,
  StorageObjectReferencesRepository,
  isStorageObjectExpired,
} from "@sf/db";
import {
  PRIVATE_BLOB_OBJECT_KINDS,
  parseObjectKey,
  type BlobListInput,
  type BlobListPage,
  type PrivateBlobObjectKind,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";

export {
  EXPORT_OBJECT_RETENTION_MS,
  RAW_OBJECT_RETENTION_MS,
} from "@sf/db";

export const RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const RETENTION_CLEANUP_PAGE_SIZE = 100;
export const RETENTION_CLEANUP_MAX_OBJECTS_PER_KIND = 100_000;
export const RETENTION_CLEANUP_MAX_EXPIRED_PER_KIND = 100_000;
export const RETENTION_CLEANUP_MAX_PAGES_PER_KIND = 2_000;
export const RETENTION_CLEANUP_DELETE_CONCURRENCY = 4;
export const RETENTION_CLEANUP_SWEEP_TIMEOUT_MS = 5 * 60 * 1_000;
export const RETENTION_CLEANUP_STOP_TIMEOUT_MS = 5_000;

const RETENTION_CLEANUP_MAX_KEY_BYTES = 1_024;
const RETENTION_CLEANUP_MAX_CURSOR_BYTES = 4_096;
const RETENTION_CLEANUP_SPOOL_BUFFER_BYTES = 64 * 1_024;

const RETENTION_MS_BY_KIND: Readonly<
  Record<PrivateBlobObjectKind, number>
> = {
  raw: RAW_OBJECT_RETENTION_MS,
  "raw-import": RAW_OBJECT_RETENTION_MS,
  "snapshot-raw": RAW_OBJECT_RETENTION_MS,
  export: EXPORT_OBJECT_RETENTION_MS,
};

export interface RetentionCleanupSummary {
  readonly scannedCount: number;
  readonly expiredCount: number;
  readonly deletedCount: number;
  readonly deleteFailureCount: number;
  readonly kindFailureCount: number;
}

export interface RetentionCleanupSweepOptions {
  readonly now?: Date;
  readonly deadlineMs?: number;
  readonly maxObjectsPerKind?: number;
  readonly maxExpiredPerKind?: number;
  readonly maxPagesPerKind?: number;
  readonly spoolDirectory?: string;
  readonly signal?: AbortSignal;
}

export interface RetentionCleanupLoopOptions {
  readonly intervalMs?: number;
  readonly sweepTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly cleanup?: (signal: AbortSignal) => Promise<void>;
}

export interface RetentionCleanupLoop {
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

interface AbortAwareBlobStore {
  list(
    input: BlobListInput & { readonly signal: AbortSignal },
  ): Promise<BlobListPage>;
  delete(
    key: string,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}

type OperationResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "failed" }
  | { readonly status: "aborted" };

type CollectionResult =
  | { readonly status: "completed"; readonly expiredCount: number }
  | {
      readonly status: "capacity";
      readonly capacity: "objects" | "expired" | "pages";
    }
  | { readonly status: "failed" }
  | { readonly status: "aborted" };

type DeleteResult =
  | {
      readonly status: "completed";
      readonly deletedCount: number;
      readonly deleteFailureCount: number;
    }
  | { readonly status: "failed" }
  | { readonly status: "aborted" };

class StorageRetentionExecutionError extends Error {
  readonly code: "STORAGE_RETENTION_ABORTED" | "STORAGE_RETENTION_SWEEP_FAILED";

  constructor(
    code: "STORAGE_RETENTION_ABORTED" | "STORAGE_RETENTION_SWEEP_FAILED",
  ) {
    super(
      code === "STORAGE_RETENTION_ABORTED"
        ? "storage retention cleanup aborted"
        : "storage retention cleanup failed",
    );
    this.name = "StorageRetentionExecutionError";
    this.code = code;
  }
}

class BoundedSpoolWriter {
  readonly #handle: FileHandle;
  readonly #lines: string[] = [];
  #bufferBytes = 0;

  constructor(handle: FileHandle) {
    this.#handle = handle;
  }

  async writeKey(key: string): Promise<void> {
    const line = `${key}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (
      this.#bufferBytes > 0 &&
      this.#bufferBytes + lineBytes > RETENTION_CLEANUP_SPOOL_BUFFER_BYTES
    ) {
      await this.flush();
    }
    this.#lines.push(line);
    this.#bufferBytes += lineBytes;
  }

  async flush(): Promise<void> {
    if (this.#lines.length === 0) return;
    await this.#handle.writeFile(this.#lines.join(""), "utf8");
    this.#lines.length = 0;
    this.#bufferBytes = 0;
  }
}

/**
 * Enforce fixed 90/30-day object-byte lifecycles without retaining an unbounded
 * object set in memory. Every kind is fully validated into a private spool
 * before its first delete, so later list/protocol failures remain fail closed.
 */
export async function runRetentionCleanupSweep(
  ctx: WorkerContext,
  options: RetentionCleanupSweepOptions = {},
): Promise<RetentionCleanupSummary> {
  const deadlineMs = positiveSafeInteger(
    "storage retention cleanup deadline",
    options.deadlineMs ?? RETENTION_CLEANUP_SWEEP_TIMEOUT_MS,
  );
  const maxObjectsPerKind = positiveSafeInteger(
    "storage retention object capacity",
    options.maxObjectsPerKind ?? RETENTION_CLEANUP_MAX_OBJECTS_PER_KIND,
  );
  const maxExpiredPerKind = positiveSafeInteger(
    "storage retention expired capacity",
    options.maxExpiredPerKind ?? RETENTION_CLEANUP_MAX_EXPIRED_PER_KIND,
  );
  const maxPagesPerKind = positiveSafeInteger(
    "storage retention page capacity",
    options.maxPagesPerKind ?? RETENTION_CLEANUP_MAX_PAGES_PER_KIND,
  );
  const spoolRoot = options.spoolDirectory ?? tmpdir();
  if (!isAbsolute(spoolRoot)) {
    throw new RangeError("storage retention spool directory must be absolute");
  }
  const suppliedNowMs =
    options.now === undefined
      ? undefined
      : validDateMilliseconds(
          options.now,
          "storage retention database clock must be a valid date",
        );
  const scope = createAbortScope(deadlineMs, options.signal);
  const abortedError = new StorageRetentionExecutionError(
    "STORAGE_RETENTION_ABORTED",
  );
  const failedError = new StorageRetentionExecutionError(
    "STORAGE_RETENTION_SWEEP_FAILED",
  );
  let spoolPath: string | undefined;
  let summary: RetentionCleanupSummary | undefined;
  let terminalError: StorageRetentionExecutionError | undefined;

  try {
    if (scope.signal.aborted) throw abortedError;
    spoolPath = await mkdtemp(join(spoolRoot, "sf-retention-cleanup-"));
    if (scope.signal.aborted) throw abortedError;

    let nowMs = suppliedNowMs;
    if (nowMs === undefined) {
      const databaseClock = await observeOperation(
        () => new StorageObjectReferencesRepository(ctx.db).databaseNow(),
        scope.signal,
      );
      if (databaseClock.status === "aborted") throw abortedError;
      if (databaseClock.status === "failed") throw failedError;
      try {
        nowMs = validDateMilliseconds(
          databaseClock.value,
          "storage retention database clock must be a valid date",
        );
      } catch {
        throw failedError;
      }
    }
    const now = new Date(nowMs);
    const mutable = {
      scannedCount: 0,
      expiredCount: 0,
      deletedCount: 0,
      deleteFailureCount: 0,
      kindFailureCount: 0,
    };
    const blobStore = ctx.blobStore as typeof ctx.blobStore &
      AbortAwareBlobStore;

    for (const kind of PRIVATE_BLOB_OBJECT_KINDS) {
      const expiredPath = join(spoolPath, `${kind}.expired`);
      const collection = await collectExpiredObjects({
        blobStore,
        kind,
        now,
        expiredPath,
        maxObjectsPerKind,
        maxExpiredPerKind,
        maxPagesPerKind,
        signal: scope.signal,
        counts: mutable,
      });
      if (collection.status === "aborted") throw abortedError;
      if (collection.status === "capacity") {
        mutable.kindFailureCount += 1;
        ctx.logger.error("retention_cleanup_capacity_exceeded", {
          code: "STORAGE_RETENTION_CAPACITY_EXCEEDED",
          kind,
          capacity: collection.capacity,
        });
        continue;
      }
      if (collection.status === "failed") {
        reportKindFailure(ctx, kind);
        mutable.kindFailureCount += 1;
        continue;
      }

      mutable.expiredCount += collection.expiredCount;
      if (collection.expiredCount === 0) continue;
      const deleteResult = await deleteStagedKeys({
        blobStore,
        expiredPath,
        kind,
        now,
        signal: scope.signal,
        ctx,
      });
      if (deleteResult.status === "aborted") throw abortedError;
      if (deleteResult.status === "failed") {
        reportKindFailure(ctx, kind);
        mutable.kindFailureCount += 1;
        continue;
      }
      mutable.deletedCount += deleteResult.deletedCount;
      mutable.deleteFailureCount += deleteResult.deleteFailureCount;
    }

    if (scope.signal.aborted) throw abortedError;
    summary = { ...mutable };
  } catch (error) {
    if (error === abortedError) {
      terminalError = abortedError;
    } else if (error === failedError) {
      terminalError = failedError;
    } else {
      terminalError = new StorageRetentionExecutionError(
        "STORAGE_RETENTION_SWEEP_FAILED",
      );
    }
  } finally {
    if (spoolPath !== undefined) {
      try {
        await rm(spoolPath, { recursive: true, force: true });
      } catch {
        ctx.logger.error("retention_cleanup_spool_cleanup_failed", {
          code: "STORAGE_RETENTION_SPOOL_CLEANUP_FAILED",
        });
        terminalError ??= new StorageRetentionExecutionError(
          "STORAGE_RETENTION_SWEEP_FAILED",
        );
      }
    }
    if (scope.signal.aborted && terminalError === undefined) {
      terminalError = abortedError;
    }
    scope.dispose();
  }

  if (terminalError !== undefined) throw terminalError;
  ctx.logger.info("retention_cleanup_completed", { ...summary! });
  return summary!;
}

async function collectExpiredObjects(input: {
  readonly blobStore: AbortAwareBlobStore;
  readonly kind: PrivateBlobObjectKind;
  readonly now: Date;
  readonly expiredPath: string;
  readonly maxObjectsPerKind: number;
  readonly maxExpiredPerKind: number;
  readonly maxPagesPerKind: number;
  readonly signal: AbortSignal;
  readonly counts: { scannedCount: number };
}): Promise<CollectionResult> {
  let handle: FileHandle | undefined;
  try {
    handle = await openPrivateSpool(input.expiredPath);
    const writer = new BoundedSpoolWriter(handle);
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let lastKey: string | null = null;
    let objectCount = 0;
    let expiredCount = 0;
    let pageCount = 0;

    while (true) {
      if (input.signal.aborted) return { status: "aborted" };
      if (pageCount >= input.maxPagesPerKind) {
        return { status: "capacity", capacity: "pages" };
      }
      pageCount += 1;
      const listed = await observeOperation(
        () =>
          input.blobStore.list({
            kind: input.kind,
            cursor,
            limit: RETENTION_CLEANUP_PAGE_SIZE,
            signal: input.signal,
          }),
        input.signal,
      );
      if (listed.status !== "completed") return listed;

      let objects: BlobListPage["objects"];
      let nextCursor: unknown;
      try {
        if (
          typeof listed.value !== "object" ||
          listed.value === null ||
          !Array.isArray(listed.value.objects) ||
          listed.value.objects.length > RETENTION_CLEANUP_PAGE_SIZE
        ) {
          return { status: "failed" };
        }
        objects = listed.value.objects;
        nextCursor = listed.value.nextCursor;
      } catch {
        return { status: "failed" };
      }

      input.counts.scannedCount += objects.length;
      if (objectCount + objects.length > input.maxObjectsPerKind) {
        return { status: "capacity", capacity: "objects" };
      }
      objectCount += objects.length;

      for (const object of objects) {
        let key: string;
        let createdAt: string;
        try {
          if (typeof object !== "object" || object === null) {
            return { status: "failed" };
          }
          key = object.key;
          createdAt = object.createdAt;
        } catch {
          return { status: "failed" };
        }
        if (
          typeof key !== "string" ||
          Buffer.byteLength(key) > RETENTION_CLEANUP_MAX_KEY_BYTES ||
          typeof createdAt !== "string" ||
          (lastKey !== null && key <= lastKey)
        ) {
          return { status: "failed" };
        }
        let expired: boolean;
        try {
          if (parseObjectKey(key).kind !== input.kind) {
            return { status: "failed" };
          }
          expired = isStorageObjectExpired(
            createdAt,
            input.now,
            RETENTION_MS_BY_KIND[input.kind],
          );
        } catch {
          return { status: "failed" };
        }
        lastKey = key;
        if (expired) {
          if (expiredCount >= input.maxExpiredPerKind) {
            return { status: "capacity", capacity: "expired" };
          }
          expiredCount += 1;
          await writer.writeKey(key);
        }
      }

      if (nextCursor === null) {
        await writer.flush();
        await handle.close();
        handle = undefined;
        return { status: "completed", expiredCount };
      }
      if (
        typeof nextCursor !== "string" ||
        nextCursor.length === 0 ||
        Buffer.byteLength(nextCursor) > RETENTION_CLEANUP_MAX_CURSOR_BYTES ||
        nextCursor === cursor ||
        seenCursors.has(nextCursor)
      ) {
        return { status: "failed" };
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
  } catch {
    return input.signal.aborted ? { status: "aborted" } : { status: "failed" };
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
  }
}

async function deleteStagedKeys(input: {
  readonly blobStore: AbortAwareBlobStore;
  readonly expiredPath: string;
  readonly kind: PrivateBlobObjectKind;
  readonly now: Date;
  readonly signal: AbortSignal;
  readonly ctx: WorkerContext;
}): Promise<DeleteResult> {
  let deletedCount = 0;
  let deleteFailureCount = 0;
  const references = new StorageObjectReferencesRepository(input.ctx.db);
  try {
    for await (const keys of readKeyChunks(
      input.expiredPath,
      RETENTION_CLEANUP_DELETE_CONCURRENCY,
      input.signal,
    )) {
      let deletableKeys = keys;
      if (input.kind === "export") {
        const candidates = keys.map((key) => {
          const parsed = parseObjectKey(key);
          return {
            key,
            projectId: parsed.projectId,
            runId: parsed.runId,
          };
        });
        const lookup = await observeOperation(
          () => references.findExportDeletionFences(candidates),
          input.signal,
        );
        if (lookup.status === "aborted") return { status: "aborted" };
        if (lookup.status === "failed") return { status: "failed" };
        deletableKeys = keys.filter((key) => {
          const fence = lookup.value.get(key);
          if (fence === undefined) return true;
          return (
            fence.completedAt !== null &&
            isStorageObjectExpired(
              fence.completedAt,
              input.now,
              EXPORT_OBJECT_RETENTION_MS,
            )
          );
        });
      }
      const results = await Promise.all(
        deletableKeys.map((key) =>
          observeOperation(
            () => input.blobStore.delete(key, { signal: input.signal }),
            input.signal,
          ),
        ),
      );
      for (const result of results) {
        if (result.status === "aborted") return { status: "aborted" };
        if (result.status === "failed") {
          deleteFailureCount += 1;
          input.ctx.logger.error("retention_cleanup_delete_failed", {
            code: "STORAGE_RETENTION_DELETE_FAILED",
            kind: input.kind,
          });
        } else {
          deletedCount += 1;
        }
      }
    }
    return { status: "completed", deletedCount, deleteFailureCount };
  } catch {
    return input.signal.aborted ? { status: "aborted" } : { status: "failed" };
  }
}

async function* readKeyChunks(
  path: string,
  chunkSize: number,
  signal: AbortSignal,
): AsyncGenerator<string[]> {
  const stream = createReadStream(path, { encoding: "utf8", signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let chunk: string[] = [];
  try {
    for await (const line of lines) {
      if (signal.aborted) return;
      if (line.length === 0) throw new Error("invalid retention cleanup spool");
      chunk.push(line);
      if (chunk.length === chunkSize) {
        yield chunk;
        chunk = [];
      }
    }
    if (chunk.length > 0) yield chunk;
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function openPrivateSpool(path: string): Promise<FileHandle> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

function observeOperation<T>(
  operation: () => Promise<T> | T,
  signal: AbortSignal,
): Promise<OperationResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: OperationResult<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ status: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(operation());
    } catch {
      finish({ status: "failed" });
      return;
    }
    void pending.then(
      (value) => finish({ status: "completed", value }),
      () => finish({ status: "failed" }),
    );
  });
}

function createAbortScope(
  deadlineMs: number,
  externalSignal: AbortSignal | undefined,
): {
  readonly signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, deadlineMs);
  timer.unref();
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted) abort();
  return {
    signal: controller.signal,
    dispose(): void {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    },
  };
}

function reportKindFailure(
  ctx: WorkerContext,
  kind: PrivateBlobObjectKind,
): void {
  ctx.logger.error("retention_cleanup_kind_failed", {
    code: "STORAGE_RETENTION_KIND_FAILED",
    kind,
  });
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function validDateMilliseconds(value: Date, message: string): number {
  let milliseconds: number;
  try {
    milliseconds = value.getTime();
  } catch {
    throw new RangeError(message);
  }
  if (!Number.isFinite(milliseconds)) throw new RangeError(message);
  return milliseconds;
}

/** Start an immediate sweep and retry every 24 hours. */
export function startRetentionCleanupLoop(
  ctx: WorkerContext,
  options: RetentionCleanupLoopOptions = {},
): RetentionCleanupLoop {
  const intervalMs = positiveSafeInteger(
    "storage retention cleanup interval",
    options.intervalMs ?? RETENTION_CLEANUP_INTERVAL_MS,
  );
  const sweepTimeoutMs = positiveSafeInteger(
    "storage retention cleanup sweep timeout",
    options.sweepTimeoutMs ?? RETENTION_CLEANUP_SWEEP_TIMEOUT_MS,
  );
  const stopTimeoutMs = positiveSafeInteger(
    "storage retention cleanup stop timeout",
    options.stopTimeoutMs ?? RETENTION_CLEANUP_STOP_TIMEOUT_MS,
  );
  const cleanup =
    options.cleanup ??
    (async (signal: AbortSignal) => {
      await runRetentionCleanupSweep(ctx, {
        deadlineMs: sweepTimeoutMs,
        signal,
      });
    });
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let stopPromise: Promise<void> | null = null;

  const reportFailure = (): void => {
    ctx.logger.error("retention_cleanup_failed", {
      code: "STORAGE_RETENTION_SWEEP_FAILED",
    });
  };

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), sweepTimeoutMs);
    timeout.unref();
    const current = observeOperation(
      () => cleanup(controller.signal),
      controller.signal,
    )
      .then((result) => {
        if (
          result.status === "failed" ||
          (result.status === "aborted" && !stopped)
        ) {
          reportFailure();
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (inFlight === current) inFlight = null;
        if (activeController === controller) activeController = null;
      });
    inFlight = current;
    return current;
  };
  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  timer.unref();
  void runNow();

  const stop = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise;
    stopped = true;
    clearInterval(timer);
    activeController?.abort();
    const pending = inFlight;
    stopPromise =
      pending === null
        ? Promise.resolve()
        : waitForPromise(pending, stopTimeoutMs);
    return stopPromise;
  };

  return { runNow, stop };
}

async function waitForPromise(
  pending: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
