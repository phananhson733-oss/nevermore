import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { listMigrationFiles } from "../migrate.ts";
import { LATEST_APP_MIGRATION } from "../migration-version.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

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

describe("ordered migration progress", () => {
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
      }
      await expect(readProjectedVersion(client)).resolves.toBe(
        LATEST_APP_MIGRATION,
      );
    } finally {
      await client.end();
    }
  });
});
