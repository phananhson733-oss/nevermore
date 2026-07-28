import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { AsyncRunsRepository } from "./async-runs.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

class FakeQuery {
  constructor(private readonly owner: FakeExecutor) {}

  private chain(method: string, args: readonly unknown[]): this {
    this.owner.calls.push({ method, args });
    return this;
  }

  from(...args: unknown[]): this {
    return this.chain("from", args);
  }

  where(...args: unknown[]): this {
    return this.chain("where", args);
  }

  limit(...args: unknown[]): this {
    return this.chain("limit", args);
  }

  values(...args: unknown[]): this {
    return this.chain("values", args);
  }

  returning(...args: unknown[]): this {
    return this.chain("returning", args);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.take()).then(onFulfilled, onRejected);
  }
}

class FakeExecutor {
  readonly calls: RecordedCall[] = [];
  private readonly results: unknown[] = [];

  enqueue(...results: unknown[]): void {
    this.results.push(...results);
  }

  take(): unknown {
    return this.results.shift() ?? [];
  }

  select(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "select", args });
    return new FakeQuery(this);
  }

  insert(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "insert", args });
    return new FakeQuery(this);
  }

  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const ids = {
  workspace: "94000000-0000-4000-8000-000000000001",
  project: "94000000-0000-4000-8000-000000000002",
  run: "94000000-0000-4000-8000-000000000003",
  window: "94000000-0000-4000-8000-000000000004",
  actor: "94000000-0000-4000-8000-000000000005",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

const run = {
  id: ids.run,
  workspace_id: ids.workspace,
  project_id: ids.project,
  kind: "measurement",
  status: "queued",
  active_key: "measurement:change-receipt",
  contract_version: "2026-07-28",
  request_payload: {
    idempotencyKey: "measurement-idempotency-1",
    requestHash: "a".repeat(64),
  },
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: "measurement_window",
  result_id: ids.window,
  attempt_count: 0,
  initiated_by: ids.actor,
  queued_at: "2026-07-28T00:00:00Z",
  started_at: null,
  completed_at: null,
};

describe("AsyncRunsRepository measurement authority", () => {
  it("inserts the formal measurement RunKind with a preallocated result identity", async () => {
    const db = new FakeExecutor();
    db.enqueue([run]);

    await expect(
      new AsyncRunsRepository(db as never).insertQueued({
        runId: ids.run,
        workspaceId: ids.workspace,
        projectId: ids.project,
        kind: "measurement",
        activeKey: "measurement:change-receipt",
        initiatedBy: ids.actor,
        contractVersion: "2026-07-28",
        requestPayload: run.request_payload,
        resultType: "measurement_window",
        resultId: ids.window,
      }),
    ).resolves.toEqual(run);

    expect(db.last("values").args[0]).toMatchObject({
      id: ids.run,
      workspace_id: ids.workspace,
      project_id: ids.project,
      kind: "measurement",
      result_type: "measurement_window",
      result_id: ids.window,
    });
  });

  it("finds a permanent measurement replay only inside the exact project scope", async () => {
    const db = new FakeExecutor();
    db.enqueue([run]);

    await expect(
      new AsyncRunsRepository(db as never).findMeasurementByIdempotency(
        scope,
        "measurement-idempotency-1",
      ),
    ).resolves.toEqual(run);

    const compiled = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        ids.workspace,
        ids.project,
        "measurement",
        "measurement-idempotency-1",
      ]),
    );
  });
});
