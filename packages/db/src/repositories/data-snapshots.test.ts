import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
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

const scope = { workspaceId: "workspace-1", projectId: "project-1" };

describe("DataSnapshotsRepository latest selection", () => {
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
});
