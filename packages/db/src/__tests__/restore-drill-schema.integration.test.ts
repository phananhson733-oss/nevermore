import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import {
  APP_TABLES,
  INTEGRITY_PROBES,
  buildCanonicalCopySql,
  buildIntegrityCopySql,
  buildTableCountSql,
} from "../../../../scripts/backup-restore-drill.mjs";
import { loadSchemaCatalog } from "../../../../scripts/schema-catalog.mjs";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

/**
 * The restore drill's unit gate runs against a stubbed PostgreSQL, so it can
 * only be as truthful as the static schema catalog it checks the drill's SQL
 * against. This suite is the other half of that pair: it proves the catalog
 * parsed from the checked-in migration chain is exactly what a real server
 * reports, and it executes the statements the drill actually sends. If the
 * parser ever drifts from PostgreSQL, this goes red rather than the unit gate
 * quietly blessing SQL the server would reject.
 */
describeDb("restore drill schema agreement", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  async function liveColumns(): Promise<Map<string, Set<string>>> {
    const result = await handle.pool.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns AS c
         JOIN information_schema.tables AS t
           ON t.table_schema = c.table_schema
          AND t.table_name = c.table_name
          AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'app'`,
    );
    const live = new Map<string, Set<string>>();
    for (const row of result.rows) {
      const columns = live.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      live.set(row.table_name, columns);
    }
    return live;
  }

  it("parses the migration chain into exactly what PostgreSQL reports", async () => {
    const [catalog, live] = await Promise.all([
      loadSchemaCatalog(),
      liveColumns(),
    ]);

    const describeColumns = (columns: Map<string, Set<string>>) =>
      [...columns.entries()]
        .map(
          ([table, names]) => `${table}: ${[...names].sort().join(", ")}`,
        )
        .sort();
    const parsed = new Map(
      [...catalog.entries()].map(([table, entry]) => [table, entry.columns]),
    );

    expect(describeColumns(parsed)).toEqual(describeColumns(live));
    expect(live.size).toBe(44);
  });

  it("orders every integrity probe by the primary key PostgreSQL declares", async () => {
    const result = await handle.pool.query<{
      table_name: string;
      column_name: string;
      ordinal: number;
    }>(
      `SELECT rel.relname AS table_name,
              att.attname AS column_name,
              key.ordinal AS ordinal
         FROM pg_constraint AS con
         JOIN pg_class AS rel ON rel.oid = con.conrelid
         JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
         CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, ordinal)
         JOIN pg_attribute AS att
           ON att.attrelid = rel.oid AND att.attnum = key.attnum
        WHERE nsp.nspname = 'app' AND con.contype = 'p'`,
    );
    const primaryKeys = new Map<string, string[]>();
    for (const row of [...result.rows].sort((a, b) => a.ordinal - b.ordinal)) {
      primaryKeys.set(row.table_name, [
        ...(primaryKeys.get(row.table_name) ?? []),
        row.column_name,
      ]);
    }

    for (const probe of INTEGRITY_PROBES) {
      expect([probe.id, [...probe.key]]).toEqual([
        probe.id,
        primaryKeys.get(probe.table),
      ]);
    }
  });

  it("runs the exact statements the drill sends against a real server", async () => {
    const counts = await handle.pool.query<{ key: string; value: string }>(
      buildTableCountSql(),
    );
    expect(counts.rows.map((row) => row.key).sort()).toEqual(
      [...APP_TABLES].sort(),
    );

    // `COPY ... TO STDOUT` cannot travel over the extended query protocol, so
    // the inner projection is executed directly. The wrapper shape is asserted
    // first so this can never silently test a different statement.
    const innerQuery = (sqlText: string) => {
      expect(sqlText.startsWith("copy (")).toBe(true);
      expect(sqlText.endsWith(") to stdout")).toBe(true);
      return sqlText.slice("copy (".length, -") to stdout".length);
    };

    for (const table of APP_TABLES) {
      await handle.pool.query(innerQuery(buildCanonicalCopySql(table)));
    }
    for (const probe of INTEGRITY_PROBES) {
      await handle.pool.query(innerQuery(buildIntegrityCopySql(probe)));
    }
  });
});
