import { requireSafeTestDatabaseUrl } from "./test-database-safety.ts";

/**
 * Global integration-test tripwire. It runs before every database-backed test
 * file, before any file-local env defaults or service imports can open a pool.
 * Hosted, production, and ordinary developer databases are rejected.
 */
requireSafeTestDatabaseUrl(process.env["DATABASE_URL"], "DATABASE_URL");
