import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPsqlSmokeSpawnConfig, runSmoke } from "./smoke.ts";

describe("buildPsqlSmokeSpawnConfig", () => {
  it("keeps the connection URI and percent-decoded password out of argv", () => {
    const connectionString =
      "postgresql://user%40tenant:p%3Aa%5Css@db.example:6543/db%20name" +
      "?sslmode=verify-full&application_name=smoke%20test";
    const config = buildPsqlSmokeSpawnConfig(
      connectionString,
      "/tmp/signalframe-smoke-test/.pgpass",
      {
        PATH: "/safe/bin",
        HOME: "/safe/home",
        LANG: "en_US.UTF-8",
        DATABASE_URL: connectionString,
        OPENAI_API_KEY: "unrelated-parent-secret",
        PGPASSWORD: "stale-parent-password",
      },
    );

    expect(config.command).toBe("psql");
    expect(config.args).toEqual([
      "--no-psqlrc",
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      expect.stringMatching(/schema-smoke\.sql$/u),
    ]);
    expect(JSON.stringify(config.args)).not.toContain(connectionString);
    expect(JSON.stringify(config.args)).not.toContain("p:a\\ss");
    expect(JSON.stringify(config.args)).not.toContain("p%3Aa%5Css");

    expect(config.env).toMatchObject({
      PATH: "/safe/bin",
      HOME: "/safe/home",
      LANG: "en_US.UTF-8",
      PGDATABASE: "db name",
      PGHOST: "db.example",
      PGPORT: "6543",
      PGSSLMODE: "verify-full",
      PGUSER: "user@tenant",
      PGAPPNAME: "signalframe_schema_smoke",
      PGPASSFILE: "/tmp/signalframe-smoke-test/.pgpass",
    });
    expect(config.env).not.toHaveProperty("DATABASE_URL");
    expect(config.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(config.env).not.toHaveProperty("PGPASSWORD");

    expect(config.pgPassContents).toBe("*:*:*:*:p\\:a\\\\ss\n");
  });

  it("preserves a percent-encoded Unix socket and SSL mode without leaking a query password", () => {
    const connectionString =
      "postgresql:///signalframe_ci?host=%2Fvar%2Frun%2Fpostgresql" +
      "&user=smoke%40operator&password=query%3Asecret&sslmode=disable";

    const config = buildPsqlSmokeSpawnConfig(
      connectionString,
      "/tmp/signalframe-smoke-test/.pgpass",
      { PATH: "/safe/bin" },
    );

    expect(JSON.stringify(config.args)).not.toContain(connectionString);
    expect(config.env).toMatchObject({
      PGDATABASE: "signalframe_ci",
      PGHOST: "/var/run/postgresql",
      PGSSLMODE: "disable",
      PGUSER: "smoke@operator",
    });
    expect(config.pgPassContents).toBe("*:*:*:*:query\\:secret\n");
  });

  it("fails closed on secret-bearing libpq parameters without reflecting their values", () => {
    const secret = "customer-private-key-passphrase";
    let thrown: unknown;
    try {
      buildPsqlSmokeSpawnConfig(
        `postgresql://smoke@localhost/signalframe_ci?sslmode=verify-full&sslpassword=${secret}`,
        "/tmp/signalframe-smoke-test/.pgpass",
        { PATH: "/safe/bin" },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/unsupported connection parameter/u);
    expect((thrown as Error).message).not.toContain(secret);
  });

  it.each(["options", "service", "servicefile", "passfile"])(
    "fails closed on the %s connection parameter without reflecting its value",
    (parameter) => {
      const secret = "customer-secret-value";
      expect(() =>
        buildPsqlSmokeSpawnConfig(
          `postgresql://smoke@localhost/signalframe_ci?${parameter}=${secret}`,
          "/tmp/signalframe-smoke-test/.pgpass",
          { PATH: "/safe/bin" },
        ),
      ).toThrow("unsupported connection parameter for schema smoke");

      try {
        buildPsqlSmokeSpawnConfig(
          `postgresql://smoke@localhost/signalframe_ci?${parameter}=${secret}`,
          "/tmp/signalframe-smoke-test/.pgpass",
          { PATH: "/safe/bin" },
        );
      } catch (error) {
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toContain(parameter);
      }
    },
  );
});

describe("runSmoke", () => {
  it("uses a mode-0600 temporary passfile and removes it after psql exits", async () => {
    const connectionString =
      "postgresql://smoke:ephemeral%3Asecret@localhost:5432/signalframe_ci";
    let passFilePath: string | undefined;
    let passFileContents: string | undefined;

    const code = await runSmoke(
      connectionString,
      (_command, args, options) => {
        expect(JSON.stringify(args)).not.toContain(connectionString);
        expect(options.env).not.toHaveProperty("DATABASE_URL");
        passFilePath = options.env.PGPASSFILE;
        expect(passFilePath).toBeTruthy();
        expect(statSync(passFilePath!).mode & 0o777).toBe(0o600);
        passFileContents = readFileSync(passFilePath!, "utf8");

        const child = new EventEmitter();
        queueMicrotask(() => child.emit("exit", 0));
        return child;
      },
      {
        PATH: process.env["PATH"],
        DATABASE_URL: connectionString,
        OPENAI_API_KEY: "unrelated-parent-secret",
      },
    );

    expect(code).toBe(0);
    expect(passFileContents).toBe("*:*:*:*:ephemeral\\:secret\n");
    expect(passFilePath).toBeTruthy();
    expect(existsSync(passFilePath!)).toBe(false);
  });

  it("removes the temporary passfile when psql cannot be spawned", async () => {
    let passFilePath: string | undefined;

    await expect(
      runSmoke(
        "postgresql://smoke:ephemeral-secret@localhost:5432/signalframe_ci",
        (_command, _args, options) => {
          passFilePath = options.env.PGPASSFILE;
          throw new Error("synthetic spawn failure");
        },
        { PATH: process.env["PATH"] },
      ),
    ).rejects.toThrow("synthetic spawn failure");

    expect(passFilePath).toBeTruthy();
    expect(existsSync(passFilePath!)).toBe(false);
  });
});
