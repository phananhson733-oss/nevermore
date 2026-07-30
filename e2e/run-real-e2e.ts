import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REAL_E2E_SEGMENTS,
  deriveRealE2eBasePort,
  deriveRealE2eDatabaseUrl,
  getRealE2eSegmentPaths,
  type RealE2eSegment,
} from "./real-e2e-runtime.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const INHERITED_POSTGRES_ROUTING_ENVIRONMENT = [
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGUSER",
  "PGPASSWORD",
] as const;

export interface CommandOptions {
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<void>;

export type RealE2eFailurePhase =
  | "create"
  | "migrate"
  | "playwright"
  | "cleanup";

export interface RealE2eFailure {
  readonly segment: RealE2eSegment;
  readonly phase: RealE2eFailurePhase;
}

export interface RunRealE2eOptions {
  readonly sourceDatabaseUrl?: string | undefined;
  readonly invocationId?: string | undefined;
  readonly basePort?: number | undefined;
  readonly runCommand?: RunCommand | undefined;
  readonly env?: Readonly<NodeJS.ProcessEnv> | undefined;
  readonly cwd?: string | undefined;
}

export class RealE2eRunError extends Error {
  readonly failures: readonly RealE2eFailure[];

  constructor(failures: readonly RealE2eFailure[]) {
    const summary = failures
      .map(({ segment, phase }) => `${segment}:${phase}`)
      .join(", ");
    super(
      `Real E2E orchestration failed in ${failures.length} phase(s): ${summary}.`,
    );
    this.name = "RealE2eRunError";
    this.failures = failures.map((failure) => ({ ...failure }));
  }
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

interface PostgresCliTarget {
  readonly databaseName: string;
  readonly connectionArgs: readonly string[];
  readonly password: string | undefined;
}

function decodeUrlCredential(
  value: string,
  credentialName: "username" | "password",
): string {
  try {
    const decoded = decodeURIComponent(value);
    if (containsAsciiControl(decoded)) {
      throw new Error("control character");
    }
    return decoded;
  } catch {
    throw new Error(`E2E database ${credentialName} must be URL encoded.`);
  }
}

function postgresCliTarget(databaseUrl: string): PostgresCliTarget {
  const parsed = new URL(databaseUrl);
  const hostname =
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  const username = decodeUrlCredential(parsed.username, "username");
  const password = parsed.password
    ? decodeUrlCredential(parsed.password, "password")
    : undefined;
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const connectionArgs = [
    "--host",
    hostname,
    "--port",
    parsed.port || "5432",
    ...(username ? ["--username", username] : []),
    "--maintenance-db",
    "postgres",
    // Authentication is supplied only through PGPASSWORD. Never hang CI on an
    // interactive prompt, and never put the password itself in argv.
    "--no-password",
  ];
  return { databaseName, connectionArgs, password };
}

function sanitizedEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const sanitized = { ...source };
  for (const variableName of INHERITED_POSTGRES_ROUTING_ENVIRONMENT) {
    delete sanitized[variableName];
  }
  return sanitized;
}

function playwrightArgs(segment: RealE2eSegment): readonly string[] {
  const base = [
    "exec",
    "playwright",
    "test",
    "--config=playwright.config.ts",
  ] as const;
  if (segment === "light") return base;
  return [
    ...base,
    "e2e/real-vertical-chains.spec.ts",
    "--grep",
    segment === "ac044" ? "AC-044" : "AC-045",
  ];
}

function requireBasePort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_533) {
    throw new Error(
      "E2E_PORT must reserve three consecutive TCP ports between 1 and 65535.",
    );
  }
  return value;
}

function parseBasePort(
  value: string | undefined,
  invocationId: string,
): number {
  if (!value) return deriveRealE2eBasePort(invocationId);
  return requireBasePort(Number(value));
}

export const runCommandInChildProcess: RunCommand = async (
  command,
  args,
  options,
) =>
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...options.env },
      shell: false,
      stdio: "inherit",
    });
    let settled = false;
    child.once("error", () => {
      if (settled) return;
      settled = true;
      rejectCommand(new Error(`${command} could not be started.`));
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolveCommand();
      } else {
        rejectCommand(new Error(`${command} exited unsuccessfully.`));
      }
    });
  });

