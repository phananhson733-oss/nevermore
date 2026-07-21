import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LATEST_APP_MIGRATION,
  readMigrationVersion,
} from "./migration-version.ts";
import { asyncRuns } from "./schema.ts";

describe("readMigrationVersion", () => {
  it("activates the current HTTP and immutable export contracts", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0010_growth_audit_slice1.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.async_runs\s+ALTER\s+COLUMN\s+contract_version\s+SET\s+DEFAULT\s+'2026-07-21'/iu,
    );
    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.export_bundles[\s\S]*?ALTER\s+COLUMN\s+schema_version\s+SET\s+DEFAULT\s+'signalframe\.service-bundle\.0\.3\.0'/iu,
    );
    expect(migration).toMatch(
      /CHECK\s*\(\s*schema_version\s+IN\s*\(\s*'signalframe\.service-bundle\.0\.2\.0'\s*,\s*'signalframe\.service-bundle\.0\.3\.0'\s*\)\s*\)/iu,
    );
    expect(asyncRuns.contract_version.default).toBe("2026-07-21");
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
