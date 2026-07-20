import { inArray, sql } from "drizzle-orm";
import {
  dataSnapshots,
  exportBundles,
  importPreviews,
} from "../schema.ts";
import { Repository } from "./base.ts";

const STORAGE_REFERENCE_QUERY_CHUNK_SIZE = 500;
const STORAGE_OBJECT_ADVISORY_LOCK_SEED = 7_614_931;

export const STORAGE_RETENTION_DAY_MS = 24 * 60 * 60 * 1_000;
export const RAW_OBJECT_RETENTION_DAYS = 90;
export const EXPORT_OBJECT_RETENTION_DAYS = 30;
export const RAW_OBJECT_RETENTION_MS =
  RAW_OBJECT_RETENTION_DAYS * STORAGE_RETENTION_DAY_MS;
export const EXPORT_OBJECT_RETENTION_MS =
  EXPORT_OBJECT_RETENTION_DAYS * STORAGE_RETENTION_DAY_MS;

export interface ExportObjectDeletionCandidate {
  readonly key: string;
  readonly projectId: string;
  readonly runId: string;
}

export interface ExportObjectDeletionFence {
  /** Exact `export_bundles.object_key` reference observed in the same snapshot. */
  readonly referenced: boolean;
  /** Canonical completion anchor, or `null` when deletion must fail closed. */
  readonly completedAt: string | null;
}

/**
 * Compare one immutable object timestamp with a cutoff derived from the canonical
 * database clock. The boundary is inclusive: an object expires at exactly the
 * configured age, not one maintenance interval later.
 */
export function isStorageObjectExpired(
  createdAt: string | Date,
  databaseNow: Date,
  retentionMs: number,
): boolean {
  const createdAtMs =
    createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  const nowMs = databaseNow.getTime();
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
    throw new RangeError("storage retention timestamps must be valid dates");
  }
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
    throw new RangeError("storage retention duration must be a positive integer");
  }
  return createdAtMs <= nowMs - retentionMs;
}

/**
 * Global maintenance lookup for the three canonical object-key columns.
 * Callers supply exact storage candidates, so this never scans or returns
 * unrelated tenant rows and never needs to materialize customer payloads.
 */
