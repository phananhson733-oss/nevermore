import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { ActionsRepository } from "./actions.ts";

/**
 * Unit coverage for the read-only `countActionsForFinding` cardinality reader
 * (Task 7). It mirrors `findActiveByFinding` but returns a scalar count of the
 * non-dismissed Actions bound to one source Finding, so the Execution
 * single-chain projection can assert "one confirmed Finding → one Action".
 */

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

  select(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "select", args });
    return new FakeQuery(this);
  }

  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};
const findingId = "00000000-0000-4000-8000-000000000003";

function repository(): { readonly repo: ActionsRepository; readonly db: FakeExecutor } {
  const db = new FakeExecutor();
  return { repo: new ActionsRepository(db as never), db };
}

describe("ActionsRepository.countActionsForFinding", () => {
  it("counts non-dismissed actions scoped to the project and source finding", async () => {
    const { repo, db } = repository();
    db.enqueue([{ value: 2 }]);

    await expect(repo.countActionsForFinding(scope, findingId)).resolves.toBe(2);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"source_finding_id" = $3');
    // Dismissed actions never count toward the canonical cardinality.
    expect(predicate.sql).toContain("dismissed");
  });

  it("returns zero for a finding with no live action rows", async () => {
    const { repo, db } = repository();
    db.enqueue([]);
    await expect(repo.countActionsForFinding(scope, findingId)).resolves.toBe(0);
  });

  it("coerces a string count aggregate into a number", async () => {
    const { repo, db } = repository();
    db.enqueue([{ value: "1" }]);
    await expect(repo.countActionsForFinding(scope, findingId)).resolves.toBe(1);
  });
});
