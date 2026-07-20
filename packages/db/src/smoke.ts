import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeDbProcessFailure } from "./runtime-failure.ts";

/**
 * Run the constraint smoke test (spec README / AC-003). The fixture inserts
 * exercise unavailable-not-zero, generated-lineage, append-only, and
 * artifact-revision invariants, then ROLLBACK. Uses psql because the script
 * relies on psql meta-commands and ON_ERROR_STOP.
 */
const SMOKE_SQL = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "schema-smoke.sql");

const SAFE_CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "SYSTEMROOT",
  "WINDIR",
] as const;

interface SmokeChildProcess {
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
}

export type SmokeSpawn = (
  command: string,
  args: readonly string[],
  options: Readonly<{ stdio: "inherit"; env: NodeJS.ProcessEnv }>,
) => SmokeChildProcess;

export interface PsqlSmokeSpawnConfig {
  readonly command: "psql";
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly pgPassContents: string;
}

const SAFE_CONNECTION_PARAMETER_ENV = {
  channel_binding: "PGCHANNELBINDING",
  client_encoding: "PGCLIENTENCODING",
  connect_timeout: "PGCONNECT_TIMEOUT",
  gssencmode: "PGGSSENCMODE",
  host: "PGHOST",
  hostaddr: "PGHOSTADDR",
  keepalives: "PGKEEPALIVES",
  keepalives_count: "PGKEEPALIVESCOUNT",
  keepalives_idle: "PGKEEPALIVESIDLE",
  keepalives_interval: "PGKEEPALIVESINTERVAL",
  krbsrvname: "PGKRBSRVNAME",
  port: "PGPORT",
  requirepeer: "PGREQUIREPEER",
  sslcert: "PGSSLCERT",
  sslcrl: "PGSSLCRL",
  sslcrldir: "PGSSLCRLDIR",
  sslkey: "PGSSLKEY",
  sslmaxprotocolversion: "PGSSLMAXPROTOCOLVERSION",
  sslminprotocolversion: "PGSSLMINPROTOCOLVERSION",
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  target_session_attrs: "PGTARGETSESSIONATTRS",
  tcp_user_timeout: "PGTCPUSER_TIMEOUT",
  user: "PGUSER",
  dbname: "PGDATABASE",
} as const satisfies Readonly<Record<string, string>>;

const IGNORED_SAFE_CONNECTION_PARAMETERS = new Set([
  "application_name",
  "fallback_application_name",
]);

function escapePgPassPassword(password: string): string {
  return password.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

/**
 * Build a minimal psql environment without copying unrelated process secrets.
 * Connection coordinates are passed through an explicit libpq environment
 * allowlist, while authentication uses a short-lived mode-0600 PGPASSFILE.
 * No connection URI (sanitized or otherwise) is placed in process argv.
 */
export function buildPsqlSmokeSpawnConfig(
  connectionString: string,
  pgPassFile: string,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): PsqlSmokeSpawnConfig {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("unsupported database connection protocol");
  }

  const queryPasswords = parsed.searchParams.getAll("password");
  if (queryPasswords.length > 1) {
    throw new Error("unsupported connection parameter for schema smoke");
  }
  const queryPassword = queryPasswords[0];
  const authorityPassword = parsed.password
    ? decodeURIComponent(parsed.password)
    : "";
  const password = queryPassword ?? authorityPassword;

  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const value = inheritedEnv[key];
    if (value !== undefined) env[key] = value;
  }
  env.PGPASSFILE = pgPassFile;
  env.PGAPPNAME = "signalframe_schema_smoke";

  if (parsed.hostname) env.PGHOST = parsed.hostname;
  if (parsed.port) env.PGPORT = parsed.port;
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.pathname && parsed.pathname !== "/") {
    env.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
  }

  for (const [parameter, value] of parsed.searchParams) {
    if (parameter === "password") continue;
    if (IGNORED_SAFE_CONNECTION_PARAMETERS.has(parameter)) continue;

    const envKey = SAFE_CONNECTION_PARAMETER_ENV[
      parameter as keyof typeof SAFE_CONNECTION_PARAMETER_ENV
    ];
    if (!envKey) {
      // Do not reflect an untrusted parameter name or value in this error.
      throw new Error("unsupported connection parameter for schema smoke");
    }
    env[envKey] = value;
  }

  return {
    command: "psql",
    args: [
      "--no-psqlrc",
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      SMOKE_SQL,
    ],
    env,
    pgPassContents: password
      ? `*:*:*:*:${escapePgPassPassword(password)}\n`
      : "",
  };
}

export async function runSmoke(
  connectionString: string,
  spawnProcess: SmokeSpawn = spawn,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "signalframe-smoke-"),
  );
  const pgPassFile = join(temporaryDirectory, ".pgpass");

  try {
    const config = buildPsqlSmokeSpawnConfig(
      connectionString,
      pgPassFile,
      inheritedEnv,
    );
    await writeFile(pgPassFile, config.pgPassContents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });

    return await new Promise<number>((resolve, reject) => {
      const child = spawnProcess(config.command, config.args, {
        stdio: "inherit",
        env: config.env,
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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
    console.error(serializeDbProcessFailure("smoke", error));
    process.exit(1);
  });
}
