import { timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  canonicalize,
  sha256Hex,
  type CanonicalValue,
} from "../hash.ts";
import { pageSnapshots, sitePages } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

export interface PageSnapshotRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_page_id: string;
  readonly data_snapshot_id: string;
  readonly content_hash: string;
  /** Null only on immutable pre-0012 rows whose source serialization was not retained. */
  readonly canonical_extract: string | null;
  readonly extract: Record<string, unknown>;
  readonly captured_at: string;
  readonly created_at: string;
}

export interface PageSnapshotListPage {
  readonly rows: PageSnapshotRow[];
  readonly nextCursor: string | null;
}

/**
 * A PageSnapshot plus the exact mutable SitePage identity observed while a
 * synthesis manifest is frozen or revalidated. This projection intentionally
 * excludes unrelated SitePage columns and every provider raw-object pointer.
 */
export interface PageSnapshotWithSitePageIdentityRow {
  readonly page_snapshot_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_page_id: string;
  readonly data_snapshot_id: string;
  readonly content_hash: string;
  readonly canonical_extract: string | null;
  readonly extract: Record<string, unknown>;
  readonly captured_at: string;
  readonly created_at: string;
  readonly normalized_url: string;
  readonly normalized_url_hash: string;
  readonly site_id: string;
}

export const MAX_PAGE_SNAPSHOT_ID_LOOKUP = 100;
const MAX_PAGE_SNAPSHOT_LOOKUP_KEY_LENGTH = 256;

function assertBoundedLookupKey(label: string, value: string): void {
  if (
    value.trim().length === 0 ||
    value.length > MAX_PAGE_SNAPSHOT_LOOKUP_KEY_LENGTH
  ) {
    throw new RangeError(
      `${label} must be between 1 and ${MAX_PAGE_SNAPSHOT_LOOKUP_KEY_LENGTH} characters`,
    );
  }
}

function pageSnapshotWithSitePageIdentitySelection() {
  return {
    page_snapshot_id: pageSnapshots.id,
    workspace_id: pageSnapshots.workspace_id,
    project_id: pageSnapshots.project_id,
    site_page_id: pageSnapshots.site_page_id,
    data_snapshot_id: pageSnapshots.data_snapshot_id,
    content_hash: pageSnapshots.content_hash,
    canonical_extract: pageSnapshots.canonical_extract,
    extract: pageSnapshots.extract,
    captured_at: pageSnapshots.captured_at,
    created_at: pageSnapshots.created_at,
    normalized_url: sitePages.normalized_url,
    normalized_url_hash: sitePages.normalized_url_hash,
    site_id: sitePages.site_id,
  };
}

function asciiNormalizedUrlAscending() {
  return asc(sql`${sitePages.normalized_url} collate "C"`);
}

