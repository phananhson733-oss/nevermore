import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { dataSnapshots } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

/**
 * `data_snapshots` is append-only (spec §7.6, §12.3): a snapshot is written once
 * on collection success/partial and never updated or deleted; a re-run produces a
 * new snapshot. The raw payload lives in Storage — the row keeps only the object
 * key, sha256 checksum, and row count. Every read is project-scoped in SQL.
 */

export interface DataSnapshotRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly collection_run_id: string;
  readonly source_connection_id: string | null;
  readonly provider: string;
  readonly dataset_key: string;
  readonly schema_version: string;
  readonly method_version: string;
  readonly captured_at: string;
  readonly source_window: Record<string, unknown>;
  readonly availability: string;
  readonly limitation: string;
  readonly raw_object_key: string | null;
  readonly row_count: number;
  readonly checksum: string;
  readonly summary: Record<string, unknown>;
  readonly created_at: string;
}

export interface SnapshotListPage {
  readonly rows: DataSnapshotRow[];
  readonly nextCursor: string | null;
}

function encodeCursor(row: { created_at: string; id: string }): string {
  return encodeTimestampUuidCursor(row.created_at, row.id);
}

function decodeCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  const decoded = decodeTimestampUuidCursor(cursor);
  return decoded
    ? { createdAt: decoded.timestamp, id: decoded.id }
    : null;
}

export class DataSnapshotsRepository extends Repository {
  /** Insert the immutable snapshot inside the worker's completion transaction. */
  async insert(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    collectionRunId: string;
    sourceConnectionId: string | null;
    provider: string;
    datasetKey: string;
    schemaVersion: string;
    methodVersion: string;
    capturedAt: string;
    sourceWindow: Record<string, unknown>;
    availability: string;
    limitation: string;
    rawObjectKey: string | null;
    rowCount: number;
    checksum: string;
    summary?: Record<string, unknown>;
  }): Promise<DataSnapshotRow> {
    const [row] = await this.exec
      .insert(dataSnapshots)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        collection_run_id: values.collectionRunId,
        source_connection_id: values.sourceConnectionId,
        provider: values.provider,
        dataset_key: values.datasetKey,
        schema_version: values.schemaVersion,
        method_version: values.methodVersion,
        captured_at: values.capturedAt,
        source_window: values.sourceWindow,
        availability: values.availability,
        limitation: values.limitation,
        raw_object_key: values.rawObjectKey,
        row_count: values.rowCount,
        checksum: values.checksum,
        ...(values.summary ? { summary: values.summary } : {}),
      })
      .returning();
    return row as DataSnapshotRow;
  }

  /** A snapshot by id, project-scoped (null when foreign/absent). */
  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<DataSnapshotRow | null> {
    const rows = await this.exec
      .select()
      .from(dataSnapshots)
      .where(
        and(projectPredicate(dataSnapshots, scope), eq(dataSnapshots.id, id)),
      )
      .limit(1);
    return (rows[0] as DataSnapshotRow | undefined) ?? null;
  }

  /** Load several snapshots by id, project-scoped (for a frozen diagnostic manifest). */
  async findByIds(
    scope: ProjectScope,
    ids: readonly string[],
  ): Promise<DataSnapshotRow[]> {
    if (ids.length === 0) return [];
    return (await this.exec
      .select()
      .from(dataSnapshots)
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          inArray(dataSnapshots.id, [...ids]),
        ),
      )) as DataSnapshotRow[];
  }

  /**
   * The most recent snapshot for a source connection (drives availability/freshness).
   * Equal capture times use the lowest canonical UUID/ASCII id, matching in-memory
   * latest-snapshot selection and keeping repeated reads deterministic.
   */
  async findLatestByConnection(
    scope: ProjectScope,
    sourceConnectionId: string,
  ): Promise<DataSnapshotRow | null> {
    const rows = await this.exec
      .select()
      .from(dataSnapshots)
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          eq(dataSnapshots.source_connection_id, sourceConnectionId),
        ),
      )
      .orderBy(desc(dataSnapshots.captured_at), asc(dataSnapshots.id))
      .limit(1);
    return (rows[0] as DataSnapshotRow | undefined) ?? null;
  }

  /**
   * The most recent snapshot for a provider (crawl has a null connection at times).
   * Keep the same lowest-id tie-break as connection and in-memory selection.
   */
  async findLatestByProvider(
    scope: ProjectScope,
    provider: string,
  ): Promise<DataSnapshotRow | null> {
    const rows = await this.exec
      .select()
      .from(dataSnapshots)
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          eq(dataSnapshots.provider, provider),
        ),
      )
      .orderBy(desc(dataSnapshots.captured_at), asc(dataSnapshots.id))
      .limit(1);
    return (rows[0] as DataSnapshotRow | undefined) ?? null;
  }

  /** Keyset page of a project's snapshots, newest first (spec §11.1 pagination). */
  async listByProject(
    scope: ProjectScope,
    opts: {
      limit: number;
      cursor: string | null;
      provider?: string | null;
    },
  ): Promise<SnapshotListPage> {
    const keyset = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !keyset) return { rows: [], nextCursor: null };
    const after =
      keyset != null
        ? or(
            lt(dataSnapshots.created_at, keyset.createdAt),
            and(
              eq(dataSnapshots.created_at, keyset.createdAt),
              lt(dataSnapshots.id, keyset.id),
            ),
          )
        : undefined;

    const providerFilter = opts.provider
      ? eq(dataSnapshots.provider, opts.provider)
      : undefined;

    const rows = (await this.exec
      .select()
      .from(dataSnapshots)
      .where(
        and(projectPredicate(dataSnapshots, scope), providerFilter, after),
      )
      .orderBy(desc(dataSnapshots.created_at), desc(dataSnapshots.id))
      .limit(opts.limit + 1)) as DataSnapshotRow[];

    const hasNext = rows.length > opts.limit;
    const page = hasNext ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasNext && last ? encodeCursor(last) : null,
    };
  }
}
