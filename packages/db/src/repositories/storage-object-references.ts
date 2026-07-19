import { inArray, sql } from "drizzle-orm";
import {
  dataSnapshots,
  exportBundles,
  importPreviews,
} from "../schema.ts";
import { Repository } from "./base.ts";

const STORAGE_REFERENCE_QUERY_CHUNK_SIZE = 500;

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
}
