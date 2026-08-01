import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  asyncRuns,
  clientProjects,
  dataSnapshots,
  exportBundles,
  icpProfiles,
} from "../schema.ts";
import { Repository, workspacePredicate, type WorkspaceScope } from "./base.ts";
import type { IcpProfileRow } from "./icp-profiles.ts";

/**
 * `client_projects` is workspace-scoped (it has no parent project). Every read is
 * filtered by `workspace_id` in SQL so a foreign workspace's project resolves to
 * "not found" (→ 404, not 403; spec §4.1, AC-005). Keyset pagination follows the
 * `client_projects_workspace_updated_idx` order `(updated_at DESC, id DESC)`.
 */

export type ProjectStage =
  | "setup"
  | "collecting"
  | "ready_to_diagnose"
  | "diagnosing"
  | "planning"
  | "executing"
  | "delivered";

export interface ProjectRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly client_name: string;
  readonly project_name: string;
  readonly stage: ProjectStage;
  readonly default_delivery_locale: string;
  readonly current_icp_profile_id: string | null;
  readonly confirmed_icp_profile_id: string | null;
  readonly archived_at: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProjectListPage {
  readonly rows: ProjectRow[];
  readonly nextCursor: string | null;
}

/** Opaque keyset cursor over (updated_at, id). */
interface Keyset {
  readonly updatedAt: string;
  readonly id: string;
}

