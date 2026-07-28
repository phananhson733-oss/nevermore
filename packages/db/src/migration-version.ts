import type pg from "pg";

export const LATEST_APP_MIGRATION =
  "0030_backlink_growth_path" as const;

type MigrationVersionQuery = Pick<pg.Pool, "query">;

/** Read the database-declared version without exposing any schema detail. */
export async function readMigrationVersion(
  queryable: MigrationVersionQuery,
): Promise<typeof LATEST_APP_MIGRATION | null> {
  const result = await queryable.query<{ migration_version: unknown }>(
    "SELECT migration_version FROM app.schema_migration_version",
  );
  return result.rows.length === 1 &&
    result.rows[0]?.migration_version === LATEST_APP_MIGRATION
    ? LATEST_APP_MIGRATION
    : null;
}
