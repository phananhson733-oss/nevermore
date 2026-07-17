import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run the constraint smoke test (spec README / AC-003). The fixture inserts
 * exercise unavailable-not-zero, generated-lineage, append-only, and
 * artifact-revision invariants, then ROLLBACK. Uses psql because the script
 * relies on psql meta-commands and ON_ERROR_STOP.
 */
const SMOKE_SQL = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "schema-smoke.sql");

function runSmoke(connectionString: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [connectionString, "-v", "ON_ERROR_STOP=1", "-f", SMOKE_SQL], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const code = await runSmoke(connectionString);
  if (code !== 0) {
    console.error(`Schema smoke test failed (psql exit ${code}).`);
    process.exit(code);
  }
  console.log("Schema smoke test passed (fixtures rolled back).");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
