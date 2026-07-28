import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeClient {
  readonly connect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly query: ReturnType<
    typeof vi.fn<
      (
        sql: string,
        values?: readonly unknown[],
      ) => Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>
    >
  >;
  readonly end: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

const pgMock = vi.hoisted(() => ({
  clients: [] as FakeClient[],
  Client: vi.fn(function MockPgClient() {
    const client = pgMock.clients.shift();
    if (!client) throw new Error("missing fake PostgreSQL client");
    return client;
  }),
}));

vi.mock("pg", () => ({
  default: {
    Client: pgMock.Client,
  },
}));

import {
  listMigrationFiles,
  MIGRATION_LOCK_KEYS,
  runMigrations,
} from "./migrate.ts";

const LOCK_SQL = "SELECT pg_advisory_lock($1, $2)";
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1, $2) AS released";
const VERSION_EXISTS_SQL =
  "SELECT to_regclass('app.schema_migration_version') AS regclass";

function installClient(
  query: FakeClient["query"],
  events: string[],
): FakeClient {
  const client: FakeClient = {
    connect: vi.fn(async () => {
      events.push("connect");
    }),
    query,
    end: vi.fn(async () => {
      events.push("end");
    }),
  };
  pgMock.clients.push(client);
  return client;
}

afterEach(() => {
  pgMock.clients.length = 0;
  pgMock.Client.mockClear();
});

describe("runMigrations advisory serialization", () => {
  it("locks before reading the version and holds the lock through every migration", async () => {
    const events: string[] = [];
    const query = vi.fn(
      async (
        sql: string,
        values?: readonly unknown[],
      ): Promise<{
        readonly rows: ReadonlyArray<Record<string, unknown>>;
      }> => {
        if (sql === LOCK_SQL) {
          events.push("lock");
          expect(values).toEqual(MIGRATION_LOCK_KEYS);
          return { rows: [{}] };
        }
        if (sql === VERSION_EXISTS_SQL) {
          events.push("version-read");
          return { rows: [{ regclass: null }] };
        }
        if (sql === UNLOCK_SQL) {
          events.push("unlock");
          expect(values).toEqual(MIGRATION_LOCK_KEYS);
          return { rows: [{ released: true }] };
        }
        events.push("migration");
        return { rows: [] };
      },
    );
    const client = installClient(query, events);

    const applied = await runMigrations(
      "postgresql://unused:unused@127.0.0.1:5432/unused",
    );

    expect(applied).toEqual(listMigrationFiles());
    expect(events[0]).toBe("connect");
    expect(events[1]).toBe("lock");
    expect(events[2]).toBe("version-read");
    expect(events.slice(3, -2)).toEqual(
      listMigrationFiles().map(() => "migration"),
    );
    expect(events.slice(-2)).toEqual(["unlock", "end"]);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("unlocks and ends the session when a migration fails", async () => {
    const events: string[] = [];
    const migrationFailure = new Error("customer-derived migration detail");
    const query = vi.fn(
      async (
        sql: string,
      ): Promise<{
        readonly rows: ReadonlyArray<Record<string, unknown>>;
      }> => {
        if (sql === LOCK_SQL) {
          events.push("lock");
          return { rows: [{}] };
        }
        if (sql === VERSION_EXISTS_SQL) {
          events.push("version-read");
          return { rows: [{ regclass: null }] };
        }
        if (sql === UNLOCK_SQL) {
          events.push("unlock");
          return { rows: [{ released: true }] };
        }
        events.push("migration-failed");
        throw migrationFailure;
      },
    );
    const client = installClient(query, events);

    await expect(
      runMigrations("postgresql://unused:unused@127.0.0.1:5432/unused"),
    ).rejects.toBe(migrationFailure);

    expect(events).toEqual([
      "connect",
      "lock",
      "version-read",
      "migration-failed",
      "unlock",
      "end",
    ]);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("still ends the session and reports cleanup failure after a successful run", async () => {
    const events: string[] = [];
    const unlockFailure = new Error("unlock failed");
    const query = vi.fn(
      async (
        sql: string,
      ): Promise<{
        readonly rows: ReadonlyArray<Record<string, unknown>>;
      }> => {
        if (sql === LOCK_SQL) {
          events.push("lock");
          return { rows: [{}] };
        }
        if (sql === VERSION_EXISTS_SQL) {
          events.push("version-read");
          return {
            rows: [{ regclass: "app.schema_migration_version" }],
          };
        }
        if (sql === "SELECT migration_version FROM app.schema_migration_version") {
          events.push("version-value");
          return {
            rows: [
              {
                migration_version:
                  listMigrationFiles().at(-1)?.replace(/\.sql$/u, "") ?? "",
              },
            ],
          };
        }
        if (sql === UNLOCK_SQL) {
          events.push("unlock-failed");
          throw unlockFailure;
        }
        throw new Error("unexpected query");
      },
    );
    const client = installClient(query, events);

    await expect(
      runMigrations("postgresql://unused:unused@127.0.0.1:5432/unused"),
    ).rejects.toBe(unlockFailure);

    expect(events).toEqual([
      "connect",
      "lock",
      "version-read",
      "version-value",
      "unlock-failed",
      "end",
    ]);
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
