const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DISPOSABLE_DATABASE = /^signalframe_(?:codex|e2e|ci)[a-z0-9_]*$/;

/**
 * Fail closed before a destructive/integration harness can inherit a hosted
 * DATABASE_URL from a developer's local environment. Error messages name only
 * the variable and failed policy; they never reflect credentials or the URL.
 */
export function requireSafeTestDatabaseUrl(
  value: string | undefined,
  variableName = "DATABASE_URL",
): string {
  if (!value) {
    throw new Error(`${variableName} is required for database-backed tests.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${variableName} must be a PostgreSQL URL.`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`${variableName} must target a loopback PostgreSQL host.`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error(`${variableName} must contain a disposable database name.`);
  }
  if (!DISPOSABLE_DATABASE.test(databaseName)) {
    throw new Error(`${variableName} must contain a disposable database name.`);
  }

  return value;
}
