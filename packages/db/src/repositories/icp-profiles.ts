import { and, desc, eq, inArray } from "drizzle-orm";
import { icpProfiles } from "../schema.ts";
import {
  Repository,
  projectPredicate,
  workspacePredicate,
  type ProjectScope,
  type WorkspaceScope,
} from "./base.ts";

/** Persisted ICP profile snapshot payload (the opaque `profile` jsonb column). */
export type IcpProfileData = Record<string, unknown>;

/**
 * `icp_profiles` is append-only and immutable (spec §12.3). Each save is a new
 * version row; the project's `current_icp_profile_id` selects the active one.
 * `UNIQUE (project_id, version)` and `UNIQUE (project_id, content_hash)` enforce
 * monotonic versions and no duplicate content (spec §6.2, AC-009).
 */

export type IcpStatus = "draft" | "complete";

export interface IcpProfileRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly version: number;
  readonly status: IcpStatus;
  readonly profile: IcpProfileData;
  readonly content_hash: string;
  readonly created_by: string;
  readonly created_at: string;
}

export class IcpProfilesRepository extends Repository {
  /** The current version pointed to by the project, or null before the first save. */
  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<IcpProfileRow | null> {
    const rows = await this.exec
      .select()
      .from(icpProfiles)
      .where(and(projectPredicate(icpProfiles, scope), eq(icpProfiles.id, id)))
      .limit(1);
    return (rows[0] as IcpProfileRow | undefined) ?? null;
  }

  /** An existing version with this content hash, if any (semantic-noop dedup). */
  async findByContentHash(
    scope: ProjectScope,
    contentHash: string,
  ): Promise<IcpProfileRow | null> {
    const rows = await this.exec
      .select()
      .from(icpProfiles)
      .where(
        and(
          projectPredicate(icpProfiles, scope),
          eq(icpProfiles.content_hash, contentHash),
        ),
      )
      .limit(1);
    return (rows[0] as IcpProfileRow | undefined) ?? null;
  }

  /**
   * Map of ICP versions keyed by id, for a batch of current-profile ids in the
   * workspace (spec §11.1: list pages must not N+1). Scoped by workspace_id.
   */
  async mapByIds(
    scope: WorkspaceScope,
    ids: readonly string[],
  ): Promise<Map<string, IcpProfileRow>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.exec
      .select()
      .from(icpProfiles)
      .where(
        and(
          workspacePredicate(icpProfiles, scope),
          inArray(icpProfiles.id, [...ids]),
        ),
      )) as IcpProfileRow[];
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Highest version number for the project (0 when none). */
  async maxVersion(scope: ProjectScope): Promise<number> {
    const rows = await this.exec
      .select({ version: icpProfiles.version })
      .from(icpProfiles)
      .where(projectPredicate(icpProfiles, scope))
      .orderBy(desc(icpProfiles.version))
      .limit(1);
    return rows[0]?.version ?? 0;
  }

  /** Append a new immutable version (inside the save transaction). */
  async insertVersion(values: {
    workspaceId: string;
    projectId: string;
    version: number;
    status: IcpStatus;
    profile: IcpProfileData;
    contentHash: string;
    createdBy: string;
  }): Promise<IcpProfileRow> {
    const [row] = await this.exec
      .insert(icpProfiles)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        version: values.version,
        status: values.status,
        profile: values.profile,
        content_hash: values.contentHash,
        created_by: values.createdBy,
      })
      .returning();
    return row as IcpProfileRow;
  }
}
