import { describe, expect, it } from "vitest";
import { canonicalize, contentHash } from "../hash.ts";
import { PageSnapshotsRepository } from "./page-snapshots.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: Call[];
  enqueue(...values: unknown[]): void;
  last(method: string): Call;
} {
  const calls: Call[] = [];
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
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  const executor = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  return {
    executor: executor as never,
    calls,
    enqueue: (...values: unknown[]) => results.push(...values),
    last(method: string): Call {
      const found = calls.findLast((call) => call.method === method);
      if (!found) throw new Error(`No ${method} call`);
      return found;
    },
  };
}

const extract = {
  z: [3, 2, 1],
  a: { enabled: true, label: "海外增长" },
};
const values = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  sitePageId: "00000000-0000-4000-8000-000000000003",
  dataSnapshotId: "00000000-0000-4000-8000-000000000004",
  contentHash: contentHash(extract),
  extract,
  capturedAt: "2026-07-22T03:04:05.678Z",
};

describe("PageSnapshotsRepository", () => {
  it("derives and persists the JCS payload and content hash from extract", async () => {
    const fake = fakeExecutor();
    const canonicalExtract = canonicalize(extract);
    const row = {
      id: "00000000-0000-4000-8000-000000000005",
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      site_page_id: values.sitePageId,
      data_snapshot_id: values.dataSnapshotId,
      content_hash: contentHash(extract),
      canonical_extract: canonicalExtract,
      extract,
      captured_at: values.capturedAt,
      created_at: values.capturedAt,
    };
    fake.enqueue([], [row]);

    await expect(
      new PageSnapshotsRepository(fake.executor).create(values),
    ).resolves.toEqual(row);

    expect(fake.last("values").args[0]).toMatchObject({
      content_hash: contentHash(extract),
      canonical_extract: canonicalExtract,
      extract,
    });
  });

  it("rejects a caller hash that does not match the derived JCS hash", async () => {
    const fake = fakeExecutor();

    await expect(
      new PageSnapshotsRepository(fake.executor).create({
        ...values,
        contentHash: "f".repeat(64),
      }),
    ).rejects.toThrow("page snapshot content hash does not match extract");
    expect(fake.calls).toEqual([]);
  });

  it("replays one exact legacy row without rewriting its unretained JCS bytes", async () => {
    const fake = fakeExecutor();
    const legacy = {
      id: "00000000-0000-4000-8000-000000000006",
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      site_page_id: values.sitePageId,
      data_snapshot_id: values.dataSnapshotId,
      content_hash: contentHash(extract),
      canonical_extract: null,
      extract,
      captured_at: values.capturedAt,
      created_at: values.capturedAt,
    };
    fake.enqueue([legacy]);

    await expect(
      new PageSnapshotsRepository(fake.executor).create(values),
    ).resolves.toEqual(legacy);
    expect(fake.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("converges identical duplicate legacy rows on the deterministic first row", async () => {
    const fake = fakeExecutor();
    const first = {
      id: "00000000-0000-4000-8000-000000000006",
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      site_page_id: values.sitePageId,
      data_snapshot_id: values.dataSnapshotId,
      content_hash: contentHash(extract),
      canonical_extract: null,
      extract,
      captured_at: values.capturedAt,
      created_at: "2026-07-22T03:04:06.000Z",
    };
    const duplicate = {
      ...first,
      id: "00000000-0000-4000-8000-000000000007",
      created_at: "2026-07-22T03:04:07.000Z",
    };
    fake.enqueue([first, duplicate]);

    await expect(
      new PageSnapshotsRepository(fake.executor).create(values),
    ).resolves.toEqual(first);
    expect(fake.calls.some((call) => call.method === "orderBy")).toBe(true);
    expect(fake.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("rejects duplicate legacy rows when any immutable replay value differs", async () => {
    const fake = fakeExecutor();
    const first = {
      id: "00000000-0000-4000-8000-000000000006",
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      site_page_id: values.sitePageId,
      data_snapshot_id: values.dataSnapshotId,
      content_hash: contentHash(extract),
      canonical_extract: null,
      extract,
      captured_at: values.capturedAt,
      created_at: "2026-07-22T03:04:06.000Z",
    };
    const conflicting = {
      ...first,
      id: "00000000-0000-4000-8000-000000000007",
      extract: { ...extract, a: { enabled: false, label: "海外增长" } },
      created_at: "2026-07-22T03:04:07.000Z",
    };
    fake.enqueue([first, conflicting]);

    await expect(
      new PageSnapshotsRepository(fake.executor).create(values),
    ).rejects.toThrow("page snapshot replay conflicts with immutable values");
    expect(fake.calls.some((call) => call.method === "insert")).toBe(false);
  });
});
