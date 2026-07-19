import { describe, expect, it } from "vitest";
import { StorageObjectReferencesRepository } from "./storage-object-references.ts";

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: string[];
  enqueue(...values: unknown[]): void;
} {
  const calls: string[] = [];
  const results: unknown[] = [];
  const take = () => (results.length > 0 ? results.shift() : []);
  const query: object = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(take()).then(resolve, reject);
        }
        return (..._args: unknown[]) => {
          calls.push(String(property));
          return query;
        };
      },
    },
  );
  const executor = new Proxy(
    {},
    {
      get(_target, property) {
        return (..._args: unknown[]) => {
          calls.push(String(property));
          if (property === "execute") {
            return Promise.resolve({ rows: take() });
          }
          return query;
        };
      },
    },
  );
  return {
    executor: executor as never,
    calls,
    enqueue: (...values: unknown[]) => results.push(...values),
  };
}

describe("StorageObjectReferencesRepository", () => {
  it("returns the exact union of snapshot, CSV preview, and export canonical keys", async () => {
    const fake = fakeExecutor();
    fake.enqueue(
      [{ key: "snapshot-raw/p/r/snapshot" }, { key: null }],
      [{ key: "raw-import/p/r/preview" }],
      [
        { key: "export/p/r/bundle" },
        { key: "snapshot-raw/p/r/snapshot" },
      ],
    );
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(
      repository.findReferencedKeys([
        "snapshot-raw/p/r/snapshot",
        "raw-import/p/r/preview",
        "export/p/r/bundle",
        "raw/p/r/orphan",
      ]),
    ).resolves.toEqual(
      new Set([
        "snapshot-raw/p/r/snapshot",
        "raw-import/p/r/preview",
        "export/p/r/bundle",
      ]),
    );
    expect(fake.calls.filter((call) => call === "select")).toHaveLength(3);
  });

  it("does not query canonical tables for an empty candidate set", async () => {
    const fake = fakeExecutor();
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(repository.findReferencedKeys([])).resolves.toEqual(new Set());
    expect(fake.calls).toEqual([]);
  });

  it("reads one validated cutoff time from the canonical database clock", async () => {
    const fake = fakeExecutor();
    fake.enqueue([{ now: "2026-07-19T12:00:00.000Z" }]);
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(repository.databaseNow()).resolves.toEqual(
      new Date("2026-07-19T12:00:00.000Z"),
    );
    expect(fake.calls.filter((call) => call === "execute")).toHaveLength(1);
  });
});
