import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { sourceConnections } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `source_connections` covers all five providers (spec §7). WP1 creates the
 * default public Crawl connection at project creation (§6.1); WP2 adds the OAuth
 * (GSC/GA4) and CSV connections. `state = 'connected'` means authorized/ready,
 * NOT that a usable snapshot exists — availability follows a real snapshot
 * (§5.2). `limitation` is NOT NULL and must be non-empty.
 */

export interface SourceConnectionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly provider: string;
  readonly connection_type: string;
  readonly state: string;
  readonly external_ref: string | null;
  readonly scopes: string[];
  readonly config: Record<string, unknown>;
  readonly limitation: string;
  readonly connected_at: string | null;
  readonly disconnected_at: string | null;
  readonly last_successful_snapshot_id: string | null;
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
        connected_at: sql`now()`,
        created_by: values.createdBy,
      })
      .returning();
    return row as SourceConnectionRow;
  }

  /**
   * Create a GSC/GA4/CSV connection (spec §7.4/§7.5). OAuth sources are created
   * ONLY after a successful token exchange + property selection — never a
   * half-connected row. `state` is 'connected' with the provider's scopes/config.
   */
  async insertConnection(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    provider: string;
    connectionType: string;
    state: string;
    externalRef?: string | null;
    scopes?: readonly string[];
    config?: Record<string, unknown>;
    limitation: string;
    connectedAt?: boolean;
    createdBy: string;
  }): Promise<SourceConnectionRow> {
    const [row] = await this.exec
      .insert(sourceConnections)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        provider: values.provider,
        connection_type: values.connectionType,
        state: values.state,
        external_ref: values.externalRef ?? null,
        ...(values.scopes ? { scopes: [...values.scopes] } : {}),
        ...(values.config ? { config: values.config } : {}),
        limitation: values.limitation,
        ...(values.connectedAt ? { connected_at: sql`now()` } : {}),
        created_by: values.createdBy,
      })
      .returning();
    return row as SourceConnectionRow;
  }

  /** A source connection by id, project-scoped (null when foreign/absent). */
  async findById(scope: ProjectScope, id: string): Promise<SourceConnectionRow | null> {
    const rows = await this.exec
      .select()
      .from(sourceConnections)
      .where(and(projectPredicate(sourceConnections, scope), eq(sourceConnections.id, id)))
      .limit(1);
    return (rows[0] as SourceConnectionRow | undefined) ?? null;
  }

  /** Lock an active source through collection persistence vs. disconnect. */
  async findActiveByIdForUpdate(
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
          isNull(sourceConnections.disconnected_at),
        ),
      )
      .limit(1)
      .for("update");
    return (rows[0] as SourceConnectionRow | undefined) ?? null;
  }

  /**
   * The most recent non-disconnected connection for a provider (crawl default, or
   * the connected GSC/GA4 source). Null when none is connected.
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

  /** All non-disconnected connections for a project (Sources screen list). */
  async listByProject(scope: ProjectScope): Promise<SourceConnectionRow[]> {
    return (await this.exec
      .select()
      .from(sourceConnections)
      .where(
        and(
          projectPredicate(sourceConnections, scope),
          sql`${sourceConnections.state} <> 'disconnected'`,
        ),
      )
      .orderBy(desc(sourceConnections.created_at))) as SourceConnectionRow[];
  }

  /** Move a connection to a new state (e.g. syncing → available/partial/stale). */
  async updateState(
    scope: ProjectScope,
    id: string,
    state: string,
    limitation?: string,
  ): Promise<void> {
    await this.exec
      .update(sourceConnections)
      .set({
        state,
        ...(limitation !== undefined ? { limitation } : {}),
        updated_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(sourceConnections, scope),
          eq(sourceConnections.id, id),
          isNull(sourceConnections.disconnected_at),
        ),
      );
  }

  /** Point a connection at its latest successful snapshot (worker completion tx). */
  async setLastSnapshot(
    id: string,
    snapshotId: string,
    state: string,
    limitation?: string,
  ): Promise<void> {
    await this.exec
      .update(sourceConnections)
      .set({
        last_successful_snapshot_id: snapshotId,
        state,
        ...(limitation !== undefined ? { limitation } : {}),
        updated_at: sql`now()`,
      })
      .where(
        and(
          eq(sourceConnections.id, id),
          isNull(sourceConnections.disconnected_at),
        ),
      );
  }

  /** Disconnect: mark disconnected, keep historical snapshots (spec §12.3). */
  async disconnect(scope: ProjectScope, id: string): Promise<void> {
    await this.exec
      .update(sourceConnections)
      .set({ state: "disconnected", disconnected_at: sql`now()`, updated_at: sql`now()` })
      .where(and(projectPredicate(sourceConnections, scope), eq(sourceConnections.id, id)));
  }
}