async function recordFailure(
  failures: RealE2eFailure[],
  failure: RealE2eFailure,
  operation: () => Promise<void>,
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch {
    // Child errors may contain spawned-process details. Keep only the bounded,
    // non-secret segment and phase at the orchestration boundary.
    failures.push(failure);
    return false;
  }
}

/**
 * Run the three real-browser segments serially. Every segment owns a database,
 * Next build directory, blob directory, Playwright output directory, and port.
 * A segment failure stops dependent commands in that segment, but never skips
 * its forced database cleanup or either later segment.
 */
export async function runRealE2e(
  options: RunRealE2eOptions = {},
): Promise<void> {
  const baseEnv = options.env ?? process.env;
  const sourceDatabaseUrl =
    options.sourceDatabaseUrl ?? baseEnv["E2E_DATABASE_URL"];
  const invocationId =
    options.invocationId ??
    baseEnv["REAL_E2E_INVOCATION_ID"] ??
    randomUUID();
  const basePort = requireBasePort(
    options.basePort ??
      parseBasePort(baseEnv["E2E_PORT"], invocationId),
  );
  const runCommand = options.runCommand ?? runCommandInChildProcess;
  const cwd = options.cwd ?? REPOSITORY_ROOT;
  const failures: RealE2eFailure[] = [];
  const sanitizedBaseEnv = sanitizedEnvironment(baseEnv);

  for (const [index, segment] of REAL_E2E_SEGMENTS.entries()) {
    const databaseUrl = deriveRealE2eDatabaseUrl(
      sourceDatabaseUrl,
      invocationId,
      segment,
    );
    const target = postgresCliTarget(databaseUrl);
    const paths = getRealE2eSegmentPaths(segment, invocationId);
    const segmentEnv: NodeJS.ProcessEnv = {
      ...sanitizedBaseEnv,
      DATABASE_URL: databaseUrl,
      E2E_DATABASE_URL: databaseUrl,
      E2E_PORT: String(basePort + index),
      REAL_E2E_INVOCATION_ID: invocationId,
      REAL_E2E_SEGMENT: segment,
      SF_BLOB_DIR: paths.blobDir,
      NEXT_DIST_DIR: paths.distDirectoryName,
      PLAYWRIGHT_OUTPUT_DIR: paths.outputDir,
    };
    const postgresCliEnv: NodeJS.ProcessEnv = {
      ...segmentEnv,
      PGCONNECT_TIMEOUT: "5",
    };
    if (target.password !== undefined) {
      postgresCliEnv["PGPASSWORD"] = target.password;
    }
    const commandOptions: CommandOptions = { cwd, env: segmentEnv };
    const postgresCommandOptions: CommandOptions = {
      cwd,
      env: postgresCliEnv,
    };
    let databaseCreated = false;

    try {
      const created = await recordFailure(
        failures,
        { segment, phase: "create" },
        () =>
          runCommand(
            "createdb",
            [...target.connectionArgs, target.databaseName],
            postgresCommandOptions,
          ),
      );
      databaseCreated = created;
      let migrated = false;
      if (created) {
        migrated = await recordFailure(
          failures,
          { segment, phase: "migrate" },
          () => runCommand("pnpm", ["db:migrate"], commandOptions),
        );
      }
      if (migrated) {
        await recordFailure(
          failures,
          { segment, phase: "playwright" },
          () => runCommand("pnpm", playwrightArgs(segment), commandOptions),
        );
      }
    } finally {
      // A failed createdb never grants ownership of a possibly pre-existing
      // target, so only delete a database this invocation created successfully.
      if (databaseCreated) {
        await recordFailure(
          failures,
          { segment, phase: "cleanup" },
          () =>
            runCommand(
              "dropdb",
              [
                "--if-exists",
                "--force",
                ...target.connectionArgs,
                target.databaseName,
              ],
              postgresCommandOptions,
            ),
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new RealE2eRunError(failures);
  }
}

export async function main(): Promise<void> {
  await runRealE2e();
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  fileURLToPath(import.meta.url) === resolve(entrypoint)
) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof RealE2eRunError
        ? error.message
        : "Real E2E orchestration failed before segment execution.";
    process.stderr.write(`[real E2E] ${message}\n`);
    process.exitCode = 1;
  });
}
