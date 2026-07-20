import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DB_LOCK_TIMEOUT_MS,
  DB_STATEMENT_TIMEOUT_MS,
  createDbHandle,
  type DbHandle,
} from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { StorageObjectReferencesRepository } from "../repositories/storage-object-references.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function remainsPending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => false),
    new Promise<true>((resolve) => {
      const timer = setTimeout(() => resolve(true), 50);
      timer.unref();
    }),
  ]);
}

describeDb("storage object transaction advisory locks", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!, 4);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("applies the finite writer-fence timeouts to real pooled sessions", async () => {
    const result = await handle.pool.query<{
      name: string;
      setting: string;
      unit: string | null;
    }>(`
      select name, setting, unit
      from pg_settings
      where name in (
        'lock_timeout',
        'statement_timeout',
        'idle_in_transaction_session_timeout'
      )
      order by name
    `);

    expect(
      Object.fromEntries(
        result.rows.map((row) => [
          row.name,
          Number(row.setting) * (row.unit === "s" ? 1_000 : 1),
        ]),
      ),
    ).toEqual({
      idle_in_transaction_session_timeout:
        DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      lock_timeout: DB_LOCK_TIMEOUT_MS,
      statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    });
  });

  it("keeps cleanup blocked until an upload-to-reference transaction commits", async () => {
    const key = `raw-import/${randomUUID()}/${randomUUID()}/${randomUUID()}`;
    const writerLocked = deferred();
    const releaseWriter = deferred();
    const cleanupLocked = deferred();

    const writer = handle.db.transaction(async (tx) => {
      await new StorageObjectReferencesRepository(
        tx,
      ).lockObjectKeysForTransaction([key]);
      writerLocked.resolve();
      await releaseWriter.promise;
    });
    await writerLocked.promise;

    const cleanup = handle.db.transaction(async (tx) => {
      await new StorageObjectReferencesRepository(
        tx,
      ).lockObjectKeysForTransaction([key]);
      cleanupLocked.resolve();
    });

    await expect(remainsPending(cleanupLocked.promise)).resolves.toBe(true);
    releaseWriter.resolve();
    await writer;
    await cleanupLocked.promise;
    await cleanup;
  });

  it("sorts overlapping multi-key acquisitions so maintenance workers cannot deadlock", async () => {
    const prefix = `snapshot-raw/${randomUUID()}/${randomUUID()}`;
    const firstKey = `${prefix}/a`;
    const secondKey = `${prefix}/b`;
    const firstLocked = deferred();
    const releaseFirst = deferred();
    const secondLocked = deferred();

    const first = handle.db.transaction(async (tx) => {
      await new StorageObjectReferencesRepository(
        tx,
      ).lockObjectKeysForTransaction([secondKey, firstKey, secondKey]);
      firstLocked.resolve();
      await releaseFirst.promise;
    });
    await firstLocked.promise;

    const second = handle.db.transaction(async (tx) => {
      await new StorageObjectReferencesRepository(
        tx,
      ).lockObjectKeysForTransaction([firstKey, secondKey]);
      secondLocked.resolve();
    });

    await expect(remainsPending(secondLocked.promise)).resolves.toBe(true);
    releaseFirst.resolve();
    await first;
    await secondLocked.promise;
    await second;
  });
});
