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

function escapePgPassPassword(password: string): string {
  return password.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

/**
 * Build a minimal psql environment without copying unrelated process secrets.
 * The sanitized URI passed through `--dbname` has its database password
 * removed; authentication uses a short-lived mode-0600 PGPASSFILE instead.
 * The complete secret-bearing DATABASE_URL is therefore never placed in argv.
 */
export function buildPsqlSmokeSpawnConfig(
  connectionString: string,
  pgPassFile: string,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): PsqlSmokeSpawnConfig {
  const parsed = new URL(connectionString);
  const queryPassword = parsed.searchParams.get("password");
  const authorityPassword = parsed.password
    ? decodeURIComponent(parsed.password)
    : "";
  const password = queryPassword ?? authorityPassword;
  parsed.password = "";
  parsed.searchParams.delete("password");

  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const value = inheritedEnv[key];
    if (value !== undefined) env[key] = value;
  }
  env.PGPASSFILE = pgPassFile;
  env.PGAPPNAME = "signalframe_schema_smoke";

  return {
    command: "psql",
    args: [
      "--no-psqlrc",
      "--no-password",
      "--dbname",
      parsed.toString(),
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
