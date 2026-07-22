import { and, eq, inArray, sql } from "drizzle-orm";
import { sites } from "../schema.ts";
import {
  Repository,
  projectChildPredicate,
  projectPredicate,
  workspacePredicate,
  type ProjectScope,
  type WorkspaceScope,
} from "./base.ts";

/**
 * `sites` rows are project children. The first site of a project is primary
 * (`is_primary` defaults true, guarded by the `sites_one_primary_per_project_idx`
 * partial unique index). WP1 creates exactly the primary site at project creation.
 */

export interface SiteRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly origin: string;
  readonly host: string;
  readonly market_codes: string[];
  readonly language_codes: string[];
  readonly is_primary: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export class SitesRepository extends Repository {
  /** Insert the project's primary site (inside the create-project transaction). */
  async insertPrimary(values: {
    workspaceId: string;
    projectId: string;
    origin: string;
    host: string;
    marketCodes: string[];
    languageCodes: string[];
  }): Promise<SiteRow> {
    const [row] = await this.exec
      .insert(sites)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        origin: values.origin,
        host: values.host,
        market_codes: values.marketCodes,
        language_codes: values.languageCodes,
        is_primary: true,
      })
      .returning();
    return row as SiteRow;
  }

  /**
   * Map of primary sites keyed by project id, for a batch of projects in the
   * workspace (spec §11.1: list pages must not N+1). Scoped by workspace_id.
   */
  async mapPrimariesByProjects(
    scope: WorkspaceScope,
    projectIds: readonly string[],
  ): Promise<Map<string, SiteRow>> {
    if (projectIds.length === 0) return new Map();
    const rows = (await this.exec
      .select()
      .from(sites)
      .where(
        and(
          workspacePredicate(sites, scope),
          sql`${sites.is_primary}`,
          inArray(sites.project_id, [...projectIds]),
        ),
      )) as SiteRow[];
    return new Map(rows.map((row) => [row.project_id, row]));
  }

  /** The project's primary site, scoped (null when foreign/absent). */
  async findPrimary(scope: ProjectScope): Promise<SiteRow | null> {
    const rows = await this.exec
      .select()
      .from(sites)
      .where(and(projectPredicate(sites, scope), sql`${sites.is_primary}`))
      .limit(1);
    return (rows[0] as SiteRow | undefined) ?? null;
  }

  /** One exact Site child, scoped in SQL to the owning workspace and project. */
  async findById(scope: ProjectScope, id: string): Promise<SiteRow | null> {
    const rows = await this.exec
      .select()
      .from(sites)
      .where(projectChildPredicate(sites, scope, eq(sites.id, id)))
      .limit(1);
    return (rows[0] as SiteRow | undefined) ?? null;
  }

  /**
   * Update the primary site's market/language projections (spec §6.2: a complete
   * ICP save mirrors marketCodes/siteLanguageCodes onto the site read model).
   */
  async updatePrimaryProjections(
    scope: ProjectScope,
    values: { marketCodes: string[]; languageCodes: string[] },
  ): Promise<void> {
    await this.exec
      .update(sites)
      .set({
        market_codes: values.marketCodes,
        language_codes: values.languageCodes,
      })
      .where(and(projectPredicate(sites, scope), sql`${sites.is_primary}`));
  }

  /**
   * Project only the reviewed Product Profile markets. Product Profile does not
   * model a content language, so confirmation must preserve the independently
   * observed/configured `language_codes` projection instead of clearing it.
   */
  async updatePrimaryMarketCodes(
    scope: ProjectScope,
    marketCodes: string[],
  ): Promise<void> {
    await this.exec
      .update(sites)
      .set({ market_codes: marketCodes })
      .where(and(projectPredicate(sites, scope), sql`${sites.is_primary}`));
  }
}
