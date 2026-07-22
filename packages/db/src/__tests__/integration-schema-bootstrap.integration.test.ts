import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import {
  LATEST_APP_MIGRATION,
  readMigrationVersion,
} from "../migration-version.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

/**
 * This suite intentionally does not invoke runMigrations itself. It proves the
 * integration preflight makes every database-backed test file independent of
 * file ordering and of a developer's previously migrated disposable database.
 */
describeDb("integration schema bootstrap", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("starts each integration file on the latest checked-in schema", async () => {
    await expect(readMigrationVersion(handle.pool)).resolves.toBe(
      LATEST_APP_MIGRATION,
    );
    const column = await handle.pool.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'app'
           AND table_name = 'page_snapshots'
           AND column_name = 'canonical_extract'
       ) AS present`,
    );
    expect(column.rows).toEqual([{ present: true }]);
  });
});
