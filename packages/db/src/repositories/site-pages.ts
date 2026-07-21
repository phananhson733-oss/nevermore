import { and, desc, eq, lt, or } from "drizzle-orm";
import { sitePages } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

export interface SitePageRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly normalized_url: string;
  readonly normalized_url_hash: string;
  readonly template_key: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SitePageListPage {
  readonly rows: SitePageRow[];
  readonly nextCursor: string | null;
}

export class SitePagesRepository extends Repository {
  async upsertNormalizedUrl(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    normalizedUrl: string;
    normalizedUrlHash: string;
    templateKey: string | null;
  }): Promise<SitePageRow> {
    const [row] = await this.exec
      .insert(sitePages)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        normalized_url: values.normalizedUrl,
        normalized_url_hash: values.normalizedUrlHash,
        template_key: values.templateKey,
      })
      .onConflictDoUpdate({
        target: [sitePages.project_id, sitePages.normalized_url_hash],
        set: {
          site_id: values.siteId,
          normalized_url: values.normalizedUrl,
          template_key: values.templateKey,
        },
      })
      .returning();
    return row as SitePageRow;
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<SitePageRow | null> {
    const rows = await this.exec
      .select()
      .from(sitePages)
      .where(and(projectPredicate(sitePages, scope), eq(sitePages.id, id)))
      .limit(1);
    return (rows[0] as SitePageRow | undefined) ?? null;
  }

  async findByNormalizedUrlHash(
    scope: ProjectScope,
    normalizedUrlHash: string,
  ): Promise<SitePageRow | null> {
    const rows = await this.exec
      .select()
      .from(sitePages)
      .where(
        and(
          projectPredicate(sitePages, scope),
          eq(sitePages.normalized_url_hash, normalizedUrlHash),
        ),
      )
      .limit(1);
    return (rows[0] as SitePageRow | undefined) ?? null;
  }

  async listByProject(
    scope: ProjectScope,
    options: { readonly limit: number; readonly cursor: string | null },
  ): Promise<SitePageListPage> {
    const decoded = options.cursor
      ? decodeTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !decoded) return { rows: [], nextCursor: null };
    const after = decoded
      ? or(
          lt(sitePages.updated_at, decoded.timestamp),
          and(
            eq(sitePages.updated_at, decoded.timestamp),
            lt(sitePages.id, decoded.id),
          ),
        )
      : undefined;
    const rows = (await this.exec
      .select()
      .from(sitePages)
      .where(and(projectPredicate(sitePages, scope), after))
      .orderBy(desc(sitePages.updated_at), desc(sitePages.id))
      .limit(options.limit + 1)) as SitePageRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        hasNext && last
          ? encodeTimestampUuidCursor(last.updated_at, last.id)
          : null,
    };
  }
}
