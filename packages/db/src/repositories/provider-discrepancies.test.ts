import { describe, expect, it } from "vitest";
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

  it("returns only de-duplicated, canonically ordered candidate pairs", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    fake.enqueue({
      rows: [
        row,
        {
          ...row,
          id: "discrepancy-2",
          metric_key: "ga4.sessions",
          subject_ref: "https://example.com/pricing",
          left_observation_id: "observation-b",
          right_observation_id: "observation-c",
        },
      ],
    });

    const detected = await repo.detectForSnapshot(scope, "snapshot-current");
    expect(detected).toHaveLength(2);
    expect(
      detected.every(
        (candidate) =>
          candidate.left_observation_id < candidate.right_observation_id,
      ),
    ).toBe(true);
    expect(
      new Set(
        detected.map(
          (candidate) =>
            `${candidate.left_observation_id}:${candidate.right_observation_id}`,
        ),
      ).size,
    ).toBe(2);

    const duplicate = fakeExecutor();
    duplicate.enqueue({ rows: [row, { ...row, id: "discrepancy-replay" }] });
    await expect(
      new ProviderDiscrepanciesRepository(
        duplicate.executor,
      ).detectForSnapshot(scope, "snapshot-current"),
    ).rejects.toThrow(/duplicate pair/i);

    const reversed = fakeExecutor();
    reversed.enqueue({
      rows: [
        {
          ...row,
          left_observation_id: "observation-z",
          right_observation_id: "observation-a",
        },
      ],
    });
    await expect(
      new ProviderDiscrepanciesRepository(
        reversed.executor,
      ).detectForSnapshot(scope, "snapshot-current"),
    ).rejects.toThrow(/non-canonical pair/i);
  });

  it("detects and writes 2376 candidate pairs with one set-based database call", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    fake.enqueue({
      rows: Array.from({ length: 2_376 }, (_, index) => ({
        ...row,
        id: `discrepancy-${index + 1}`,
        left_observation_id: `observation-${index + 1}-a`,
        right_observation_id: `observation-${index + 1}-z`,
      })),
    });

    await expect(
      repo.detectForSnapshot(scope, "snapshot-current"),
    ).resolves.toHaveLength(2_376);
    expect(fake.calls.filter((call) => call.method === "execute")).toHaveLength(
      1,
    );
    expect(fake.calls.filter((call) => call.method === "select")).toHaveLength(0);
  });

  it("returns empty detection/list fast paths and scoped list results", async () => {
    const fake = fakeExecutor();
    const repo = new ProviderDiscrepanciesRepository(fake.executor);
    fake.enqueue({ rows: [] }, [row], [row]);

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
