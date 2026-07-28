import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listMigrationFiles,
  MIGRATION_LOCK_KEYS,
  runMigrations,
} from "../migrate.ts";
import { LATEST_APP_MIGRATION } from "../migration-version.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const SHARED_DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = SHARED_DATABASE_URL ? describe : describe.skip;
const DATABASE_NAME = `signalframe_ci_migration_concurrency_${randomBytes(6).toString("hex")}`;

function sharedDatabaseUrl(): string {
  return requireSafeTestDatabaseUrl(
    SHARED_DATABASE_URL,
    "DATABASE_URL",
  );
}

function disposableDatabaseUrl(): string {
  const url = new URL(sharedDatabaseUrl());
  url.pathname = `/${DATABASE_NAME}`;
  return requireSafeTestDatabaseUrl(
    url.toString(),
    "migration concurrency database URL",
  );
}

function maintenanceUrl(): string {
  const url = new URL(sharedDatabaseUrl());
  url.pathname = "/postgres";
  return url.toString();
}

async function withMaintenanceClient(
  run: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

async function waitForBlockedMigrationRunners(
  observer: pg.Client,
): Promise<{
  readonly blockedRunnerCount: number;
  readonly safeDiagnostic: string;
}> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const blocked = await observer.query<{ count: number }>(
      `
        SELECT count(*)::integer AS count
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND wait_event = 'advisory'
      `,
      [DATABASE_NAME],
    );
    const count = blocked.rows[0]?.count ?? 0;
    if (count >= 2) {
      return {
        blockedRunnerCount: count,
        safeDiagnostic: `${count} runners waiting on an advisory lock`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const states = await observer.query<{
    state: string;
    wait_event_type: string;
    wait_event: string;
    count: number;
  }>(
    `
      SELECT
        coalesce(state, 'unknown') AS state,
        coalesce(wait_event_type, 'none') AS wait_event_type,
        coalesce(wait_event, 'none') AS wait_event,
        count(*)::integer AS count
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
      GROUP BY state, wait_event_type, wait_event
      ORDER BY state, wait_event_type, wait_event
    `,
    [DATABASE_NAME],
  );
  const safeDiagnostic =
    states.rows
      .map(
        (row) =>
          `state=${row.state}, wait_event_type=${row.wait_event_type}, wait_event=${row.wait_event}, count=${row.count}`,
      )
      .join("; ") || "no runner sessions observed";
  return { blockedRunnerCount: 0, safeDiagnostic };
}

describeDb("migration runner concurrency", () => {
  beforeAll(async () => {
    await withMaintenanceClient(async (client) => {
      await client.query(`CREATE DATABASE "${DATABASE_NAME}" TEMPLATE template0`);
    });
  });

  afterAll(async () => {
    await withMaintenanceClient(async (client) => {
      await client.query(
        `DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`,
      );
    });
  });

  it("serializes two fresh runners and leaves the complete projected version", async () => {
    const files = listMigrationFiles();
    const blocker = new pg.Client({
      connectionString: disposableDatabaseUrl(),
    });
    await blocker.connect();
    await blocker.query("SELECT pg_advisory_lock($1, $2)", [
      ...MIGRATION_LOCK_KEYS,
    ]);

    const runners = [
      runMigrations(disposableDatabaseUrl()),
      runMigrations(disposableDatabaseUrl()),
    ] as const;
    let observationFailure: { readonly error: unknown } | undefined;
    let observation = {
      blockedRunnerCount: 0,
      safeDiagnostic: "runner observation did not complete",
    };
    try {
      observation = await waitForBlockedMigrationRunners(blocker);
    } catch (error: unknown) {
      observationFailure = { error };
    } finally {
      try {
        await blocker.query("SELECT pg_advisory_unlock($1, $2)", [
          ...MIGRATION_LOCK_KEYS,
        ]);
      } finally {
        await blocker.end();
      }
    }

    const settledRunners = await Promise.allSettled(runners);
    if (observationFailure) {
      throw observationFailure.error;
    }
    expect(
      observation.blockedRunnerCount,
      `Migration runners did not both wait for the advisory lock within 10 seconds: ${observation.safeDiagnostic}`,
    ).toBe(2);
    expect(settledRunners.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    const results = settledRunners.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(results).toHaveLength(2);

    expect(
      results.map((applied) => applied.length).sort((a, b) => a - b),
    ).toEqual([0, files.length]);
    expect(results.find((applied) => applied.length === files.length)).toEqual(
      files,
    );

    const client = new pg.Client({
      connectionString: disposableDatabaseUrl(),
    });
    await client.connect();
    try {
      const version = await client.query<{ migration_version: string }>(
        "SELECT migration_version FROM app.schema_migration_version",
      );
      expect(version.rows).toEqual([
        { migration_version: LATEST_APP_MIGRATION },
      ]);
    } finally {
      await client.end();
    }
  });
});
