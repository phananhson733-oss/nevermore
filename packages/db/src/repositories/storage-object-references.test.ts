import { describe, expect, it } from "vitest";
import {
  EXPORT_OBJECT_RETENTION_MS,
  StorageObjectReferencesRepository,
  isStorageObjectExpired,
} from "./storage-object-references.ts";

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

  it("acquires a deduplicated object-key lock set in one transaction statement", async () => {
    const fake = fakeExecutor();
    fake.enqueue([]);
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(
      repository.lockObjectKeysForTransaction(["z-key", "a-key", "z-key"]),
    ).resolves.toBeUndefined();

    expect(fake.calls.filter((call) => call === "execute")).toHaveLength(1);
  });

  it("does not issue an advisory-lock statement for an empty key set", async () => {
    const fake = fakeExecutor();
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(
      repository.lockObjectKeysForTransaction([]),
    ).resolves.toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it("returns conservative canonical completion anchors for export runs", async () => {
    const fake = fakeExecutor();
    fake.enqueue([
      {
        key: "export/p/complete/nonce",
        referenced_bundle_id: null,
        reference_status: null,
        reference_completed_at: null,
        path_kind: "export",
        path_status: "completed",
        path_completed_at: "2026-07-19T12:00:00.000Z",
      },
      {
        key: "export/p/incomplete/nonce",
        referenced_bundle_id: null,
        reference_status: null,
        reference_completed_at: null,
        path_kind: "export",
        path_status: "running",
        path_completed_at: null,
      },
      {
        key: "export/p/failed/nonce",
        referenced_bundle_id: null,
        reference_status: null,
        reference_completed_at: null,
        path_kind: "export",
        path_status: "failed",
        path_completed_at: "2026-07-19T12:00:00.000Z",
      },
      {
        key: "export/not-a-uuid/not-a-uuid/referenced",
        referenced_bundle_id: "bundle-id",
        reference_status: "completed",
        reference_completed_at: "2026-07-20T12:00:00.000Z",
        path_kind: null,
        path_status: null,
        path_completed_at: null,
      },
    ]);
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(
      repository.findExportDeletionFences([
        {
          key: "export/p/complete/nonce",
          projectId: "p",
          runId: "complete",
        },
        {
          key: "export/p/incomplete/nonce",
          projectId: "p",
          runId: "incomplete",
        },
        {
          key: "export/p/failed/nonce",
          projectId: "p",
          runId: "failed",
        },
        {
          key: "export/p/orphan/nonce",
          projectId: "p",
          runId: "orphan",
        },
        {
          key: "export/not-a-uuid/not-a-uuid/referenced",
          projectId: "not-a-uuid",
          runId: "not-a-uuid",
        },
      ]),
    ).resolves.toEqual(
      new Map([
        [
          "export/p/complete/nonce",
          {
            referenced: false,
            completedAt: "2026-07-19T12:00:00.000Z",
          },
        ],
        [
          "export/p/incomplete/nonce",
          { referenced: false, completedAt: null },
        ],
        [
          "export/not-a-uuid/not-a-uuid/referenced",
          {
            referenced: true,
            completedAt: "2026-07-20T12:00:00.000Z",
          },
        ],
      ]),
    );
    expect(fake.calls.filter((call) => call === "execute")).toHaveLength(1);
  });

  it("fails closed for non-safe or inconsistent export run states", async () => {
    const fake = fakeExecutor();
    fake.enqueue([
      {
        key: "export/p/queued/nonce",
        referenced_bundle_id: null,
        reference_status: null,
        reference_completed_at: null,
        path_kind: "export",
        path_status: "queued",
        path_completed_at: null,
      },
      {
        key: "export/p/completed-without-anchor/nonce",
        referenced_bundle_id: null,
        reference_status: null,
        reference_completed_at: null,
        path_kind: "export",
        path_status: "completed",
        path_completed_at: null,
      },
      {
        key: "export/p/wrong-kind/nonce",
        referenced_bundle_id: null,
        reference_status: null,
        reference_completed_at: null,
        path_kind: "diagnostic",
        path_status: "completed",
        path_completed_at: "2026-01-01T00:00:00.000Z",
      },
      {
        key: "export/p/unknown/nonce",
        referenced_bundle_id: null,
        reference_status: null,
        reference_completed_at: null,
        path_kind: "export",
        path_status: "future-status",
        path_completed_at: null,
      },
      {
        key: "export/p/failed-path/referenced",
        referenced_bundle_id: "bundle-id",
        reference_status: "running",
        reference_completed_at: null,
        path_kind: "export",
        path_status: "failed",
        path_completed_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(
      repository.findExportDeletionFences([
        { key: "export/p/queued/nonce", projectId: "p", runId: "queued" },
        {
          key: "export/p/completed-without-anchor/nonce",
          projectId: "p",
          runId: "completed-without-anchor",
        },
        {
          key: "export/p/wrong-kind/nonce",
          projectId: "p",
          runId: "wrong-kind",
        },
        {
          key: "export/p/unknown/nonce",
          projectId: "p",
          runId: "unknown",
        },
        {
          key: "export/p/failed-path/referenced",
          projectId: "p",
          runId: "failed-path",
        },
        { key: "export/p/orphan/nonce", projectId: "p", runId: "orphan" },
      ]),
    ).resolves.toEqual(
      new Map([
        ["export/p/queued/nonce", { referenced: false, completedAt: null }],
        [
          "export/p/completed-without-anchor/nonce",
          { referenced: false, completedAt: null },
        ],
        ["export/p/unknown/nonce", { referenced: false, completedAt: null }],
        [
          "export/p/failed-path/referenced",
          { referenced: true, completedAt: null },
        ],
      ]),
    );
  });

  it("does not query export completion anchors for an empty candidate set", async () => {
    const fake = fakeExecutor();
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(repository.findExportDeletionFences([])).resolves.toEqual(
      new Map(),
    );
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

  it("rejects an invalid canonical database clock", async () => {
    const fake = fakeExecutor();
    fake.enqueue([{ now: "not-a-date" }]);
    const repository = new StorageObjectReferencesRepository(fake.executor);

    await expect(repository.databaseNow()).rejects.toThrow(
      /canonical database returned an invalid clock value/,
    );
  });
});

describe("isStorageObjectExpired", () => {
  it("uses an inclusive cutoff from the supplied database clock", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const boundary = new Date(
      now.getTime() - EXPORT_OBJECT_RETENTION_MS,
    ).toISOString();

    expect(
      isStorageObjectExpired(boundary, now, EXPORT_OBJECT_RETENTION_MS),
    ).toBe(true);
    expect(
      isStorageObjectExpired(
        new Date(Date.parse(boundary) + 1),
        now,
        EXPORT_OBJECT_RETENTION_MS,
      ),
    ).toBe(false);
  });

  it("fails closed on invalid timestamps or retention durations", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");

    expect(() =>
      isStorageObjectExpired("not-a-date", now, EXPORT_OBJECT_RETENTION_MS),
    ).toThrow(/valid dates/);
    expect(() => isStorageObjectExpired(now, now, 0)).toThrow(
      /positive integer/,
    );
  });
});
