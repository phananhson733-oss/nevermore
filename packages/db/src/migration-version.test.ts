import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LATEST_APP_MIGRATION,
  readMigrationVersion,
} from "./migration-version.ts";
import { asyncRuns } from "./schema.ts";

describe("readMigrationVersion", () => {
  it("updates the async-run default to the current HTTP contract", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0009_async_run_contract_version.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.async_runs\s+ALTER\s+COLUMN\s+contract_version\s+SET\s+DEFAULT\s+'2026-07-18'/iu,
    );
    expect(asyncRuns.contract_version.default).toBe("2026-07-18");
  });

  it("advances the database projection exactly once per migration file", () => {
    const migrationsDirectory = fileURLToPath(
      new URL("../migrations/", import.meta.url),
    );
    const files = readdirSync(migrationsDirectory)
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();

    expect(files).not.toHaveLength(0);
    for (const file of files) {
      const expected = file.replace(/\.sql$/u, "");
      const sql = readFileSync(`${migrationsDirectory}/${file}`, "utf8");
      const declarations = [
        ...sql.matchAll(
          /SELECT\s+'([^']+)'::text\s+AS\s+migration_version/giu,
        ),
      ].map((match) => match[1]);
      expect(declarations, file).toEqual([expected]);
    }
    expect(files.at(-1)?.replace(/\.sql$/u, "")).toBe(
      LATEST_APP_MIGRATION,
    );
  });

  it("accepts only the exact database-declared current migration", async () => {
    const query = vi.fn(async () => ({
      rows: [{ migration_version: LATEST_APP_MIGRATION }],
    }));

    await expect(
      readMigrationVersion({ query } as never),
    ).resolves.toBe(LATEST_APP_MIGRATION);
    expect(query).toHaveBeenCalledWith(
      "SELECT migration_version FROM app.schema_migration_version",
    );
  });

  it("fails closed on an absent, stale, duplicated, or hostile value", async () => {
    for (const rows of [
      [],
      [{ migration_version: "0005_old" }],
      [
        { migration_version: LATEST_APP_MIGRATION },
        { migration_version: LATEST_APP_MIGRATION },
      ],
      [{ migration_version: { toString: () => "customer-secret" } }],
    ]) {
      const query = vi.fn(async () => ({ rows }));
      await expect(readMigrationVersion({ query } as never)).resolves.toBeNull();
    }
  });
});
