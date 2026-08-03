import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { asyncRuns, collectionRuns, dataSnapshots } from "../schema.ts";
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

/**
 * Metadata that may enter a frozen Product Profile synthesis manifest. Storage
 * pointers and provider payload projections are deliberately excluded.
 */
export interface EligibleCrawlDataSnapshotRow {
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
  readonly availability: string;
  readonly limitation: string;
  readonly row_count: number;
  readonly checksum: string;
  readonly created_at: string;
}

export interface EligibleDataSnapshotSelector {
  readonly provider: string;
  readonly datasetKey: string;
  /** Immutable Snapshot method identity. */
  readonly methodVersion: string;
  /** Exact canonical collection operation that produced the Snapshot. */
  readonly collectionOperation: string;
  /** Exact canonical collection method; it may differ from Snapshot method. */
  readonly collectionMethodVersion: string;
}

const MAX_SNAPSHOT_SELECTOR_LENGTH = 256;
const MAX_ELIGIBLE_SNAPSHOT_SOURCES = 16;

function assertBoundedSelector(label: string, value: string): void {
  if (
    value.trim().length === 0 ||
    value.length > MAX_SNAPSHOT_SELECTOR_LENGTH
  ) {
    throw new RangeError(
      `${label} must be between 1 and ${MAX_SNAPSHOT_SELECTOR_LENGTH} characters`,
    );
  }
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
   * Resolve the one immutable Snapshot produced by an exact collection run.
   * Analysis Refresh must never substitute a later provider Snapshot. Multiple
   * rows indicate corrupt/unsupported collection lineage and fail closed.
   */
  async findByCollectionRunId(
    scope: ProjectScope,
    collectionRunId: string,
  ): Promise<DataSnapshotRow | null> {
    assertBoundedSelector("collectionRunId", collectionRunId);
    const rows = (await this.exec
      .select()
      .from(dataSnapshots)
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          eq(dataSnapshots.collection_run_id, collectionRunId),
        ),
      )
      .limit(2)) as DataSnapshotRow[];
    if (rows.length > 1) {
      throw new Error("collection run produced ambiguous Snapshot lineage");
    }
    return rows[0] ?? null;
  }

  /**
   * Select the exact Crawl method whose immutable PageSnapshots may be frozen
   * into a Product Profile synthesis input manifest. `partial` remains
   * eligible because its limitations travel with the snapshot; unavailable or
   * failed collection records never do.
   */
  async findLatestEligibleCrawlBySite(
    scope: ProjectScope,
    siteId: string,
    datasetKey: string,
    methodVersion: string,
  ): Promise<EligibleCrawlDataSnapshotRow | null> {
    assertBoundedSelector("siteId", siteId);
    assertBoundedSelector("datasetKey", datasetKey);
    assertBoundedSelector("methodVersion", methodVersion);

    const rows = await this.exec
      .select({
        id: dataSnapshots.id,
        workspace_id: dataSnapshots.workspace_id,
        project_id: dataSnapshots.project_id,
        site_id: dataSnapshots.site_id,
        collection_run_id: dataSnapshots.collection_run_id,
        source_connection_id: dataSnapshots.source_connection_id,
        provider: dataSnapshots.provider,
        dataset_key: dataSnapshots.dataset_key,
        schema_version: dataSnapshots.schema_version,
        method_version: dataSnapshots.method_version,
        captured_at: dataSnapshots.captured_at,
        availability: dataSnapshots.availability,
        limitation: dataSnapshots.limitation,
        row_count: dataSnapshots.row_count,
        checksum: dataSnapshots.checksum,
        created_at: dataSnapshots.created_at,
      })
      .from(dataSnapshots)
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          eq(dataSnapshots.site_id, siteId),
          eq(dataSnapshots.provider, "crawl"),
          eq(dataSnapshots.dataset_key, datasetKey),
          eq(dataSnapshots.method_version, methodVersion),
          inArray(dataSnapshots.availability, ["available", "partial"]),
        ),
      )
      .orderBy(desc(dataSnapshots.captured_at), asc(dataSnapshots.id))
      .limit(1);
    return (rows[0] as EligibleCrawlDataSnapshotRow | undefined) ?? null;
  }

  /**
   * Select one immutable, usable Snapshot per provider from one or more exact
   * compatible contracts for a single Site. Multiple selectors may name the
   * same provider so a version migration can choose the newest compatible
   * Snapshot without weakening dataset/method/operation identity. A Snapshot
   * becomes diagnostic input only after its canonical
   * collection run reaches a successful terminal state; queued/running/failed
   * runs and unavailable snapshots are never promoted into an audit.
   *
   * Snapshot dataset/method and collection operation/method are selected as one
   * explicit contract. The selector does not infer collection identity from a
   * matching provider or Snapshot label, even when the two current method
   * strings happen to be equal. Equal capture instants use the lowest snapshot
   * id, matching the other latest-snapshot selectors.
   */
  async findLatestEligibleBySite(
    scope: ProjectScope,
    siteId: string,
    selectors: readonly EligibleDataSnapshotSelector[],
  ): Promise<DataSnapshotRow[]> {
    if (selectors.length === 0) return [];
    assertBoundedSelector("siteId", siteId);
    if (selectors.length > MAX_ELIGIBLE_SNAPSHOT_SOURCES) {
      throw new RangeError(
        `At most ${MAX_ELIGIBLE_SNAPSHOT_SOURCES} snapshot sources may be selected`,
      );
    }
    for (const selector of selectors) {
      assertBoundedSelector("provider", selector.provider);
      assertBoundedSelector("datasetKey", selector.datasetKey);
      assertBoundedSelector("methodVersion", selector.methodVersion);
      assertBoundedSelector(
        "collectionOperation",
        selector.collectionOperation,
      );
      assertBoundedSelector(
        "collectionMethodVersion",
        selector.collectionMethodVersion,
      );
    }

    const compatibleContract = or(
      ...selectors.map((selector) =>
        and(
          eq(dataSnapshots.provider, selector.provider),
          eq(dataSnapshots.dataset_key, selector.datasetKey),
          eq(dataSnapshots.method_version, selector.methodVersion),
          eq(collectionRuns.operation, selector.collectionOperation),
          eq(
            collectionRuns.method_version,
            selector.collectionMethodVersion,
          ),
        ),
      ),
    );
    if (!compatibleContract) return [];

    return (await this.exec
      .selectDistinctOn([dataSnapshots.provider], {
        id: dataSnapshots.id,
        workspace_id: dataSnapshots.workspace_id,
        project_id: dataSnapshots.project_id,
        site_id: dataSnapshots.site_id,
        collection_run_id: dataSnapshots.collection_run_id,
        source_connection_id: dataSnapshots.source_connection_id,
        provider: dataSnapshots.provider,
        dataset_key: dataSnapshots.dataset_key,
        schema_version: dataSnapshots.schema_version,
        method_version: dataSnapshots.method_version,
        captured_at: dataSnapshots.captured_at,
        source_window: dataSnapshots.source_window,
        availability: dataSnapshots.availability,
        limitation: dataSnapshots.limitation,
        raw_object_key: dataSnapshots.raw_object_key,
        row_count: dataSnapshots.row_count,
        checksum: dataSnapshots.checksum,
        summary: dataSnapshots.summary,
        created_at: dataSnapshots.created_at,
      })
      .from(dataSnapshots)
      .innerJoin(
        collectionRuns,
        and(
          projectPredicate(collectionRuns, scope),
          eq(collectionRuns.id, dataSnapshots.collection_run_id),
          eq(collectionRuns.site_id, siteId),
          eq(collectionRuns.provider, dataSnapshots.provider),
        ),
      )
      .innerJoin(
        asyncRuns,
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, collectionRuns.id),
          eq(asyncRuns.kind, "collection"),
        ),
      )
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          eq(dataSnapshots.site_id, siteId),
          compatibleContract,
          or(
            and(
              eq(dataSnapshots.availability, "available"),
              eq(asyncRuns.status, "completed"),
            ),
            and(
              eq(dataSnapshots.availability, "partial"),
              eq(asyncRuns.status, "partial"),
            ),
          ),
        ),
      )
      .orderBy(
        asc(dataSnapshots.provider),
        desc(dataSnapshots.captured_at),
        asc(dataSnapshots.id),
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