function sameHash(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export class PageSnapshotsRepository extends Repository {
  async create(values: {
    workspaceId: string;
    projectId: string;
    sitePageId: string;
    dataSnapshotId: string;
    contentHash: string;
    extract: Record<string, unknown>;
    capturedAt: string;
  }): Promise<PageSnapshotRow> {
    const canonicalExtract = canonicalize(values.extract as CanonicalValue);
    const derivedContentHash = sha256Hex(canonicalExtract);
    if (!sameHash(derivedContentHash, values.contentHash)) {
      throw new Error("page snapshot content hash does not match extract");
    }
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const legacyRows = await this.findLegacyByCanonicalIdentity(
      scope,
      values.sitePageId,
      values.dataSnapshotId,
    );
    const legacy = legacyRows[0];
    if (legacy) {
      const isExactReplay = legacyRows.every(
        (row) =>
          row.workspace_id === values.workspaceId &&
          row.project_id === values.projectId &&
          row.site_page_id === values.sitePageId &&
          row.data_snapshot_id === values.dataSnapshotId &&
          sameHash(row.content_hash, derivedContentHash) &&
          isDeepStrictEqual(row.extract, values.extract) &&
          Date.parse(row.captured_at) === Date.parse(values.capturedAt),
      );
      if (isExactReplay) {
        return legacy;
      }
      throw new Error("page snapshot replay conflicts with immutable values");
    }
    const [inserted] = await this.exec
      .insert(pageSnapshots)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_page_id: values.sitePageId,
        data_snapshot_id: values.dataSnapshotId,
        content_hash: derivedContentHash,
        canonical_extract: canonicalExtract,
        extract: values.extract,
        captured_at: values.capturedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as PageSnapshotRow;

    const existing = await this.findByCanonicalIdentity(
      scope,
      values.sitePageId,
      values.dataSnapshotId,
    );
    if (
      existing &&
      existing.workspace_id === values.workspaceId &&
      existing.project_id === values.projectId &&
      sameHash(existing.content_hash, derivedContentHash) &&
      (existing.canonical_extract === null ||
        existing.canonical_extract === canonicalExtract) &&
      isDeepStrictEqual(existing.extract, values.extract) &&
      Date.parse(existing.captured_at) === Date.parse(values.capturedAt)
    ) {
      return existing;
    }
    throw new Error("page snapshot replay conflicts with immutable values");
  }

  private async findByCanonicalIdentity(
    scope: ProjectScope,
    sitePageId: string,
    dataSnapshotId: string,
  ): Promise<PageSnapshotRow | null> {
    const rows = await this.exec
      .select()
      .from(pageSnapshots)
      .where(
        and(
          projectPredicate(pageSnapshots, scope),
          eq(pageSnapshots.site_page_id, sitePageId),
          eq(pageSnapshots.data_snapshot_id, dataSnapshotId),
        ),
      )
      .limit(1);
    return (rows[0] as PageSnapshotRow | undefined) ?? null;
  }

  private async findLegacyByCanonicalIdentity(
    scope: ProjectScope,
    sitePageId: string,
    dataSnapshotId: string,
  ): Promise<PageSnapshotRow[]> {
    return (await this.exec
      .select()
      .from(pageSnapshots)
      .where(
        and(
          projectPredicate(pageSnapshots, scope),
          eq(pageSnapshots.site_page_id, sitePageId),
          eq(pageSnapshots.data_snapshot_id, dataSnapshotId),
          isNull(pageSnapshots.canonical_extract),
        ),
      )
      .orderBy(asc(pageSnapshots.id))) as PageSnapshotRow[];
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<PageSnapshotRow | null> {
    const rows = await this.exec
      .select()
      .from(pageSnapshots)
      .where(
        and(projectPredicate(pageSnapshots, scope), eq(pageSnapshots.id, id)),
      )
      .limit(1);
    return (rows[0] as PageSnapshotRow | undefined) ?? null;
  }

  /**
   * List all PageSnapshots materialized from one exact DataSnapshot. Both
   * sides of the join carry the ProjectScope predicate so a corrupted or
   * foreign SitePage identity cannot be exposed through the child FK alone.
   */
  async listByDataSnapshotWithSitePageIdentity(
    scope: ProjectScope,
    dataSnapshotId: string,
  ): Promise<PageSnapshotWithSitePageIdentityRow[]> {
    assertBoundedLookupKey("dataSnapshotId", dataSnapshotId);
    const rows = await this.exec
      .select(pageSnapshotWithSitePageIdentitySelection())
      .from(pageSnapshots)
      .innerJoin(sitePages, eq(pageSnapshots.site_page_id, sitePages.id))
      .where(
        and(
          projectPredicate(pageSnapshots, scope),
          projectPredicate(sitePages, scope),
          eq(pageSnapshots.data_snapshot_id, dataSnapshotId),
        ),
      )
      .orderBy(asciiNormalizedUrlAscending(), asc(pageSnapshots.id));
    return rows as PageSnapshotWithSitePageIdentityRow[];
  }

  /**
   * Re-read a frozen bounded PageSnapshot ID set with the same explicit
   * SitePage identity projection used during selection.
   */
  async findByIdsWithSitePageIdentity(
    scope: ProjectScope,
    ids: readonly string[],
  ): Promise<PageSnapshotWithSitePageIdentityRow[]> {
    if (ids.length === 0) return [];
    if (ids.length > MAX_PAGE_SNAPSHOT_ID_LOOKUP) {
      throw new RangeError(
        `page snapshot lookup accepts at most ${MAX_PAGE_SNAPSHOT_ID_LOOKUP} IDs`,
      );
    }
    for (const id of ids) assertBoundedLookupKey("pageSnapshotId", id);
    const uniqueIds = [...new Set(ids)];
    const rows = await this.exec
      .select(pageSnapshotWithSitePageIdentitySelection())
      .from(pageSnapshots)
      .innerJoin(sitePages, eq(pageSnapshots.site_page_id, sitePages.id))
      .where(
        and(
          projectPredicate(pageSnapshots, scope),
          projectPredicate(sitePages, scope),
          inArray(pageSnapshots.id, uniqueIds),
        ),
      )
      .orderBy(asciiNormalizedUrlAscending(), asc(pageSnapshots.id));
    return rows as PageSnapshotWithSitePageIdentityRow[];
  }

  async findLatestByPage(
    scope: ProjectScope,
    sitePageId: string,
  ): Promise<PageSnapshotRow | null> {
    const rows = await this.exec
      .select()
      .from(pageSnapshots)
      .where(
        and(
          projectPredicate(pageSnapshots, scope),
          eq(pageSnapshots.site_page_id, sitePageId),
        ),
      )
      .orderBy(desc(pageSnapshots.captured_at), desc(pageSnapshots.id))
      .limit(1);
    return (rows[0] as PageSnapshotRow | undefined) ?? null;
  }

  async listByPage(
    scope: ProjectScope,
    sitePageId: string,
    options: { readonly limit: number; readonly cursor: string | null },
  ): Promise<PageSnapshotListPage> {
    const decoded = options.cursor
      ? decodeTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !decoded) return { rows: [], nextCursor: null };
    const after = decoded
      ? or(
          lt(pageSnapshots.captured_at, decoded.timestamp),
          and(
            eq(pageSnapshots.captured_at, decoded.timestamp),
            lt(pageSnapshots.id, decoded.id),
          ),
        )
      : undefined;
    const rows = (await this.exec
      .select()
      .from(pageSnapshots)
      .where(
        and(
          projectPredicate(pageSnapshots, scope),
          eq(pageSnapshots.site_page_id, sitePageId),
          after,
        ),
      )
      .orderBy(desc(pageSnapshots.captured_at), desc(pageSnapshots.id))
      .limit(options.limit + 1)) as PageSnapshotRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        hasNext && last
          ? encodeTimestampUuidCursor(last.captured_at, last.id)
          : null,
    };
  }
}
