import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listMigrationFiles, runMigrations } from "../migrate.ts";
import { LATEST_APP_MIGRATION } from "../migration-version.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const SHARED_DATABASE_URL = process.env["DATABASE_URL"]!;
const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

/**
 * This suite deliberately drives the schema from empty and re-applies every
 * migration in order, so it must own a pristine database. Borrowing the shared
 * integration database would make it depend on file order: a migration that
 * re-asserts a narrower CHECK than a later migration widened (0014's
 * `async_runs_kind_check` versus 0020's `content_shadow`) cannot be replayed
 * over rows another suite already wrote. Isolating here keeps the ordered-progress
 * proof intact instead of weakening it to tolerate shared state.
 */
function disposableDatabaseUrl(databaseName: string): string {
  const url = new URL(SHARED_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return requireSafeTestDatabaseUrl(url.toString(), "migration progress URL");
}

function maintenanceUrl(): string {
  const url = new URL(SHARED_DATABASE_URL);
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

const DATABASE_NAME = `signalframe_ci_migration_progress_${randomBytes(6).toString("hex")}`;
const DATABASE_URL = disposableDatabaseUrl(DATABASE_NAME);

async function applyMigration(
  client: pg.Client,
  file: string,
): Promise<void> {
  await client.query(
    readFileSync(`${MIGRATIONS_DIRECTORY}/${file}`, "utf8"),
  );
}

async function readProjectedVersion(client: pg.Client): Promise<string> {
  const result = await client.query<{ migration_version: string }>(
    "SELECT migration_version FROM app.schema_migration_version",
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.migration_version;
}

async function readRuleSetConstraintValidated(
  client: pg.Client,
): Promise<boolean> {
  const result = await client.query<{ convalidated: boolean }>(
    `SELECT convalidated
       FROM pg_constraint
      WHERE conrelid = 'app.diagnostic_runs'::regclass
        AND conname = 'diagnostic_runs_rule_set_version_check'`,
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.convalidated;
}

describe("ordered migration progress", () => {
  beforeAll(async () => {
    await withMaintenanceClient(async (client) => {
      await client.query(`CREATE DATABASE "${DATABASE_NAME}"`);
    });
  });

  afterAll(async () => {
    await withMaintenanceClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
    });
  });

  it("reports the last committed file across an interruption and resume", async () => {
    const files = listMigrationFiles();
    expect(files.at(-1)?.replace(/\.sql$/u, "")).toBe(
      LATEST_APP_MIGRATION,
    );

    let client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      for (const file of files.slice(0, 4)) {
        await applyMigration(client, file);
        await expect(readProjectedVersion(client)).resolves.toBe(
          file.replace(/\.sql$/u, ""),
        );
      }
    } finally {
      await client.end();
    }

    // A fresh connection simulates the migration process stopping after 0004.
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      await expect(readProjectedVersion(client)).resolves.toBe(
        "0004_artifact_revision_output_locale",
      );
      for (const file of files.slice(4)) {
        await applyMigration(client, file);
        await expect(readProjectedVersion(client)).resolves.toBe(
          file.replace(/\.sql$/u, ""),
        );
        if (file === "0042_contextual_indexability_opportunities.sql") {
          await expect(
            readRuleSetConstraintValidated(client),
          ).resolves.toBe(false);
        }
        if (file === "0043_validate_contextual_diagnostic_rule_set.sql") {
          await expect(
            readRuleSetConstraintValidated(client),
          ).resolves.toBe(true);
        }
      }
      await expect(readProjectedVersion(client)).resolves.toBe(
        LATEST_APP_MIGRATION,
      );

      // Simulate a database that already received the original, immediately
      // validated 0042 before this release split. The forward-only runner must
      // skip the edited 0042 body, safely replay 0043 and every later migration,
      // and retain a fully validated compatibility check.
      await client.query(`
        CREATE OR REPLACE VIEW app.schema_migration_version AS
          SELECT '0042_contextual_indexability_opportunities'::text
            AS migration_version
      `);
      await expect(runMigrations(DATABASE_URL)).resolves.toEqual([
        "0043_validate_contextual_diagnostic_rule_set.sql",
        "0044_dataforseo_backlinks.sql",
        "0045_dataforseo_backlink_target_lineage.sql",
      ]);
      await expect(readProjectedVersion(client)).resolves.toBe(
        LATEST_APP_MIGRATION,
      );
      await expect(
        readRuleSetConstraintValidated(client),
      ).resolves.toBe(true);
    } finally {
      await client.end();
    }
  });
});
