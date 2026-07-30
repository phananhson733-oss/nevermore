const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DISPOSABLE_DATABASE = /^signalframe_(?:codex|e2e|ci)[a-z0-9_]*$/;
const CONNECTION_ROUTING_QUERY_PARAMETERS = new Set([
  "database",
  "dbname",
  "host",
  "hostaddr",
  "password",
  "port",
  "service",
  "servicefile",
  "user",
]);
export const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

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
  if (
    [...parsed.searchParams.keys()].some((parameter) =>
      CONNECTION_ROUTING_QUERY_PARAMETERS.has(parameter.toLowerCase()),
    )
  ) {
    throw new Error(
      `${variableName} must not override PostgreSQL connection routing in query parameters.`,
    );
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
  if (
    Buffer.byteLength(databaseName, "utf8") > POSTGRES_IDENTIFIER_MAX_BYTES
  ) {
    throw new Error(
      `${variableName} database name must be at most ${POSTGRES_IDENTIFIER_MAX_BYTES} bytes.`,
    );
  }

  return value;
}
