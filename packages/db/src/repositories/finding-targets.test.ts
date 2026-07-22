import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  FindingTargetsRepository,
  MAX_FINDING_TARGET_INSERT,
  MAX_FINDING_TARGET_LOOKUP,
  type FindingTargetInsert,
} from "./finding-targets.ts";

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

  values(...args: unknown[]): this {
    return this.chain("values", args);
  }

  orderBy(...args: unknown[]): this {
    return this.chain("orderBy", args);
  }

  onConflictDoNothing(...args: unknown[]): this {
    return this.chain("onConflictDoNothing", args);
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
    return this.results.length > 0 ? this.results.shift() : [];
  }

  private query(method: string, args: readonly unknown[]): FakeQuery {
    this.calls.push({ method, args });
    return new FakeQuery(this);
  }

  select(...args: unknown[]): FakeQuery {
    return this.query("select", args);
  }

  insert(...args: unknown[]): FakeQuery {
    return this.query("insert", args);
  }

  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const scope = { workspaceId: "00000000-0000-4000-8000-000000000001", projectId: "00000000-0000-4000-8000-000000000002" };

function repository(): {
  readonly repo: FindingTargetsRepository;
  readonly db: FakeExecutor;
} {
  const db = new FakeExecutor();
  return {
    repo: new FindingTargetsRepository(db as never),
    db,
  };
}

function directTarget(
  overrides: Partial<FindingTargetInsert> = {},
): FindingTargetInsert {
  return {
    siteId: "00000000-0000-4000-8000-000000000003",
    findingId: "00000000-0000-4000-8000-000000000004",
    diagnosticRunId: "00000000-0000-4000-8000-000000000005",
    relation: "direct_url",
    targetKind: "url",
    targetRef: "https://example.com/page/",
    resolutionState: "resolved",
    basisKind: "observation_site_page",
    sitePageId: "00000000-0000-4000-8000-000000000006",
    pageSnapshotId: null,
    sourceObservationId: "00000000-0000-4000-8000-000000000007",
    memberRef: "https://example.com/page",
    limitation: null,
    ...overrides,
  };
}

describe("FindingTargetsRepository", () => {
  it("writes bounded target rows idempotently without accepting a caller relation key", async () => {
    const { repo, db } = repository();
    db.enqueue([{ id: "target-1" }]);

    await expect(repo.insertMany(scope, [directTarget()])).resolves.toBe(1);

    expect(db.last("values").args[0]).toEqual([
      expect.objectContaining({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        relation: "direct_url",
        target_kind: "url",
        site_page_id: "00000000-0000-4000-8000-000000000006",
        source_observation_id: "00000000-0000-4000-8000-000000000007",
      }),
    ]);
    expect(db.last("values").args[0]).not.toEqual([
      expect.objectContaining({ relation_key: expect.anything() }),
    ]);
    expect(db.last("onConflictDoNothing").args[0]).toEqual(
      expect.objectContaining({ target: expect.any(Array) }),
    );
  });

  it("returns zero without issuing SQL for an empty insert", async () => {
    const { repo, db } = repository();
    await expect(repo.insertMany(scope, [])).resolves.toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("orders multi-Finding inserts by locale-independent code units", async () => {
    const { repo, db } = repository();
    db.enqueue([{ id: "target-a" }, { id: "target-z" }]);

    await expect(
      repo.insertMany(scope, [
        directTarget({
          findingId: "f0000000-0000-4000-8000-000000000000",
        }),
        directTarget({
          findingId: "F0000000-0000-4000-8000-000000000000",
        }),
      ]),
    ).resolves.toBe(2);

    const values = db.last("values").args[0] as Array<{
      readonly finding_id: string;
    }>;
    expect(values.map((value) => value.finding_id)).toEqual([
      "F0000000-0000-4000-8000-000000000000",
      "f0000000-0000-4000-8000-000000000000",
    ]);
  });

  it("rejects oversized batches and unbounded semantic text before SQL", async () => {
    const { repo, db } = repository();
    await expect(
      repo.insertMany(
        scope,
        Array.from({ length: MAX_FINDING_TARGET_INSERT + 1 }, () =>
          directTarget(),
        ),
      ),
    ).rejects.toThrow(/at most/i);
    await expect(
      repo.insertMany(scope, [directTarget({ targetRef: "x".repeat(2049) })]),
    ).rejects.toThrow(/targetRef/i);
    await expect(
      repo.insertMany(scope, [directTarget({ limitation: "x".repeat(2001) })]),
    ).rejects.toThrow(/limitation/i);
    expect(db.calls).toEqual([]);
  });

  it("lists only resolved rows for one exact SitePage in stable order", async () => {
    const { repo, db } = repository();
    const row = { id: "target-1", relation_key: "a".repeat(64) };
    db.enqueue([row]);

    await expect(
      repo.listForSitePage(
        scope,
        "00000000-0000-4000-8000-000000000005",
        "00000000-0000-4000-8000-000000000006",
      ),
    ).resolves.toEqual([row]);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"diagnostic_run_id" = $3');
    expect(predicate.sql).toContain('"site_page_id" = $4');
    expect(predicate.sql).toContain('"resolution_state" = $5');
    expect(predicate.params).toContain("resolved");
    expect(db.last("orderBy").args).toHaveLength(3);
  });

  it("lists all explicit target shapes for a bounded Finding set", async () => {
    const { repo, db } = repository();
    const rows = [
      { id: "target-1", resolution_state: "resolved" },
      { id: "target-2", resolution_state: "definition_only" },
    ];
    db.enqueue(rows);

    await expect(
      repo.listForFindings(
        scope,
        "00000000-0000-4000-8000-000000000005",
        [
          "00000000-0000-4000-8000-000000000004",
          "00000000-0000-4000-8000-000000000008",
        ],
      ),
    ).resolves.toEqual(rows);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"diagnostic_run_id" = $3');
    expect(predicate.sql).toContain('"finding_id" in');
    expect(predicate.sql).not.toContain('"resolution_state"');
    expect(db.last("orderBy").args).toHaveLength(3);
  });

  it("short-circuits empty Finding reads and rejects oversized reads", async () => {
    const { repo, db } = repository();
    await expect(
      repo.listForFindings(
        scope,
        "00000000-0000-4000-8000-000000000005",
        [],
      ),
    ).resolves.toEqual([]);
    await expect(
      repo.listForFindings(
        scope,
        "00000000-0000-4000-8000-000000000005",
        Array.from(
          { length: MAX_FINDING_TARGET_LOOKUP + 1 },
          (_, index) => `finding-${index}`,
        ),
      ),
    ).rejects.toThrow(/at most/i);
    expect(db.calls).toEqual([]);
  });
});
