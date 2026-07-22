import { requireSafeTestDatabaseUrl } from "./test-database-safety.ts";
import { runMigrations } from "./migrate.ts";

/**
 * Global integration-test tripwire and schema bootstrap. It runs before every
 * database-backed test file, before file-local service imports can open a pool.
 * Hosted, production, and ordinary developer databases are rejected first;
 * only then is the disposable loopback database migrated to the exact
 * checked-in schema so integration proof cannot depend on file order or stale
 * developer state.
 */
const databaseUrl = requireSafeTestDatabaseUrl(
  process.env["DATABASE_URL"],
  "DATABASE_URL",
);
await runMigrations(databaseUrl);
