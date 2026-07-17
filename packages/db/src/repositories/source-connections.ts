import { and, desc, eq, sql } from "drizzle-orm";
import { sourceConnections } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `source_connections` covers all five providers (spec §7). WP1 only creates the
 * default public Crawl connection at project creation (spec §6.1 step 4); the
 * OAuth/CSV connections are added in WP2. `state = 'connected'` means authorized/
 * ready, NOT that a usable snapshot exists — availability follows a real snapshot
 * (spec §5.2). `limitation` is NOT NULL and must be non-empty.
 */

export interface SourceConnectionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly provider: string;
  readonly connection_type: string;
  readonly state: string;
  readonly limitation: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const DEFAULT_CRAWL_LIMITATION =
  "Static HTML crawl of public pages; no snapshot has been collected yet.";

export class SourceConnectionsRepository extends Repository {
  /** Create the project's default public Crawl source (inside the create-project tx). */
  async insertDefaultCrawl(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    createdBy: string;
  }): Promise<SourceConnectionRow> {
    const [row] = await this.exec
      .insert(sourceConnections)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        provider: "crawl",
        connection_type: "public",
        state: "connected",
        limitation: DEFAULT_CRAWL_LIMITATION,
        created_by: values.createdBy,
      })
      .returning();
    return row as SourceConnectionRow;
  }

  /** A source connection by id, project-scoped (null when foreign/absent). */
  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<SourceConnectionRow | null> {
    const rows = await this.exec
      .select()
      .from(sourceConnections)
      .where(
        and(
          projectPredicate(sourceConnections, scope),
          eq(sourceConnections.id, id),
        ),
      )
      .limit(1);
    return (rows[0] as SourceConnectionRow | undefined) ?? null;
  }

  /**
   * The most recent non-disconnected connection for a provider (crawl default,
   * or the connected GSC/GA4 source). Null when none is connected.
   */
  async findConnectedByProvider(
    scope: ProjectScope,
    provider: string,
  ): Promise<SourceConnectionRow | null> {
    const rows = await this.exec
      .select()
      .from(sourceConnections)
      .where(
        and(
          projectPredicate(sourceConnections, scope),
          eq(sourceConnections.provider, provider),
          sql`${sourceConnections.state} <> 'disconnected'`,
        ),
      )
      .orderBy(desc(sourceConnections.created_at))
      .limit(1);
    return (rows[0] as SourceConnectionRow | undefined) ?? null;
  }
}
