import { describe, expect, it, vi } from "vitest";
import { REAL_E2E_SEGMENTS } from "./real-e2e-runtime.ts";
import {
  RealE2eRunError,
  runCommandInChildProcess,
  runRealE2e,
  type CommandOptions,
  type RunCommand,
} from "./run-real-e2e.ts";

interface RecordedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: CommandOptions;
}

const SOURCE_DATABASE_URL =
  "postgresql://runner:p%40ssword@127.0.0.1:5433/signalframe_e2e_ci";

function recordingRunner(
  implementation?: (
    call: RecordedCommand,
    callIndex: number,
  ) => Promise<void>,
): {
  readonly calls: RecordedCommand[];
  readonly runCommand: RunCommand;
} {
  const calls: RecordedCommand[] = [];
  return {
    calls,
    runCommand: vi.fn(async (command, args, options) => {
      const call = { command, args: [...args], options };
      calls.push(call);
      await implementation?.(call, calls.length - 1);
    }),
  };
}

function segmentFor(call: RecordedCommand): string | undefined {
  return call.options.env["REAL_E2E_SEGMENT"];
}

describe("runRealE2e", () => {
  it("runs light, AC-044, and AC-045 sequentially in fresh processes", async () => {
    let active = 0;
    const { calls, runCommand } = recordingRunner(async () => {
      active += 1;
      expect(active).toBe(1);
      await Promise.resolve();
      active -= 1;
    });

    await runRealE2e({
      sourceDatabaseUrl: SOURCE_DATABASE_URL,
      invocationId: "unit-sequential",
      basePort: 4310,
      runCommand,
      env: { KEEP_ME: "yes" },
      cwd: "/workspace",
    });

    expect(calls).toHaveLength(12);
    expect(
      calls
        .filter(({ command }) => command === "createdb")
        .map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);
    expect(
      calls
        .filter(({ command, args }) =>
          command === "pnpm" && args.includes("playwright"),
        )
        .map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);
    expect(
      calls.filter(({ command }) => command === "dropdb").map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);

    const playwrightCalls = calls.filter(
      ({ command, args }) => command === "pnpm" && args.includes("playwright"),
    );
    expect(playwrightCalls[0]?.args).toEqual([
      "exec",
      "playwright",
      "test",
      "--config=playwright.config.ts",
    ]);
    expect(playwrightCalls[1]?.args).toEqual([
      "exec",
      "playwright",
      "test",
      "--config=playwright.config.ts",
      "e2e/real-vertical-chains.spec.ts",
      "--grep",
      "AC-044",
    ]);
    expect(playwrightCalls[2]?.args).toEqual([
      "exec",
      "playwright",
      "test",
      "--config=playwright.config.ts",
      "e2e/real-vertical-chains.spec.ts",
      "--grep",
      "AC-045",
    ]);

    for (const [index, segment] of REAL_E2E_SEGMENTS.entries()) {
      const segmentCalls = calls.slice(index * 4, index * 4 + 4);
      expect(segmentCalls.map(({ command }) => command)).toEqual([
        "createdb",
        "pnpm",
        "pnpm",
        "dropdb",
      ]);
      expect(segmentCalls.map(segmentFor)).toEqual([
        segment,
        segment,
        segment,
        segment,
      ]);
      expect(segmentCalls[1]?.args).toEqual(["db:migrate"]);
      expect(segmentCalls[0]?.options.cwd).toBe("/workspace");
      expect(segmentCalls[0]?.options.env["KEEP_ME"]).toBe("yes");
      expect(segmentCalls[0]?.options.env["E2E_PORT"]).toBe(
        String(4310 + index),
      );
      expect(segmentCalls[0]?.options.env["SF_BLOB_DIR"]).toContain(segment);
    }
  });

  it("uses unique safe databases and keeps passwords out of DB CLI args", async () => {
    const { calls, runCommand } = recordingRunner();

    await runRealE2e({
      sourceDatabaseUrl: SOURCE_DATABASE_URL,
      invocationId: "unit-database-safety",
      runCommand,
      env: {},
    });

    const createCalls = calls.filter(({ command }) => command === "createdb");
    const dropCalls = calls.filter(({ command }) => command === "dropdb");
    const databaseNames = createCalls.map(({ args }) => args.at(-1));
    expect(new Set(databaseNames).size).toBe(3);

    for (const [index, createCall] of createCalls.entries()) {
      const databaseName = databaseNames[index]!;
      const dropCall = dropCalls[index]!;
      expect(Buffer.byteLength(databaseName, "utf8")).toBeLessThanOrEqual(63);
      expect(createCall.args).toEqual([
        "--host",
        "127.0.0.1",
        "--port",
        "5433",
        "--username",
        "runner",
        "--maintenance-db",
        "postgres",
        "--no-password",
        databaseName,
      ]);
      expect(dropCall.args).toEqual([
        "--if-exists",
        "--force",
        "--host",
        "127.0.0.1",
        "--port",
        "5433",
        "--username",
        "runner",
        "--maintenance-db",
        "postgres",
        "--no-password",
        databaseName,
      ]);
      expect(createCall.args.join(" ")).not.toContain("p@ssword");
      expect(dropCall.args.join(" ")).not.toContain("p@ssword");
      expect(createCall.options.env["PGPASSWORD"]).toBe("p@ssword");
      expect(dropCall.options.env["PGPASSWORD"]).toBe("p@ssword");
      expect(createCall.options.env["PGCONNECT_TIMEOUT"]).toBe("5");
      expect(dropCall.options.env["PGCONNECT_TIMEOUT"]).toBe("5");
      expect(createCall.options.env["DATABASE_URL"]).toBe(
        createCall.options.env["E2E_DATABASE_URL"],
      );
    }
    for (const call of calls.filter(({ command }) => command === "pnpm")) {
      expect(call.options.env["PGPASSWORD"]).toBeUndefined();
      expect(call.options.env["PGCONNECT_TIMEOUT"]).toBeUndefined();
    }
  });

  it("force-drops after a segment command fails and still attempts later segments", async () => {
    const { calls, runCommand } = recordingRunner(async (call) => {
      if (
        segmentFor(call) === "light" &&
        call.command === "pnpm" &&
        call.args.includes("playwright")
      ) {
        throw new Error(`secret must not escape: ${SOURCE_DATABASE_URL}`);
      }
    });

    const result = runRealE2e({
      sourceDatabaseUrl: SOURCE_DATABASE_URL,
      invocationId: "unit-continue",
      runCommand,
      env: {},
    });

    await expect(result).rejects.toBeInstanceOf(RealE2eRunError);
    expect(
      calls.filter(({ command }) => command === "createdb").map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);
    expect(
      calls.filter(({ command }) => command === "dropdb").map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);
    const failedPlaywrightIndex = calls.findIndex(
      (call) =>
        segmentFor(call) === "light" &&
        call.command === "pnpm" &&
        call.args.includes("playwright"),
    );
    const lightDropIndex = calls.findIndex(
      (call) => segmentFor(call) === "light" && call.command === "dropdb",
    );
    expect(lightDropIndex).toBe(failedPlaywrightIndex + 1);

    try {
      await result;
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain(SOURCE_DATABASE_URL);
      expect((error as Error).message).not.toContain("p@ssword");
    }
  });

  it("does not delete a database it failed to create", async () => {
    const { calls, runCommand } = recordingRunner(async (call) => {
      if (segmentFor(call) === "light" && call.command === "createdb") {
        throw new Error("createdb failed");
      }
    });

    await expect(
      runRealE2e({
        sourceDatabaseUrl: SOURCE_DATABASE_URL,
        invocationId: "unit-create-failure",
        runCommand,
        env: {},
      }),
    ).rejects.toMatchObject({
      failures: [{ segment: "light", phase: "create" }],
    });

    const lightCalls = calls.filter(
      (call) => segmentFor(call) === "light",
    );
    expect(lightCalls.map(({ command }) => command)).toEqual(["createdb"]);
    expect(
      calls.filter(({ command }) => command === "createdb").map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);
    expect(
      calls.filter(({ command }) => command === "dropdb").map(segmentFor),
    ).toEqual(["ac044", "ac045"]);
  });

  it("aggregates command and cleanup failures without skipping any segment", async () => {
    const { calls, runCommand } = recordingRunner(async (call) => {
      const segment = segmentFor(call);
      if (
        (segment === "light" &&
          call.command === "pnpm" &&
          call.args.includes("playwright")) ||
        (segment === "ac044" && call.command === "dropdb") ||
        (segment === "ac045" &&
          call.command === "pnpm" &&
          call.args[0] === "db:migrate")
      ) {
        throw new Error(`sensitive child failure: ${SOURCE_DATABASE_URL}`);
      }
    });

    let caught: RealE2eRunError | undefined;
    try {
      await runRealE2e({
        sourceDatabaseUrl: SOURCE_DATABASE_URL,
        invocationId: "unit-aggregate",
        runCommand,
        env: {},
      });
    } catch (error: unknown) {
      caught = error as RealE2eRunError;
    }

    expect(caught).toBeInstanceOf(RealE2eRunError);
    expect(caught?.failures).toEqual([
      { segment: "light", phase: "playwright" },
      { segment: "ac044", phase: "cleanup" },
      { segment: "ac045", phase: "migrate" },
    ]);
    expect(caught?.message).not.toContain(SOURCE_DATABASE_URL);
    expect(caught?.message).not.toContain("p@ssword");
    expect(
      calls.filter(({ command }) => command === "createdb").map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);
    expect(
      calls.filter(({ command }) => command === "dropdb").map(segmentFor),
    ).toEqual(REAL_E2E_SEGMENTS);
  });

  it("uses environment defaults, normalizes IPv6, and removes stale passwords", async () => {
    const { calls, runCommand } = recordingRunner();

    await runRealE2e({
      runCommand,
      env: {
        E2E_DATABASE_URL:
          "postgresql://runner@[::1]/signalframe_e2e_environment",
        E2E_PORT: "5310",
        REAL_E2E_INVOCATION_ID: "environment-invocation",
        PGDATABASE: "production",
        PGHOST: "db.example.com",
        PGHOSTADDR: "203.0.113.10",
        PGPORT: "6432",
        PGSERVICE: "production",
        PGSERVICEFILE: "/tmp/do-not-read",
        PGUSER: "unexpected",
        PGPASSWORD: "stale-do-not-inherit",
      },
    });

    const createCalls = calls.filter(({ command }) => command === "createdb");
    expect(createCalls.map(({ options }) => options.env["E2E_PORT"])).toEqual([
      "5310",
      "5311",
      "5312",
    ]);
    for (const call of calls) {
      expect(call.options.env["REAL_E2E_INVOCATION_ID"]).toBe(
        "environment-invocation",
      );
      expect(call.options.env["PGDATABASE"]).toBeUndefined();
      expect(call.options.env["PGHOST"]).toBeUndefined();
      expect(call.options.env["PGHOSTADDR"]).toBeUndefined();
      expect(call.options.env["PGPORT"]).toBeUndefined();
      expect(call.options.env["PGSERVICE"]).toBeUndefined();
      expect(call.options.env["PGSERVICEFILE"]).toBeUndefined();
      expect(call.options.env["PGUSER"]).toBeUndefined();
      expect(call.options.env["PGPASSWORD"]).toBeUndefined();
    }
    for (const call of createCalls) {
      expect(call.args.slice(0, 6)).toEqual([
        "--host",
        "::1",
        "--port",
        "5432",
        "--username",
        "runner",
      ]);
    }
  });

  it.each([0, 65_534, 1.5, Number.NaN])(
    "rejects a base port that cannot reserve three ports: %s",
    async (basePort) => {
      const { calls, runCommand } = recordingRunner();

      await expect(
        runRealE2e({
          sourceDatabaseUrl: SOURCE_DATABASE_URL,
          invocationId: "unit-invalid-port",
          basePort,
          runCommand,
          env: {},
        }),
      ).rejects.toThrow("three consecutive TCP ports");
      expect(calls).toEqual([]);
    },
  );

  it("runs child commands without a shell and reports only the command on failure", async () => {
    const options: CommandOptions = {
      cwd: process.cwd(),
      env: {},
    };

    await expect(
      runCommandInChildProcess(
        process.execPath,
        ["-e", "process.exit(0)"],
        options,
      ),
    ).resolves.toBeUndefined();
    await expect(
      runCommandInChildProcess(
        process.execPath,
        ["-e", "process.exit(7)", "do-not-reflect"],
        options,
      ),
    ).rejects.toThrow(`${process.execPath} exited unsuccessfully.`);
    await expect(
      runCommandInChildProcess(
        "/definitely-not-a-real-signalframe-command",
        ["do-not-reflect"],
        options,
      ),
    ).rejects.toThrow(
      "/definitely-not-a-real-signalframe-command could not be started.",
    );
  });
});
