import { StorageObjectReferencesRepository } from "@sf/db";
import {
  PRIVATE_BLOB_OBJECT_KINDS,
  parseObjectKey,
  type BlobObjectMetadata,
  type PrivateBlobObjectKind,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";

export const ORPHAN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const ORPHAN_CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1_000;
export const ORPHAN_CLEANUP_PAGE_SIZE = 100;

export interface OrphanCleanupSummary {
  readonly scannedCount: number;
  readonly eligibleCount: number;
  readonly referencedCount: number;
  readonly deletedCount: number;
  readonly deleteFailureCount: number;
  readonly kindFailureCount: number;
}

interface OrphanCleanupSweepOptions {
  readonly now?: Date;
  readonly minAgeMs?: number;
}

interface OrphanCleanupLoopOptions {
  readonly intervalMs?: number;
  readonly cleanup?: () => Promise<void>;
}

export interface OrphanCleanupLoop {
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Compare old private objects against every canonical object-key column.
 * Each kind is fully enumerated and validated before its first delete, so a
 * malformed page, repeated cursor, list outage, or DB outage fails that kind
 * closed. Newly uploaded/uncommitted objects remain protected for at least 24h.
 */
export async function runOrphanCleanupSweep(
  ctx: WorkerContext,
  options: OrphanCleanupSweepOptions = {},
): Promise<OrphanCleanupSummary> {
  const references = new StorageObjectReferencesRepository(ctx.db);
  const now = options.now ?? (await references.databaseNow());
  const minAgeMs = options.minAgeMs ?? ORPHAN_CLEANUP_MIN_AGE_MS;
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("orphan cleanup now must be a valid date");
  }
  if (!Number.isFinite(minAgeMs) || minAgeMs < ORPHAN_CLEANUP_MIN_AGE_MS) {
    throw new RangeError("orphan cleanup minimum age must be at least 24 hours");
  }
  const cutoffMs = now.getTime() - minAgeMs;
  const mutable = {
    scannedCount: 0,
    eligibleCount: 0,
    referencedCount: 0,
    deletedCount: 0,
    deleteFailureCount: 0,
    kindFailureCount: 0,
  };

  for (const kind of PRIVATE_BLOB_OBJECT_KINDS) {
    try {
      const eligible = await collectEligibleObjects(
        ctx,
        kind,
        cutoffMs,
        mutable,
      );
      const referenced = await references.findReferencedKeys(
        eligible.map((object) => object.key),
      );
      for (const object of eligible) {
        if (referenced.has(object.key)) {
          mutable.referencedCount += 1;
          continue;
        }
        try {
          await ctx.blobStore.delete(object.key);
          mutable.deletedCount += 1;
        } catch {
          mutable.deleteFailureCount += 1;
          ctx.logger.error("orphan_cleanup_delete_failed", {
            code: "STORAGE_DELETE_FAILED",
            kind,
          });
        }
      }
    } catch {
      mutable.kindFailureCount += 1;
      ctx.logger.error("orphan_cleanup_kind_failed", {
        code: "ORPHAN_CLEANUP_KIND_FAILED",
        kind,
      });
    }
  }

  const summary: OrphanCleanupSummary = { ...mutable };
  ctx.logger.info("orphan_cleanup_completed", { ...summary });
  return summary;
}

async function collectEligibleObjects(
  ctx: WorkerContext,
  kind: PrivateBlobObjectKind,
  cutoffMs: number,
  counts: { scannedCount: number; eligibleCount: number },
): Promise<BlobObjectMetadata[]> {
  const eligible: BlobObjectMetadata[] = [];
  const seenKeys = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const page = await ctx.blobStore.list({
      kind,
      cursor,
      limit: ORPHAN_CLEANUP_PAGE_SIZE,
    });
    counts.scannedCount += page.objects.length;
    for (const object of page.objects) {
      const parsed = parseObjectKey(object.key);
      const createdAtMs = Date.parse(object.createdAt);
      if (
        parsed.kind !== kind ||
        !Number.isFinite(createdAtMs) ||
        seenKeys.has(object.key)
      ) {
        throw new Error("invalid private object list page");
      }
      seenKeys.add(object.key);
      if (createdAtMs <= cutoffMs) eligible.push(object);
    }
    if (page.nextCursor === null) break;
    if (
      page.nextCursor.length === 0 ||
      page.nextCursor === cursor ||
      seenCursors.has(page.nextCursor)
    ) {
      throw new Error("private object list cursor did not advance");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  counts.eligibleCount += eligible.length;
  return eligible;
}

/** Start an immediate sweep and then repeat it every 24 hours. */
export function startOrphanCleanupLoop(
  ctx: WorkerContext,
  options: OrphanCleanupLoopOptions = {},
): OrphanCleanupLoop {
  const intervalMs = options.intervalMs ?? ORPHAN_CLEANUP_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("orphan cleanup interval must be positive");
  }
  const cleanup =
    options.cleanup ??
    (async () => {
      await runOrphanCleanupSweep(ctx);
    });
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const reportFailure = (): void => {
    ctx.logger.error("orphan_cleanup_failed", {
      code: "ORPHAN_CLEANUP_SWEEP_FAILED",
    });
  };

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    const current = Promise.resolve()
      .then(cleanup)
      .catch(reportFailure)
      .finally(() => {
        if (inFlight === current) inFlight = null;
      });
    inFlight = current;
    return current;
  };
  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  timer.unref();
  void runNow();

  return {
    runNow,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await inFlight?.catch(() => undefined);
    },
  };
}
