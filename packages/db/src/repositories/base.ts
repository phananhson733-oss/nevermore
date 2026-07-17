import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db, DbTx } from "../client.ts";

/** Any query runner: the pooled db or an open transaction. */
export type Executor = Db | DbTx;

/** Workspace-level scope carried by every repository call. */
export interface WorkspaceScope {
  readonly workspaceId: string;
}

/**
 * Project-level scope. Spec §12.2 requires every project-scoped repository
 * method signature to begin with `{ workspaceId, projectId }`, and every
 * cross-project child lookup to include project_id in the same SQL predicate.
 */
export interface ProjectScope extends WorkspaceScope {
  readonly projectId: string;
}

/** Columns a workspace-scoped table must expose (snake_case, matching the DDL). */
interface WorkspaceScopedTable {
  workspace_id: PgColumn;
}

/** Columns a project-scoped table must expose. */
interface ProjectScopedTable extends WorkspaceScopedTable {
  project_id: PgColumn;
}

/** Build a `workspace_id = ?` predicate. */
export function workspacePredicate(
  table: WorkspaceScopedTable,
  scope: WorkspaceScope,
): SQL {
  return eq(table.workspace_id, scope.workspaceId);
}

/**
 * Build a `workspace_id = ? AND project_id = ?` predicate. Callers append this
 * to every project-scoped query (including child-by-id reads) so isolation is
 * enforced in SQL, never in memory (spec §12.2, AC-005).
 */
export function projectPredicate(
  table: ProjectScopedTable,
  scope: ProjectScope,
): SQL {
  const predicate = and(
    eq(table.workspace_id, scope.workspaceId),
    eq(table.project_id, scope.projectId),
  );
  // `and` with two non-empty predicates is always defined.
  return predicate as SQL;
}

/**
 * Combine the project predicate with an additional child predicate (e.g.
 * `id = ?`) in a single SQL AND. Use this for every child-by-id read so a
 * foreign project's row returns "not found" rather than leaking existence.
 */
export function projectChildPredicate(
  table: ProjectScopedTable,
  scope: ProjectScope,
  extra: SQL,
): SQL {
  return and(projectPredicate(table, scope), extra) as SQL;
}

/** Base class holding the executor; concrete repositories extend it per WP. */
export abstract class Repository {
  constructor(protected readonly exec: Executor) {}
}
