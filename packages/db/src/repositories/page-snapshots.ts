import { timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { pageSnapshots } from "../schema.ts";
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
  readonly extract: Record<string, unknown>;
  readonly captured_at: string;
  readonly created_at: string;
}

export interface PageSnapshotListPage {
  readonly rows: PageSnapshotRow[];
  readonly nextCursor: string | null;
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
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const [inserted] = await this.exec
      .insert(pageSnapshots)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_page_id: values.sitePageId,
        data_snapshot_id: values.dataSnapshotId,
        content_hash: values.contentHash,
        extract: values.extract,
        captured_at: values.capturedAt,
      })
      .onConflictDoNothing({
        target: [
          pageSnapshots.site_page_id,
          pageSnapshots.data_snapshot_id,
          pageSnapshots.content_hash,
        ],
      })
      .returning();
    if (inserted) return inserted as PageSnapshotRow;

    const existing = await this.findByCanonicalIdentity(
      scope,
      values.sitePageId,
      values.dataSnapshotId,
      values.contentHash,
    );
    if (
      existing &&
      existing.workspace_id === values.workspaceId &&
      existing.project_id === values.projectId &&
      sameHash(existing.content_hash, values.contentHash) &&
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
    contentHash: string,
  ): Promise<PageSnapshotRow | null> {
    const rows = await this.exec
      .select()
      .from(pageSnapshots)
      .where(
        and(
          projectPredicate(pageSnapshots, scope),
          eq(pageSnapshots.site_page_id, sitePageId),
          eq(pageSnapshots.data_snapshot_id, dataSnapshotId),
          eq(pageSnapshots.content_hash, contentHash),
        ),
      )
      .limit(1);
    return (rows[0] as PageSnapshotRow | undefined) ?? null;
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
