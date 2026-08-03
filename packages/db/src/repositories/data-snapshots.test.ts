import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { dataSnapshots } from "../schema.ts";
import { DataSnapshotsRepository } from "./data-snapshots.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: RecordedCall[];
  enqueue(...results: unknown[]): void;
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
  };
}

function compiledOrderBy(calls: readonly RecordedCall[]): string[] {
  const orderBy = calls.findLast((call) => call.method === "orderBy");
  if (!orderBy) throw new Error("No orderBy call was recorded");
  return orderBy.args.map(
    (expression) => new PgDialect().sqlToQuery(expression as never).sql,
  );
}

function compiledCall(
  calls: readonly RecordedCall[],
  method: string,
  argumentIndex = 0,
): { readonly sql: string; readonly params: unknown[] } {
  const call = calls.findLast((candidate) => candidate.method === method);
  if (!call) throw new Error(`No ${method} call was recorded`);
  return new PgDialect().sqlToQuery(call.args[argumentIndex] as never);
}

const scope = { workspaceId: "workspace-1", projectId: "project-1" };

describe("DataSnapshotsRepository latest selection", () => {
  it("resolves only the exact collection-run snapshot and rejects ambiguous lineage", async () => {
    const snapshot = {
      id: "snapshot-1",
      collection_run_id: "collection-1",
    };
    const exact = fakeExecutor();
    exact.enqueue([snapshot]);
    const repository = new DataSnapshotsRepository(exact.executor);

    await expect(
      repository.findByCollectionRunId(scope, "collection-1"),
    ).resolves.toBe(snapshot);
    const where = compiledCall(exact.calls, "where");
    expect(where.sql).toContain('"app"."data_snapshots"."workspace_id" =');
    expect(where.sql).toContain('"app"."data_snapshots"."project_id" =');
    expect(where.sql).toContain(
      '"app"."data_snapshots"."collection_run_id" =',
    );
    expect(where.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "collection-1",
      ]),
    );
    expect(exact.calls.findLast((call) => call.method === "limit")?.args).toEqual([
      2,
    ]);

    const ambiguous = fakeExecutor();
    ambiguous.enqueue([snapshot, { ...snapshot, id: "snapshot-2" }]);
    await expect(
      new DataSnapshotsRepository(
        ambiguous.executor,
      ).findByCollectionRunId(scope, "collection-1"),
    ).rejects.toThrow(/ambiguous Snapshot lineage/);
  });

  it.each([
    {
      label: "source connection",
      select: (repository: DataSnapshotsRepository) =>
        repository.findLatestByConnection(scope, "connection-1"),
    },
    {
      label: "provider",
      select: (repository: DataSnapshotsRepository) =>
        repository.findLatestByProvider(scope, "crawl"),
    },
  ])(
    "uses the lowest snapshot id when $label snapshots have equal captured_at",
    async ({ select }) => {
      const fake = fakeExecutor();
      fake.enqueue([]);

      await select(new DataSnapshotsRepository(fake.executor));

      expect(compiledOrderBy(fake.calls)).toEqual([
        '"app"."data_snapshots"."captured_at" desc',
        '"app"."data_snapshots"."id" asc',
      ]);
    },
  );

  it("selects one latest completed, usable, source-compatible snapshot per provider within one site", async () => {
    const fake = fakeExecutor();
    fake.enqueue([]);
    const repository = new DataSnapshotsRepository(fake.executor);

    await expect(
      repository.findLatestEligibleBySite(scope, "site-1", [
        {
          provider: "crawl",
          datasetKey: "crawl.site_graph.v1",
          methodVersion: "crawl.site_graph.v2",
          collectionOperation: "site_graph",
          collectionMethodVersion: "crawl.site_graph.v2",
        },
        {
          provider: "gsc",
          datasetKey: "gsc.page_query_daily.v1",
          methodVersion: "gsc.page_query_daily.v1",
          collectionOperation: "search_analytics",
          collectionMethodVersion: "gsc.page_query_daily.v1",
        },
      ]),
    ).resolves.toEqual([]);

    const distinct = fake.calls.findLast(
      (call) => call.method === "selectDistinctOn",
    );
    expect(distinct?.args[0]).toHaveLength(1);
    expect((distinct?.args[0] as readonly unknown[])[0]).toBe(
      dataSnapshots.provider,
    );

    const where = compiledCall(fake.calls, "where");
    expect(where.sql).toContain('"app"."data_snapshots"."workspace_id" =');
    expect(where.sql).toContain('"app"."data_snapshots"."project_id" =');
    expect(where.sql).toContain('"app"."data_snapshots"."site_id" =');
    expect(where.sql).toContain('"app"."data_snapshots"."availability" =');
    expect(where.sql).toContain('"app"."async_runs"."status" =');
    expect(where.sql).toContain('"app"."data_snapshots"."provider" =');
    expect(where.sql).toContain('"app"."data_snapshots"."dataset_key" =');
    expect(where.sql).toContain('"app"."data_snapshots"."method_version" =');
    expect(where.sql).toContain('"app"."collection_runs"."operation" =');
    expect(where.sql).toContain(
      '"app"."collection_runs"."method_version" =',
    );
    expect(where.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "site-1",
        "available",
        "partial",
        "completed",
        "partial",
        "crawl",
        "crawl.site_graph.v1",
        "crawl.site_graph.v2",
        "site_graph",
        "crawl.site_graph.v2",
        "gsc",
        "gsc.page_query_daily.v1",
        "gsc.page_query_daily.v1",
        "search_analytics",
        "gsc.page_query_daily.v1",
      ]),
    );

    expect(compiledOrderBy(fake.calls)).toEqual([
      '"app"."data_snapshots"."provider" asc',
      '"app"."data_snapshots"."captured_at" desc',
      '"app"."data_snapshots"."id" asc',
    ]);

    const joins = fake.calls.filter((call) => call.method === "innerJoin");
    expect(joins).toHaveLength(2);
    for (const join of joins) {
      const predicate = new PgDialect().sqlToQuery(join.args[1] as never);
      expect(predicate.sql).toContain('"workspace_id" =');
      expect(predicate.sql).toContain('"project_id" =');
      expect(predicate.params).toEqual(
        expect.arrayContaining([scope.workspaceId, scope.projectId]),
      );
    }
  });

  it("selects the exact current GSC collection operation and method contract", async () => {
    const gscSnapshot = {
      id: "snapshot-gsc",
      provider: "gsc",
      dataset_key: "gsc.page_query_daily.v1",
      method_version: "gsc.page_query_daily.v1",
    };
    const fake = fakeExecutor();
    fake.enqueue([gscSnapshot]);

    await expect(
      new DataSnapshotsRepository(fake.executor).findLatestEligibleBySite(
        scope,
        "site-1",
        [
          {
            provider: "gsc",
            datasetKey: "gsc.page_query_daily.v1",
            methodVersion: "gsc.page_query_daily.v1",
            collectionOperation: "search_analytics",
            collectionMethodVersion: "gsc.page_query_daily.v1",
          },
        ],
      ),
    ).resolves.toEqual([gscSnapshot]);

    const where = compiledCall(fake.calls, "where");
    expect(where.params).toEqual(
      expect.arrayContaining([
        "gsc",
        "gsc.page_query_daily.v1",
        "search_analytics",
        "gsc.page_query_daily.v1",
      ]),
    );
    const collectionJoin = fake.calls.find(
      (call) => call.method === "innerJoin",
    );
    const join = new PgDialect().sqlToQuery(
      collectionJoin?.args[1] as never,
    );
    expect(join.sql).not.toContain(
      '"collection_runs"."method_version" = "app"."data_snapshots"."method_version"',
    );
  });

  it("allows multiple exact version contracts for one provider and selects the newest compatible Snapshot", async () => {
    const duplicateProvider = [
      {
        provider: "gsc",
        datasetKey: "gsc.page_query_daily.v1",
        methodVersion: "gsc.page_query_daily.v1",
        collectionOperation: "search_analytics",
        collectionMethodVersion: "gsc.page_query_daily.v1",
      },
      {
        provider: "gsc",
        datasetKey: "gsc.page_query_daily.v1",
        methodVersion: "gsc.page_query_daily.v2",
        collectionOperation: "search_analytics",
        collectionMethodVersion: "gsc.search_analytics.v2",
      },
    ];
    const fake = fakeExecutor();
    fake.enqueue([]);
    const repository = new DataSnapshotsRepository(fake.executor);

    await expect(
      repository.findLatestEligibleBySite(
        scope,
        "site-1",
        duplicateProvider,
      ),
    ).resolves.toEqual([]);
    const where = compiledCall(fake.calls, "where");
    expect(where.params).toEqual(
      expect.arrayContaining([
        "gsc.page_query_daily.v1",
        "gsc.page_query_daily.v2",
        "gsc.search_analytics.v2",
      ]),
    );
  });

  it("rejects unbounded latest-eligible selectors before querying", async () => {
    const fake = fakeExecutor();
    const repository = new DataSnapshotsRepository(fake.executor);

    await expect(
      repository.findLatestEligibleBySite(scope, "", [
        {
          provider: "crawl",
          datasetKey: "crawl.site_graph.v1",
          methodVersion: "crawl.site_graph.v2",
          collectionOperation: "site_graph",
          collectionMethodVersion: "crawl.site_graph.v2",
        },
      ]),
    ).rejects.toThrow(/between 1 and 256 characters/);
    await expect(
      repository.findLatestEligibleBySite(scope, "site-1", [
        {
          provider: "crawl",
          datasetKey: "crawl.site_graph.v1",
          methodVersion: "x".repeat(257),
          collectionOperation: "site_graph",
          collectionMethodVersion: "crawl.site_graph.v2",
        },
      ]),
    ).rejects.toThrow(/between 1 and 256 characters/);
    expect(fake.calls).toEqual([]);
  });
});
