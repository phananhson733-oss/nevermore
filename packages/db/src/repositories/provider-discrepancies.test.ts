import { describe, expect, it, vi } from "vitest";
import {
  ProviderDiscrepanciesRepository,
  type ProviderDiscrepancyRow,
} from "./provider-discrepancies.ts";

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
          if (property === "execute") return Promise.resolve(take());
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

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const row = {
  id: "discrepancy-1",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  metric_key: "gsc.clicks",
  subject_type: "url",
  subject_ref: "https://example.com/",
  left_observation_id: "observation-a",
  right_observation_id: "observation-z",
  resolution: "unresolved",
  created_at: "2026-07-19T00:00:00.000Z",
} satisfies ProviderDiscrepancyRow;

describe("ProviderDiscrepanciesRepository", () => {
  it("takes a transaction-scoped collection window lock", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);

    await repo.lockCollectionWindow(scope, "gsc", {
      start: "2026-06-01",
      end: "2026-06-30",
    });

    expect(fake.last("execute").args).toHaveLength(1);
  });

  it("validates, canonically orders, and inserts a substantive pair", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    fake.enqueue([{ id: "observation-a" }], [row]);

    await expect(
      repo.insert(scope, {
        metricKey: row.metric_key,
        subjectType: row.subject_type,
        subjectRef: row.subject_ref,
        leftObservationId: "observation-z",
        rightObservationId: "observation-a",
      }),
    ).resolves.toBe(row);
    expect(fake.last("values").args[0]).toMatchObject({
      left_observation_id: "observation-a",
      right_observation_id: "observation-z",
    });
  });

  it("rejects a pair that is foreign or not substantively different", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    fake.enqueue([]);

    await expect(
      repo.insert(scope, {
        metricKey: row.metric_key,
        subjectType: row.subject_type,
        subjectRef: row.subject_ref,
        leftObservationId: "observation-a",
        rightObservationId: "observation-z",
      }),
    ).rejects.toThrow(/outside scope|not a substantive/i);
  });

  it("replays a conflict-safe existing pair and rejects an impossible missing replay", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    const values = {
      metricKey: row.metric_key,
      subjectType: row.subject_type,
      subjectRef: row.subject_ref,
      leftObservationId: "observation-a",
      rightObservationId: "observation-z",
    };
    fake.enqueue([{ id: "observation-a" }], [], [row]);
    await expect(repo.insert(scope, values)).resolves.toBe(row);

    const missing = fakeExecutor();
    const missingRepo = new ProviderDiscrepanciesRepository(missing.executor);
    missing.enqueue([{ id: "observation-a" }], [], []);
    await expect(missingRepo.insert(scope, values)).rejects.toThrow(
      /conflict replay missing/i,
    );
  });

  it("deduplicates candidate observation pairs before inserting", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    fake.enqueue([
      {
        metricKey: "gsc.clicks",
        subjectType: "url",
        subjectRef: "https://example.com/",
        currentObservationId: "observation-z",
        priorObservationId: "observation-a",
      },
      {
        metricKey: "gsc.clicks",
        subjectType: "url",
        subjectRef: "https://example.com/",
        currentObservationId: "observation-a",
        priorObservationId: "observation-z",
      },
      {
        metricKey: "ga4.sessions",
        subjectType: "url",
        subjectRef: "https://example.com/pricing",
        currentObservationId: "observation-c",
        priorObservationId: "observation-b",
      },
    ]);
    const insert = vi
      .spyOn(repo, "insert")
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, id: "discrepancy-2" });

    await expect(repo.detectForSnapshot(scope, "snapshot-current")).resolves
      .toHaveLength(2);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(
      1,
      scope,
      expect.objectContaining({
        leftObservationId: "observation-a",
        rightObservationId: "observation-z",
      }),
    );
    expect(insert).toHaveBeenNthCalledWith(
      2,
      scope,
      expect.objectContaining({
        leftObservationId: "observation-b",
        rightObservationId: "observation-c",
      }),
    );
  });

  it("returns empty detection/list fast paths and scoped list results", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    fake.enqueue([], [row], [row]);

    await expect(repo.detectForSnapshot(scope, "snapshot-empty")).resolves.toEqual(
      [],
    );
    await expect(repo.listByProject(scope)).resolves.toEqual([row]);
    const callCount = fake.calls.length;
    const joinsBefore = fake.calls.filter(
      (call) => call.method === "innerJoin",
    ).length;
    await expect(repo.listUnresolvedBySnapshotIds(scope, [])).resolves.toEqual(
      [],
    );
    expect(fake.calls).toHaveLength(callCount);
    await expect(
      repo.listUnresolvedBySnapshotIds(scope, ["snapshot-1", "snapshot-2"]),
    ).resolves.toEqual([row]);
    expect(
      fake.calls.filter((call) => call.method === "innerJoin").length -
        joinsBefore,
    ).toBe(2);
  });
});
