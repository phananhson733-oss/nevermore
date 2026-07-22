import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DataSnapshotsRepository } from "./data-snapshots.ts";
import { PageSnapshotsRepository } from "./page-snapshots.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: RecordedCall[];
  enqueue(...results: unknown[]): void;
  last(method: string): RecordedCall;
} {
  const calls: RecordedCall[] = [];
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
    last(method: string): RecordedCall {
      const found = calls.findLast((call) => call.method === method);
      if (!found) throw new Error(`No ${method} call was recorded`);
      return found;
    },
  };
}

function compile(expression: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(expression as never);
}

function compiledOrderBy(calls: readonly RecordedCall[]): string[] {
  const orderBy = calls.findLast((call) => call.method === "orderBy");
  if (!orderBy) throw new Error("No orderBy call was recorded");
  return orderBy.args.map((expression) => compile(expression).sql);
}

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};

describe("Product Profile snapshot selection repositories", () => {
  it("selects the deterministic latest eligible Crawl snapshot for the exact scope and method", async () => {
    const fake = fakeExecutor();
    const row = {
      id: "00000000-0000-4000-8000-000000000003",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "00000000-0000-4000-8000-000000000004",
      collection_run_id: "00000000-0000-4000-8000-000000000005",
      source_connection_id: null,
      provider: "crawl",
      dataset_key: "crawl.site_graph.v1",
      schema_version: "crawl.site_graph.0.3.0",
      method_version: "crawl.0.3.0",
      captured_at: "2026-07-22T00:00:00.000Z",
      availability: "partial",
      limitation: "Static HTML only.",
      row_count: 3,
      checksum: "a".repeat(64),
      created_at: "2026-07-22T00:00:01.000Z",
    };
    fake.enqueue([row]);

    await expect(
      new DataSnapshotsRepository(
        fake.executor,
      ).findLatestEligibleCrawlBySite(
        scope,
        row.site_id,
        row.dataset_key,
        row.method_version,
      ),
    ).resolves.toEqual(row);

    const where = compile(fake.last("where").args[0]);
    expect(where.sql).toContain('"app"."data_snapshots"."workspace_id" = $1');
    expect(where.sql).toContain('"app"."data_snapshots"."project_id" = $2');
    expect(where.sql).toContain('"app"."data_snapshots"."site_id" = $3');
    expect(where.sql).toContain('"app"."data_snapshots"."provider" = $4');
    expect(where.sql).toContain('"app"."data_snapshots"."dataset_key" = $5');
    expect(where.sql).toContain('"app"."data_snapshots"."method_version" = $6');
    expect(where.sql).toContain(
      '"app"."data_snapshots"."availability" in ($7, $8)',
    );
    expect(where.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      row.site_id,
      "crawl",
      row.dataset_key,
      row.method_version,
      "available",
      "partial",
    ]);
    expect(compiledOrderBy(fake.calls)).toEqual([
      '"app"."data_snapshots"."captured_at" desc',
      '"app"."data_snapshots"."id" asc',
    ]);
    expect(fake.last("limit").args).toEqual([1]);

    const projection = fake.calls.find((call) => call.method === "select")
      ?.args[0] as Record<string, unknown>;
    expect(Object.keys(projection)).toEqual([
      "id",
      "workspace_id",
      "project_id",
      "site_id",
      "collection_run_id",
      "source_connection_id",
      "provider",
      "dataset_key",
      "schema_version",
      "method_version",
      "captured_at",
      "availability",
      "limitation",
      "row_count",
      "checksum",
      "created_at",
    ]);
    expect(projection).not.toHaveProperty("raw_object_key");
    expect(projection).not.toHaveProperty("summary");
  });

  it.each([
    ["siteId", ""],
    ["datasetKey", "   "],
    ["methodVersion", "x".repeat(257)],
  ])("rejects an unbounded or empty %s before querying", async (key, value) => {
    const fake = fakeExecutor();
    const input = {
      siteId: "00000000-0000-4000-8000-000000000004",
      datasetKey: "crawl.site_graph.v1",
      methodVersion: "crawl.0.3.0",
      [key]: value,
    };

    await expect(
      new DataSnapshotsRepository(
        fake.executor,
      ).findLatestEligibleCrawlBySite(
        scope,
        input.siteId,
        input.datasetKey,
        input.methodVersion,
      ),
    ).rejects.toThrow(/between 1 and 256 characters/);
    expect(fake.calls).toEqual([]);
  });

  it("lists one frozen DataSnapshot's PageSnapshots with explicit SitePage identity and ASCII order", async () => {
    const fake = fakeExecutor();
    fake.enqueue([]);
    const dataSnapshotId = "00000000-0000-4000-8000-000000000006";

    await expect(
      new PageSnapshotsRepository(
        fake.executor,
      ).listByDataSnapshotWithSitePageIdentity(scope, dataSnapshotId),
    ).resolves.toEqual([]);

    const select = fake.calls.find((call) => call.method === "select")?.args[0];
    expect(Object.keys(select as object)).toEqual([
      "page_snapshot_id",
      "workspace_id",
      "project_id",
      "site_page_id",
      "data_snapshot_id",
      "content_hash",
      "canonical_extract",
      "extract",
      "captured_at",
      "created_at",
      "normalized_url",
      "normalized_url_hash",
      "site_id",
    ]);
    expect(select).not.toHaveProperty("template_key");

    const join = compile(fake.last("innerJoin").args[1]);
    expect(join.sql).toContain(
      '"app"."page_snapshots"."site_page_id" = "app"."site_pages"."id"',
    );
    const where = compile(fake.last("where").args[0]);
    expect(where.sql).toContain('"app"."page_snapshots"."workspace_id" = $1');
    expect(where.sql).toContain('"app"."page_snapshots"."project_id" = $2');
    expect(where.sql).toContain('"app"."site_pages"."workspace_id" = $3');
    expect(where.sql).toContain('"app"."site_pages"."project_id" = $4');
    expect(where.sql).toContain(
      '"app"."page_snapshots"."data_snapshot_id" = $5',
    );
    expect(where.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      scope.workspaceId,
      scope.projectId,
      dataSnapshotId,
    ]);
    expect(compiledOrderBy(fake.calls)).toEqual([
      '"app"."site_pages"."normalized_url" collate "C" asc',
      '"app"."page_snapshots"."id" asc',
    ]);
  });

  it("finds a deduplicated bounded ID set with the same scoped identity join", async () => {
    const fake = fakeExecutor();
    fake.enqueue([]);
    const first = "00000000-0000-4000-8000-000000000010";
    const second = "00000000-0000-4000-8000-000000000011";

    await expect(
      new PageSnapshotsRepository(fake.executor).findByIdsWithSitePageIdentity(
        scope,
        [second, first, second],
      ),
    ).resolves.toEqual([]);

    const where = compile(fake.last("where").args[0]);
    expect(where.sql).toContain('"app"."page_snapshots"."workspace_id" = $1');
    expect(where.sql).toContain('"app"."page_snapshots"."project_id" = $2');
    expect(where.sql).toContain('"app"."site_pages"."workspace_id" = $3');
    expect(where.sql).toContain('"app"."site_pages"."project_id" = $4');
    expect(where.sql).toContain('"app"."page_snapshots"."id" in ($5, $6)');
    expect(where.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      scope.workspaceId,
      scope.projectId,
      second,
      first,
    ]);
    expect(compiledOrderBy(fake.calls)).toEqual([
      '"app"."site_pages"."normalized_url" collate "C" asc',
      '"app"."page_snapshots"."id" asc',
    ]);
  });

  it("returns an empty explicit-ID lookup without touching the executor", async () => {
    const fake = fakeExecutor();

    await expect(
      new PageSnapshotsRepository(
        fake.executor,
      ).findByIdsWithSitePageIdentity(scope, []),
    ).resolves.toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("rejects more than 100 requested PageSnapshot IDs before querying", async () => {
    const fake = fakeExecutor();
    const ids = Array.from({ length: 101 }, (_, index) =>
      index.toString().padStart(36, "0"),
    );

    await expect(
      new PageSnapshotsRepository(
        fake.executor,
      ).findByIdsWithSitePageIdentity(scope, ids),
    ).rejects.toThrow("at most 100 IDs");
    expect(fake.calls).toEqual([]);
  });
});
