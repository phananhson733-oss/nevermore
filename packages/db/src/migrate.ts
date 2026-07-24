import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { serializeDbProcessFailure } from "./runtime-failure.ts";

/**
 * Apply the authoritative SQL contract. The `schema.sql`-derived migrations are
 * idempotent (CREATE ... IF NOT EXISTS, guarded DO blocks), and the runner is
 * forward-only: a migration already recorded by the append-only
 * `app.schema_migration_version` projection is skipped, so a second run is a
 * no-op success (spec AC-003). Skipping is required for correctness, not only
 * speed: an earlier migration that re-asserts a CHECK constraint a later
 * migration has since widened (e.g. 0014 re-narrowing `async_runs_kind_check`
 * after 0020 admits `content_shadow`) would otherwise fail on replay against
 * rows that use the newer value. pg-boss owns its own schema and is NOT applied
 * here (spec AC-004).
 */
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f !== "schema-smoke.sql")
    .sort();
}

/**
 * The last applied migration name, or null on an unmigrated database. Each
 * migration sets this projection to its own ordinal-prefixed name, so a lexical
 * comparison against the zero-padded ordered file list is exact. `to_regclass`
 * returns null (never errors) when the view does not yet exist.
 */
async function readAppliedMigrationVersion(
  client: pg.Client,
): Promise<string | null> {
  const exists = await client.query<{ regclass: string | null }>(
    "SELECT to_regclass('app.schema_migration_version') AS regclass",
  );
  if (!exists.rows[0]?.regclass) return null;
  const result = await client.query<{ migration_version: string }>(
    "SELECT migration_version FROM app.schema_migration_version",
  );
  return result.rows[0]?.migration_version ?? null;
}

export async function runMigrations(
  connectionString: string,
): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    const currentVersion = await readAppliedMigrationVersion(client);
    for (const file of listMigrationFiles()) {
      const version = file.replace(/\.sql$/u, "");
      if (currentVersion !== null && version <= currentVersion) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      // The migration file carries its own BEGIN/COMMIT; run as one multi-statement query.
      await client.query(sql);
      applied.push(file);
    }
  } finally {
    await client.end();
  }
  return applied;
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const applied = await runMigrations(connectionString);
  console.log(
    `Applied ${applied.length} migration file(s): ${applied.join(", ")}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(serializeDbProcessFailure("migrate", error));
    process.exit(1);
  });
}