export function encodeProjectCursor(row: {
  updated_at: string;
  id: string;
}): string {
  return Buffer.from(`${row.updated_at}\0${row.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeProjectCursor(cursor: string): Keyset | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.indexOf("\0");
    if (idx < 0) return null;
    return { updatedAt: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

export class ProjectsRepository extends Repository {
  /** Insert a project row (inside the create-project transaction). */
  async insert(values: {
    workspaceId: string;
    clientName: string;
    projectName: string;
    defaultDeliveryLocale: string;
    createdBy: string;
  }): Promise<ProjectRow> {
    const [row] = await this.exec
      .insert(clientProjects)
      .values({
        workspace_id: values.workspaceId,
        client_name: values.clientName,
        project_name: values.projectName,
        default_delivery_locale: values.defaultDeliveryLocale,
        created_by: values.createdBy,
      })
      .returning();
    return row as ProjectRow;
  }

  /** Find one project by id, scoped to the workspace (returns null when foreign/absent). */
  async findById(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<ProjectRow | null> {
    const rows = await this.exec
      .select()
      .from(clientProjects)
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
        ),
      )
      .limit(1);
    return (rows[0] as ProjectRow | undefined) ?? null;
  }

  /**
   * Lock one project before comparing and advancing its current ICP version.
   * The caller MUST use a database transaction and hold the lock through the
   * immutable profile insert plus pointer update. A concurrent context save then
   * re-reads the winner's pointer and returns VERSION_CONFLICT instead of leaking
   * the `(project_id, version)` unique violation as a 500 (AC-009).
   */
  async findByIdForUpdate(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<ProjectRow | null> {
    const rows = await this.exec
      .select()
      .from(clientProjects)
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
        ),
      )
      .limit(1)
      .for("update");
    return (rows[0] as ProjectRow | undefined) ?? null;
  }

  /**
   * Read the reviewed immutable profile selected for downstream work. The
   * project and profile lineage are both scoped in SQL; projection drift fails
   * closed even though the database write guard should make it impossible.
   */
  async findConfirmedIcpProfile(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<IcpProfileRow | null> {
    const rows = await this.exec
      .select({
        id: icpProfiles.id,
        workspace_id: icpProfiles.workspace_id,
        project_id: icpProfiles.project_id,
        version: icpProfiles.version,
        status: icpProfiles.status,
        profile: icpProfiles.profile,
        content_hash: icpProfiles.content_hash,
        created_by: icpProfiles.created_by,
        created_at: icpProfiles.created_at,
      })
      .from(clientProjects)
      .innerJoin(
        icpProfiles,
        eq(icpProfiles.id, clientProjects.confirmed_icp_profile_id),
      )
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
          eq(icpProfiles.workspace_id, scope.workspaceId),
          eq(icpProfiles.project_id, projectId),
          eq(icpProfiles.status, "complete"),
        ),
      )
      .limit(1);
    return (rows[0] as IcpProfileRow | undefined) ?? null;
  }

  /** Keyset page of a workspace's projects, newest first (spec §11.1 pagination). */
  async listByWorkspace(
    scope: WorkspaceScope,
    opts: { limit: number; cursor: string | null; archived: boolean },
  ): Promise<ProjectListPage> {
    const archivedFilter = opts.archived
      ? sql`${clientProjects.archived_at} is not null`
      : sql`${clientProjects.archived_at} is null`;

    const keyset = opts.cursor ? decodeProjectCursor(opts.cursor) : null;
    const after =
      keyset != null
        ? or(
            lt(clientProjects.updated_at, keyset.updatedAt),
            and(
              eq(clientProjects.updated_at, keyset.updatedAt),
              lt(clientProjects.id, keyset.id),
            ),
          )
        : undefined;

    const rows = (await this.exec
      .select()
      .from(clientProjects)
      .where(
        and(workspacePredicate(clientProjects, scope), archivedFilter, after),
      )
      .orderBy(desc(clientProjects.updated_at), desc(clientProjects.id))
      .limit(opts.limit + 1)) as ProjectRow[];

    const hasNext = rows.length > opts.limit;
    const page = hasNext ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasNext && last ? encodeProjectCursor(last) : null,
    };
  }

  /** Point the project at its newest working ICP version. */
  async setCurrentIcpProfile(
    scope: WorkspaceScope,
    projectId: string,
    icpProfileId: string,
  ): Promise<boolean> {
    const rows = await this.exec
      .update(clientProjects)
      .set({ current_icp_profile_id: icpProfileId })
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
        ),
      )
      .returning({ id: clientProjects.id });
    return rows.length === 1;
  }

  /**
   * Select a reviewed complete ICP version without changing lifecycle stage.
   * PostgreSQL additionally rejects draft and cross-project profile ids.
   */
  async setConfirmedIcpProfile(
    scope: WorkspaceScope,
    projectId: string,
    icpProfileId: string,
  ): Promise<boolean> {
    const rows = await this.exec
      .update(clientProjects)
      .set({ confirmed_icp_profile_id: icpProfileId })
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
        ),
      )
      .returning({ id: clientProjects.id });
    return rows.length === 1;
  }

  /** Mirror the delivery locale from a complete ICP save (spec §6.2). */
  async setDeliveryLocale(
    scope: WorkspaceScope,
    projectId: string,
    defaultDeliveryLocale: string,
  ): Promise<void> {
    await this.exec
      .update(clientProjects)
      .set({ default_delivery_locale: defaultDeliveryLocale })
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
        ),
      );
  }

  /**
   * Soft-delete an active project inside its workspace scope. Historical
   * evidence remains addressable for audit, while every mutable repository
   * already treats `archived_at` as a write fence.
   */
  async archive(scope: WorkspaceScope, projectId: string): Promise<boolean> {
    const rows = await this.exec
      .update(clientProjects)
      .set({ archived_at: sql`now()` })
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
          isNull(clientProjects.archived_at),
        ),
      )
      .returning({ id: clientProjects.id });
    return rows.length === 1;
  }

  /**
   * Server-owned lifecycle transition. The project id and workspace predicate
   * are applied in the same UPDATE so a foreign workspace cannot mutate state.
   */
  async setStage(
    scope: WorkspaceScope,
    projectId: string,
    stage: ProjectStage,
  ): Promise<boolean> {
    const rows = await this.exec
      .update(clientProjects)
      .set({ stage })
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
          isNull(clientProjects.archived_at),
        ),
      )
      .returning({ id: clientProjects.id });
    return rows.length === 1;
  }

  /**
   * Enter `ready_to_diagnose` only when a reviewed ICP is confirmed and at least
   * one usable Crawl snapshot exists. Both gates and the stage write are one SQL
   * statement, avoiding a stale read between collection/profile confirmation.
   */
  async setReadyToDiagnoseIfEligible(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<boolean> {
    const rows = await this.exec
      .update(clientProjects)
      .set({ stage: "ready_to_diagnose" })
      .where(
        and(
          workspacePredicate(clientProjects, scope),
          eq(clientProjects.id, projectId),
          isNull(clientProjects.archived_at),
          sql`exists (
            select 1
              from ${icpProfiles}
             where ${icpProfiles.id} = ${clientProjects.confirmed_icp_profile_id}
               and ${icpProfiles.workspace_id} = ${scope.workspaceId}
               and ${icpProfiles.project_id} = ${projectId}
               and ${icpProfiles.status} = 'complete'
          )`,
          sql`exists (
            select 1
              from ${dataSnapshots}
             where ${dataSnapshots.workspace_id} = ${scope.workspaceId}
               and ${dataSnapshots.project_id} = ${projectId}
               and ${dataSnapshots.provider} = 'crawl'
               and ${dataSnapshots.availability} in ('available', 'partial')
          )`,
        ),
      )
      .returning({ id: clientProjects.id });
    return rows.length === 1;
  }

  /**
   * Rebuild the materialized stage from immutable/run history. This is the
   * recovery path for an operator repair or projection drift; normal commands
   * update the stage transactionally at each lifecycle boundary.
   */
  async rebuildStageFromHistory(
    scope: WorkspaceScope,
    projectId: string,
  ): Promise<ProjectStage | null> {
    await this.exec.execute(sql`
      with lifecycle_events(stage, event_at, event_order) as (
        select 'setup'::text, ${clientProjects.created_at}, 0
          from ${clientProjects}
         where ${clientProjects.workspace_id} = ${scope.workspaceId}
           and ${clientProjects.id} = ${projectId}

        union all
        select 'collecting', ${asyncRuns.created_at}, 10
          from ${asyncRuns}
         where ${asyncRuns.workspace_id} = ${scope.workspaceId}
           and ${asyncRuns.project_id} = ${projectId}
           and ${asyncRuns.kind} = 'collection'

        union all
        select 'ready_to_diagnose', ${asyncRuns.completed_at}, 20
          from ${asyncRuns}
         where ${asyncRuns.workspace_id} = ${scope.workspaceId}
           and ${asyncRuns.project_id} = ${projectId}
           and ${asyncRuns.kind} = 'collection'
           and ${asyncRuns.status} in ('completed', 'partial')
           and ${asyncRuns.completed_at} is not null
           and exists (
             select 1 from ${icpProfiles}
              where ${icpProfiles.id} = (
                      select ${clientProjects.confirmed_icp_profile_id}
                        from ${clientProjects}
                       where ${clientProjects.workspace_id} = ${scope.workspaceId}
                         and ${clientProjects.id} = ${projectId}
                    )
                and ${icpProfiles.workspace_id} = ${scope.workspaceId}
                and ${icpProfiles.project_id} = ${projectId}
                and ${icpProfiles.status} = 'complete'
           )
           and exists (
             select 1 from ${dataSnapshots}
              where ${dataSnapshots.workspace_id} = ${scope.workspaceId}
                and ${dataSnapshots.project_id} = ${projectId}
                and ${dataSnapshots.provider} = 'crawl'
                and ${dataSnapshots.availability} in ('available', 'partial')
           )

        union all
        select 'ready_to_diagnose',
               greatest(
                 ${icpProfiles.created_at},
                 (select max(ds.created_at)
                    from ${dataSnapshots} ds
                   where ds.workspace_id = ${scope.workspaceId}
                     and ds.project_id = ${projectId}
                     and ds.provider = 'crawl'
                     and ds.availability in ('available', 'partial'))
               ),
               20
          from ${icpProfiles}
          join ${clientProjects}
            on ${clientProjects.confirmed_icp_profile_id} = ${icpProfiles.id}
         where ${clientProjects.workspace_id} = ${scope.workspaceId}
           and ${clientProjects.id} = ${projectId}
           and ${icpProfiles.status} = 'complete'
           and exists (
             select 1 from ${dataSnapshots} ds
              where ds.workspace_id = ${scope.workspaceId}
                and ds.project_id = ${projectId}
                and ds.provider = 'crawl'
                and ds.availability in ('available', 'partial')
           )

        union all
        select 'diagnosing', ${asyncRuns.created_at}, 30
          from ${asyncRuns}
         where ${asyncRuns.workspace_id} = ${scope.workspaceId}
           and ${asyncRuns.project_id} = ${projectId}
           and ${asyncRuns.kind} = 'diagnostic'

        union all
        select 'planning', ${asyncRuns.completed_at}, 40
          from ${asyncRuns}
         where ${asyncRuns.workspace_id} = ${scope.workspaceId}
           and ${asyncRuns.project_id} = ${projectId}
           and ${asyncRuns.kind} = 'diagnostic'
           and ${asyncRuns.status} in ('completed', 'partial')
           and ${asyncRuns.completed_at} is not null

        union all
        select 'executing', ${asyncRuns.created_at}, 50
          from ${asyncRuns}
         where ${asyncRuns.workspace_id} = ${scope.workspaceId}
           and ${asyncRuns.project_id} = ${projectId}
           and ${asyncRuns.kind} = 'artifact_generation'

        union all
        select 'delivered', ${asyncRuns.completed_at}, 60
          from ${asyncRuns}
          join ${exportBundles}
            on ${exportBundles.async_run_id} = ${asyncRuns.id}
         where ${asyncRuns.workspace_id} = ${scope.workspaceId}
           and ${asyncRuns.project_id} = ${projectId}
           and ${asyncRuns.kind} = 'export'
           and ${asyncRuns.status} = 'completed'
           and ${asyncRuns.completed_at} is not null
           and ${exportBundles.kind} = 'client_bundle'
           and ${exportBundles.object_key} is not null
      ), latest as (
        select stage
          from lifecycle_events
         where event_at is not null
         order by event_at desc, event_order desc
         limit 1
      )
      update ${clientProjects}
         set stage = latest.stage
        from latest
       where ${clientProjects.workspace_id} = ${scope.workspaceId}
         and ${clientProjects.id} = ${projectId}
         and ${clientProjects.archived_at} is null
    `);

    return (await this.findById(scope, projectId))?.stage ?? null;
  }
}
