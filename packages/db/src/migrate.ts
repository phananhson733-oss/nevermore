import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Apply the authoritative SQL contract. The `schema.sql`-derived migrations are
 * idempotent (CREATE ... IF NOT EXISTS, guarded DO blocks), so a second run is a
 * no-op success (spec AC-003). pg-boss owns its own schema and is NOT applied
 * here (spec AC-004).
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f !== "schema-smoke.sql")
    .sort();
}

export async function runMigrations(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    for (const file of listMigrationFiles()) {
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
  console.log(`Applied ${applied.length} migration file(s): ${applied.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