export class StorageObjectReferencesRepository extends Repository {
  /** Use the canonical database clock for cross-service retention cutoffs. */
  async databaseNow(): Promise<Date> {
    const result = await this.exec.execute<{ now: unknown }>(
      sql`select now() as now`,
    );
    const value = result.rows[0]?.now;
    const now = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(now.getTime())) {
      throw new Error("canonical database returned an invalid clock value");
    }
    return now;
  }

  async findReferencedKeys(keys: readonly string[]): Promise<Set<string>> {
    const candidates = [...new Set(keys)];
    const referenced = new Set<string>();
    for (
      let offset = 0;
      offset < candidates.length;
      offset += STORAGE_REFERENCE_QUERY_CHUNK_SIZE
    ) {
      const chunk = candidates.slice(
        offset,
        offset + STORAGE_REFERENCE_QUERY_CHUNK_SIZE,
      );
      const snapshotRows = (await this.exec
        .select({ key: dataSnapshots.raw_object_key })
        .from(dataSnapshots)
        .where(inArray(dataSnapshots.raw_object_key, chunk))) as Array<{
        key: string | null;
      }>;
      const previewRows = (await this.exec
        .select({ key: importPreviews.raw_object_key })
        .from(importPreviews)
        .where(inArray(importPreviews.raw_object_key, chunk))) as Array<{
        key: string | null;
      }>;
      const exportRows = (await this.exec
        .select({ key: exportBundles.object_key })
        .from(exportBundles)
        .where(inArray(exportBundles.object_key, chunk))) as Array<{
        key: string | null;
      }>;
      for (const row of [...snapshotRows, ...previewRows, ...exportRows]) {
        if (row.key !== null) referenced.add(row.key);
      }
    }
    return referenced;
  }

  /**
   * Acquire transaction-scoped locks for the supplied immutable object keys.
   * This method is effective only when this repository was constructed with an
   * explicit transaction executor. Every object writer and orphan-cleanup
   * caller holds the same key lock from its final storage decision through
   * canonical commit/delete. Export cleanup additionally has the immutable
   * run-state fence in `findExportDeletionFences`. Sorting and deduplication
   * establish one global acquisition order, preventing overlapping multi-key
   * maintenance chunks from deadlocking one another.
   */
  async lockObjectKeysForTransaction(keys: readonly string[]): Promise<void> {
    const candidates = [...new Set(keys)].sort();
    if (candidates.length === 0) return;
    const tuples = candidates.map((key) => sql`(${key})`);
    await this.exec.execute(sql`
      with candidates(key) as (
        values ${sql.join(tuples, sql`, `)}
      )
      select pg_advisory_xact_lock(
        hashtextextended(candidates.key, ${STORAGE_OBJECT_ADVISORY_LOCK_SEED}::bigint)
      )
      from candidates
      order by candidates.key
    `);
  }

  /**
   * Fence export deletion against the canonical run encoded in each object key.
   * Missing runs and immutable unsuccessful terminal runs are safe storage
   * orphans and are omitted. Completed runs map to their completion anchor;
   * active, unknown, or inconsistent runs map to `null` and fail closed.
   *
   * This defense-in-depth lookup addresses the run by the key's project/run
   * parts even though current writers also share the object-key advisory lock.
   * Terminal run states are database-enforced immutable. Consequently, seeing
   * an active run is a durable deletion fence even if finalize commits after
   * this SELECT and before the caller reaches external object storage.
   */
  async findExportDeletionFences(
    candidates: readonly ExportObjectDeletionCandidate[],
  ): Promise<Map<string, ExportObjectDeletionFence>> {
    const uniqueCandidates = [
      ...new Map(
        candidates.map((candidate) => [candidate.key, candidate]),
      ).values(),
    ];
    const fences = new Map<string, ExportObjectDeletionFence>();
    for (
      let offset = 0;
      offset < uniqueCandidates.length;
      offset += STORAGE_REFERENCE_QUERY_CHUNK_SIZE
    ) {
      const chunk = uniqueCandidates.slice(
        offset,
        offset + STORAGE_REFERENCE_QUERY_CHUNK_SIZE,
      );
      const tuples = chunk.map(
        (candidate) =>
          sql`(${candidate.key}, ${candidate.projectId}, ${candidate.runId})`,
      );
      const result = await this.exec.execute<{
        key: unknown;
        referenced_bundle_id: unknown;
        reference_status: unknown;
        reference_completed_at: unknown;
        path_kind: unknown;
        path_status: unknown;
        path_completed_at: unknown;
      }>(sql`
        with candidates(key, project_id, run_id) as (
          values ${sql.join(tuples, sql`, `)}
        )
        select
          candidates.key,
          referenced_bundle.id::text as referenced_bundle_id,
          reference_run.status as reference_status,
          reference_run.completed_at as reference_completed_at,
          path_run.kind as path_kind,
          path_run.status as path_status,
          path_run.completed_at as path_completed_at
        from candidates
        left join app.export_bundles as referenced_bundle
          on referenced_bundle.object_key = candidates.key
        left join app.async_runs as reference_run
          on reference_run.id = referenced_bundle.async_run_id
        left join app.async_runs as path_run
          on path_run.id::text = candidates.run_id
         and path_run.project_id::text = candidates.project_id
      `);
      for (const row of result.rows) {
        if (typeof row.key !== "string") continue;
        let fence: ExportObjectDeletionFence | undefined;
        if (typeof row.referenced_bundle_id === "string") {
          // Exact canonical object-key references always take precedence over a
          // malformed or mismatched path descriptor.
          fence = {
            referenced: true,
            completedAt:
              row.reference_status === "completed"
                ? validTimestampString(row.reference_completed_at)
                : null,
          };
        } else if (row.path_kind === "export") {
          if (row.path_status === "completed") {
            fence = {
              referenced: false,
              completedAt: validTimestampString(row.path_completed_at),
            };
          } else if (
            row.path_status !== "failed" &&
            row.path_status !== "partial" &&
            row.path_status !== "cancelled"
          ) {
            fence = { referenced: false, completedAt: null };
          }
        }
        if (fence !== undefined) {
          mergeDeletionFence(fences, row.key, fence);
        }
      }
    }
    return fences;
  }
}

function validTimestampString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function mergeDeletionFence(
  fences: Map<string, ExportObjectDeletionFence>,
  key: string,
  fence: ExportObjectDeletionFence,
): void {
  const existing = fences.get(key);
  if (existing === undefined) {
    fences.set(key, fence);
    return;
  }
  if (existing.completedAt === null || fence.completedAt === null) {
    fences.set(key, {
      referenced: existing.referenced || fence.referenced,
      completedAt: null,
    });
    return;
  }
  fences.set(key, {
    referenced: existing.referenced || fence.referenced,
    // Defensive duplicate references retain until the newest completion.
    completedAt:
      Date.parse(fence.completedAt) > Date.parse(existing.completedAt)
        ? fence.completedAt
        : existing.completedAt,
  });
}
