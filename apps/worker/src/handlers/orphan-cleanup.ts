import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { StorageObjectReferencesRepository } from "@sf/db";
import {
  PRIVATE_BLOB_OBJECT_KINDS,
  parseObjectKey,
  type BlobListInput,
  type BlobListPage,
  type PrivateBlobObjectKind,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";

export const ORPHAN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const ORPHAN_CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1_000;
export const ORPHAN_CLEANUP_PAGE_SIZE = 100;
export const ORPHAN_CLEANUP_MAX_OBJECTS_PER_KIND = 100_000;
export const ORPHAN_CLEANUP_MAX_CANDIDATES_PER_KIND = 100_000;
export const ORPHAN_CLEANUP_MAX_PAGES_PER_KIND = 2_000;
export const ORPHAN_CLEANUP_REFERENCE_CHUNK_SIZE = 500;
export const ORPHAN_CLEANUP_DELETE_CONCURRENCY = 4;
export const ORPHAN_CLEANUP_SWEEP_TIMEOUT_MS = 5 * 60 * 1_000;
export const ORPHAN_CLEANUP_STOP_TIMEOUT_MS = 5_000;

const ORPHAN_CLEANUP_MAX_KEY_BYTES = 1_024;
const ORPHAN_CLEANUP_MAX_CURSOR_BYTES = 4_096;
const ORPHAN_CLEANUP_SPOOL_BUFFER_BYTES = 64 * 1_024;

export interface OrphanCleanupSummary {
  readonly scannedCount: number;
  readonly eligibleCount: number;
  readonly referencedCount: number;
  readonly deletedCount: number;
  readonly deleteFailureCount: number;
  readonly kindFailureCount: number;
}

export interface OrphanCleanupSweepOptions {
  readonly now?: Date;
  readonly minAgeMs?: number;
  readonly deadlineMs?: number;
  readonly maxObjectsPerKind?: number;
  readonly maxCandidatesPerKind?: number;
  readonly maxPagesPerKind?: number;
  readonly spoolDirectory?: string;
  readonly signal?: AbortSignal;
}

export interface OrphanCleanupLoopOptions {
  readonly intervalMs?: number;
  readonly sweepTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly cleanup?: (signal: AbortSignal) => Promise<void>;
}

export interface OrphanCleanupLoop {
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

interface AbortAwareBlobStore {
  list(
    input: BlobListInput & { readonly signal: AbortSignal },
  ): Promise<BlobListPage>;
  delete(
    key: string,
    options?: { readonly signal: AbortSignal },
  ): Promise<void>;
}

type OperationResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "failed" }
  | { readonly status: "aborted" };

type CollectionResult =
  | {
      readonly status: "completed";
      readonly candidateCount: number;
    }
  | {
      readonly status: "capacity";
      readonly capacity: "objects" | "candidates" | "pages";
    }
  | { readonly status: "failed" }
  | { readonly status: "aborted" };

type ReferenceResult =
  | { readonly status: "completed"; readonly referencedCount: number }
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

class OrphanCleanupExecutionError extends Error {
  readonly code: "ORPHAN_CLEANUP_ABORTED" | "ORPHAN_CLEANUP_SWEEP_FAILED";

  constructor(
    code: "ORPHAN_CLEANUP_ABORTED" | "ORPHAN_CLEANUP_SWEEP_FAILED",
  ) {
    super(code === "ORPHAN_CLEANUP_ABORTED" ? "orphan cleanup aborted" : "orphan cleanup failed");
    this.name = "OrphanCleanupExecutionError";
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
      this.#bufferBytes + lineBytes > ORPHAN_CLEANUP_SPOOL_BUFFER_BYTES
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
 * Compare old private objects against every canonical object-key column.
 * A kind is completely enumerated into a bounded, owner-only spool, and every
 * reference query completes into a second spool, before its first delete.
 */
export async function runOrphanCleanupSweep(
  ctx: WorkerContext,
  options: OrphanCleanupSweepOptions = {},
): Promise<OrphanCleanupSummary> {
  const minAgeMs = options.minAgeMs ?? ORPHAN_CLEANUP_MIN_AGE_MS;
  if (!Number.isFinite(minAgeMs) || minAgeMs < ORPHAN_CLEANUP_MIN_AGE_MS) {
    throw new RangeError("orphan cleanup minimum age must be at least 24 hours");
  }
  const deadlineMs = positiveSafeInteger(
    "orphan cleanup deadline",
    options.deadlineMs ?? ORPHAN_CLEANUP_SWEEP_TIMEOUT_MS,
  );
  const maxObjectsPerKind = positiveSafeInteger(
    "orphan cleanup object capacity",
    options.maxObjectsPerKind ?? ORPHAN_CLEANUP_MAX_OBJECTS_PER_KIND,
  );
  const maxCandidatesPerKind = positiveSafeInteger(
    "orphan cleanup candidate capacity",
    options.maxCandidatesPerKind ?? ORPHAN_CLEANUP_MAX_CANDIDATES_PER_KIND,
  );
  const maxPagesPerKind = positiveSafeInteger(
    "orphan cleanup page capacity",
    options.maxPagesPerKind ?? ORPHAN_CLEANUP_MAX_PAGES_PER_KIND,
  );
  const spoolRoot = options.spoolDirectory ?? tmpdir();
  if (!isAbsolute(spoolRoot)) {
    throw new RangeError("orphan cleanup spool directory must be absolute");
  }
  const suppliedNowMs =
    options.now === undefined
      ? undefined
      : validDateMilliseconds(options.now, "orphan cleanup now must be a valid date");
  const scope = createAbortScope(deadlineMs, options.signal);
  const abortedError = new OrphanCleanupExecutionError(
    "ORPHAN_CLEANUP_ABORTED",
  );
  const failedError = new OrphanCleanupExecutionError(
    "ORPHAN_CLEANUP_SWEEP_FAILED",
  );
  let spoolPath: string | undefined;
  let summary: OrphanCleanupSummary | undefined;
  let terminalError: OrphanCleanupExecutionError | undefined;

  try {
    if (scope.signal.aborted) throw abortedError;
    spoolPath = await mkdtemp(join(spoolRoot, "sf-orphan-cleanup-"));
    if (scope.signal.aborted) throw abortedError;

    const references = new StorageObjectReferencesRepository(ctx.db);
    let nowMs = suppliedNowMs;
    if (nowMs === undefined) {
      const databaseClock = await observeOperation(
        () => references.databaseNow(),
        scope.signal,
      );
      if (databaseClock.status === "aborted") throw abortedError;
      if (databaseClock.status === "failed") throw failedError;
      try {
        nowMs = validDateMilliseconds(
          databaseClock.value,
          "canonical database returned an invalid clock value",
        );
      } catch {
        throw failedError;
      }
    }
    const cutoffMs = nowMs - minAgeMs;
    const mutable = {
      scannedCount: 0,
      eligibleCount: 0,
      referencedCount: 0,
      deletedCount: 0,
      deleteFailureCount: 0,
      kindFailureCount: 0,
    };
    const blobStore = ctx.blobStore as typeof ctx.blobStore &
      AbortAwareBlobStore;

    for (const kind of PRIVATE_BLOB_OBJECT_KINDS) {
      const candidatePath = join(spoolPath, `${kind}.candidates`);
      const deletionPath = join(spoolPath, `${kind}.deletions`);
      const collection = await collectEligibleObjects({
        blobStore,
        kind,
        cutoffMs,
        candidatePath,
        maxObjectsPerKind,
        maxCandidatesPerKind,
        maxPagesPerKind,
        signal: scope.signal,
        counts: mutable,
      });
      if (collection.status === "aborted") throw abortedError;
      if (collection.status === "capacity") {
        mutable.kindFailureCount += 1;
        ctx.logger.error("orphan_cleanup_capacity_exceeded", {
          code: "ORPHAN_CLEANUP_CAPACITY_EXCEEDED",
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

      mutable.eligibleCount += collection.candidateCount;
      if (collection.candidateCount === 0) continue;
      const referenceResult = await stageUnreferencedKeys({
        references,
        candidatePath,
        deletionPath,
        kind,
        signal: scope.signal,
      });
      if (referenceResult.status === "aborted") throw abortedError;
      if (referenceResult.status === "failed") {
        reportKindFailure(ctx, kind);
        mutable.kindFailureCount += 1;
        continue;
      }

      mutable.referencedCount += referenceResult.referencedCount;
      const deleteResult = await deleteStagedKeys({
        blobStore,
        deletionPath,
        kind,
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
      terminalError = new OrphanCleanupExecutionError(
        "ORPHAN_CLEANUP_SWEEP_FAILED",
      );
    }
  } finally {
    if (spoolPath !== undefined) {
      try {
        await rm(spoolPath, { recursive: true, force: true });
      } catch {
        ctx.logger.error("orphan_cleanup_spool_cleanup_failed", {
          code: "ORPHAN_CLEANUP_SPOOL_CLEANUP_FAILED",
        });
        terminalError ??= new OrphanCleanupExecutionError(
          "ORPHAN_CLEANUP_SWEEP_FAILED",
        );
      }
    }
    if (scope.signal.aborted && terminalError === undefined) {
      terminalError = abortedError;
    }
    scope.dispose();
  }

  if (terminalError !== undefined) throw terminalError;
  ctx.logger.info("orphan_cleanup_completed", { ...summary! });
  return summary!;
}

async function collectEligibleObjects(input: {
  readonly blobStore: AbortAwareBlobStore;
  readonly kind: PrivateBlobObjectKind;
  readonly cutoffMs: number;
  readonly candidatePath: string;
  readonly maxObjectsPerKind: number;
  readonly maxCandidatesPerKind: number;
  readonly maxPagesPerKind: number;
  readonly signal: AbortSignal;
  readonly counts: { scannedCount: number };
}): Promise<CollectionResult> {
  let handle: FileHandle | undefined;
  try {
    handle = await openPrivateSpool(input.candidatePath);
    const writer = new BoundedSpoolWriter(handle);
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let lastKey: string | null = null;
    let objectCount = 0;
    let candidateCount = 0;
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
            limit: ORPHAN_CLEANUP_PAGE_SIZE,
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
          listed.value.objects.length > ORPHAN_CLEANUP_PAGE_SIZE
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
          Buffer.byteLength(key) > ORPHAN_CLEANUP_MAX_KEY_BYTES ||
          typeof createdAt !== "string" ||
          (lastKey !== null && key <= lastKey)
        ) {
          return { status: "failed" };
        }
        let createdAtMs: number;
        try {
          if (parseObjectKey(key).kind !== input.kind) {
            return { status: "failed" };
          }
          createdAtMs = Date.parse(createdAt);
        } catch {
          return { status: "failed" };
        }
        if (!Number.isFinite(createdAtMs)) return { status: "failed" };
        lastKey = key;
        if (createdAtMs <= input.cutoffMs) {
          if (candidateCount >= input.maxCandidatesPerKind) {
            return { status: "capacity", capacity: "candidates" };
          }
          candidateCount += 1;
          await writer.writeKey(key);
        }
      }

      if (nextCursor === null) {
        await writer.flush();
        await handle.close();
        handle = undefined;
        return { status: "completed", candidateCount };
      }
      if (
        typeof nextCursor !== "string" ||
        nextCursor.length === 0 ||
        Buffer.byteLength(nextCursor) > ORPHAN_CLEANUP_MAX_CURSOR_BYTES ||
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

async function stageUnreferencedKeys(input: {
  readonly references: StorageObjectReferencesRepository;
  readonly candidatePath: string;
  readonly deletionPath: string;
  readonly kind: PrivateBlobObjectKind;
  readonly signal: AbortSignal;
}): Promise<ReferenceResult> {
  let handle: FileHandle | undefined;
  try {
    handle = await openPrivateSpool(input.deletionPath);
    const writer = new BoundedSpoolWriter(handle);
    let referencedCount = 0;
    for await (const chunk of readKeyChunks(
      input.candidatePath,
      ORPHAN_CLEANUP_REFERENCE_CHUNK_SIZE,
      input.signal,
    )) {
      let exportFences = new Map<
        string,
        { readonly referenced: boolean; readonly completedAt: string | null }
      >();
      if (input.kind === "export") {
        const candidates = chunk.map((key) => {
          const parsed = parseObjectKey(key);
          return {
            key,
            projectId: parsed.projectId,
            runId: parsed.runId,
          };
        });
        const fenceResult = await observeOperation(
          () => input.references.findExportDeletionFences(candidates),
          input.signal,
        );
        if (fenceResult.status !== "completed") return fenceResult;
        exportFences = fenceResult.value;
      }

      // For exports, observe the run fence first and exact object references
      // second. If finalize races this pair of reads, cleanup either retains the
      // active-run fence or sees the atomically committed object reference.
      const referenceResult = await observeOperation(
        () => input.references.findReferencedKeys(chunk),
        input.signal,
      );
      if (referenceResult.status !== "completed") return referenceResult;
      for (const key of chunk) {
        let isReferenced: boolean;
        try {
          isReferenced =
            referenceResult.value.has(key) ||
            exportFences.get(key)?.referenced === true;
        } catch {
          return { status: "failed" };
        }
        if (isReferenced) {
          referencedCount += 1;
        } else if (
          exportFences.get(key)?.completedAt === null
        ) {
          // Active/unknown/inconsistent canonical export run: fail closed.
          continue;
        } else {
          await writer.writeKey(key);
        }
      }
    }
    await writer.flush();
    await handle.close();
    handle = undefined;
    return { status: "completed", referencedCount };
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
  readonly deletionPath: string;
  readonly kind: PrivateBlobObjectKind;
  readonly signal: AbortSignal;
  readonly ctx: WorkerContext;
}): Promise<DeleteResult> {
  let deletedCount = 0;
  let deleteFailureCount = 0;
  try {
    for await (const keys of readKeyChunks(
      input.deletionPath,
      ORPHAN_CLEANUP_DELETE_CONCURRENCY,
      input.signal,
    )) {
      const lockedDelete = await input.ctx.db.transaction(
        async (tx): Promise<DeleteResult> => {
          const references = new StorageObjectReferencesRepository(tx);
          await references.lockObjectKeysForTransaction(keys);
          if (input.signal.aborted) return { status: "aborted" };

          let deletableKeys: readonly string[];
          if (input.kind === "export") {
            const candidates = keys.map((key) => {
              const parsed = parseObjectKey(key);
              return {
                key,
                projectId: parsed.projectId,
                runId: parsed.runId,
              };
            });
            const fences = await references.findExportDeletionFences(candidates);
            deletableKeys = keys.filter((key) => {
              const fence = fences.get(key);
              return (
                fence === undefined ||
                (!fence.referenced && fence.completedAt !== null)
              );
            });
          } else {
            const referenced = await references.findReferencedKeys(keys);
            deletableKeys = keys.filter((key) => !referenced.has(key));
          }

          // Every object writer acquires the same transaction-scoped key lock
          // before upload and holds it through canonical commit. Export deletion
          // is additionally fenced by its immutable canonical run state above.
          // If cancellation arrived while the lock/query was pending, do not
          // start a late storage delete. Once a delete has started, however,
          // await its real provider settlement before returning from this
          // callback. Releasing the advisory lock merely because the sweep
          // signal fired would let an already-issued remote DELETE arrive
          // after a waiting writer uploaded and committed the same key.
          // Production storage operations have their own finite timeout,
          // shorter than the database idle-in-transaction timeout.
          if (input.signal.aborted) return { status: "aborted" };
          const results = await Promise.all(
            deletableKeys.map(async (key): Promise<"deleted" | "failed"> => {
              try {
                await input.blobStore.delete(key);
                return "deleted";
              } catch {
                return "failed";
              }
            }),
          );
          if (input.signal.aborted) return { status: "aborted" };
          let chunkDeletedCount = 0;
          let chunkDeleteFailureCount = 0;
          for (const result of results) {
            if (result === "failed") {
              chunkDeleteFailureCount += 1;
              input.ctx.logger.error("orphan_cleanup_delete_failed", {
                code: "STORAGE_DELETE_FAILED",
                kind: input.kind,
              });
            } else {
              chunkDeletedCount += 1;
            }
          }
          return {
            status: "completed",
            deletedCount: chunkDeletedCount,
            deleteFailureCount: chunkDeleteFailureCount,
          };
        },
      );
      if (lockedDelete.status !== "completed") {
        return lockedDelete;
      }
      deletedCount += lockedDelete.deletedCount;
      deleteFailureCount += lockedDelete.deleteFailureCount;
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
      if (line.length === 0) throw new Error("invalid orphan cleanup spool");
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
  ctx.logger.error("orphan_cleanup_kind_failed", {
    code: "ORPHAN_CLEANUP_KIND_FAILED",
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

/** Start an immediate sweep and then repeat it every 24 hours. */
export function startOrphanCleanupLoop(
  ctx: WorkerContext,
  options: OrphanCleanupLoopOptions = {},
): OrphanCleanupLoop {
  const intervalMs = positiveSafeInteger(
    "orphan cleanup interval",
    options.intervalMs ?? ORPHAN_CLEANUP_INTERVAL_MS,
  );
  const sweepTimeoutMs = positiveSafeInteger(
    "orphan cleanup sweep timeout",
    options.sweepTimeoutMs ?? ORPHAN_CLEANUP_SWEEP_TIMEOUT_MS,
  );
  const stopTimeoutMs = positiveSafeInteger(
    "orphan cleanup stop timeout",
    options.stopTimeoutMs ?? ORPHAN_CLEANUP_STOP_TIMEOUT_MS,
  );
  const cleanup =
    options.cleanup ??
    (async (signal: AbortSignal) => {
      await runOrphanCleanupSweep(ctx, {
        deadlineMs: sweepTimeoutMs,
        signal,
      });
    });
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let stopPromise: Promise<void> | null = null;

  const reportFailure = (): void => {
    ctx.logger.error("orphan_cleanup_failed", {
      code: "ORPHAN_CLEANUP_SWEEP_FAILED",
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
