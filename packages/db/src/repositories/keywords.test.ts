import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KeywordsRepository,
  MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
  MAX_KEYWORD_ENTITY_PAGE_SIZE,
  type KeywordEntityRow,
} from "./keywords.ts";

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

  innerJoin(...args: unknown[]): this {
    return this.chain("innerJoin", args);
  }

  where(...args: unknown[]): this {
    return this.chain("where", args);
  }

  orderBy(...args: unknown[]): this {
    return this.chain("orderBy", args);
  }

  limit(...args: unknown[]): this {
    return this.chain("limit", args);
  }

  set(...args: unknown[]): this {
    return this.chain("set", args);
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

  update(...args: unknown[]): FakeQuery {
    return this.query("update", args);
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

const entity = {
  id: "00000000-0000-4000-8000-000000000010",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  normalized_keyword: "customer onboarding software",
  display_keyword: "Customer Onboarding Software",
  market: "US",
  language_tag: "en-US",
  query_kind: "search_query",
  status: "candidate",
  intent: null,
  buyer_stage: null,
  cluster_key: null,
  mapping_decision: "unassigned",
  mapped_site_page_id: null,
  mapping_review_state: "unreviewed",
  mapping_revision: 0,
  first_seen_at: "2026-07-22T08:00:00.000Z",
  last_seen_at: "2026-07-22T08:00:00.000Z",
  created_at: "2026-07-22T08:00:00.000Z",
  updated_at: "2026-07-22T08:00:00.000Z",
} as const satisfies KeywordEntityRow;

describe("KeywordsRepository", () => {
  it("lists active-project entities by a bounded stable cursor", async () => {
    const db = new FakeExecutor();
    db.enqueue([entity, { ...entity, id: "00000000-0000-4000-8000-000000000011" }]);
    const repo = new KeywordsRepository(db as never);

    const page = await repo.listByProject(scope, {
      limit: 1,
      cursor: null,
      status: "candidate",
      queryKind: "search_query",
      market: "US",
    });

    expect(page.rows).toEqual([entity]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toContain("candidate");
    expect(predicate.params).toContain("search_query");
    expect(predicate.params).toContain("US");
  });

  it("reads only approved, confirmed, clustered diagnostic facts with one sentinel", async () => {
    const db = new FakeExecutor();
    const approved = {
      ...entity,
      status: "approved",
      mapping_review_state: "confirmed",
      cluster_key: "customer-onboarding",
      mapping_revision: 1,
    } as const satisfies KeywordEntityRow;
    db.enqueue([approved]);
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listDiagnosticEligible(scope, {
        limit: MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
      }),
    ).resolves.toEqual([approved]);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"cluster_key" is not null');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toEqual(
      expect.arrayContaining(["approved", "confirmed"]),
    );
    expect(db.last("limit").args).toEqual([
      MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
    ]);
  });

  it("returns null for a foreign, archived or absent detail within the SQL scope", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const repo = new KeywordsRepository(db as never);

    await expect(repo.findById(scope, entity.id)).resolves.toBeNull();
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toContain(entity.id);
  });

  it("updates review and Existing Page mapping only at the expected revision", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      {
        ...entity,
        status: "approved",
        mapping_decision: "existing_page",
        mapped_site_page_id: "00000000-0000-4000-8000-000000000030",
        mapping_review_state: "confirmed",
        mapping_revision: 1,
      },
    ]);
    const repo = new KeywordsRepository(db as never);

    const updated = await repo.reviewAndMap(scope, entity.id, {
      expectedRevision: 0,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      clusterKey: "customer-onboarding",
      mappingDecision: "existing_page",
      mappedSitePageId: "00000000-0000-4000-8000-000000000030",
      mappingReviewState: "confirmed",
    });

    expect(updated?.mapping_revision).toBe(1);
    expect(db.last("set").args[0]).toEqual(
      expect.objectContaining({
        mapping_revision: 1,
        mapping_decision: "existing_page",
        mapped_site_page_id: "00000000-0000-4000-8000-000000000030",
      }),
    );
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"mapping_revision" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
  });

  it("returns null on an optimistic revision conflict", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.reviewAndMap(scope, entity.id, {
        expectedRevision: 4,
        status: "approved",
        intent: null,
        buyerStage: null,
        clusterKey: null,
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        mappingReviewState: "confirmed",
      }),
    ).resolves.toBeNull();
  });

  it("rejects incoherent mappings and unbounded filters before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.reviewAndMap(scope, entity.id, {
        expectedRevision: 0,
        status: "approved",
        intent: null,
        buyerStage: null,
        clusterKey: null,
        mappingDecision: "new_asset",
        mappedSitePageId: "00000000-0000-4000-8000-000000000030",
        mappingReviewState: "confirmed",
      }),
    ).rejects.toThrow(/mappedSitePageId/i);
    await expect(
      repo.listByProject(scope, {
        limit: MAX_KEYWORD_ENTITY_PAGE_SIZE + 1,
        cursor: null,
      }),
    ).rejects.toThrow(/limit/i);
    await expect(
      repo.listDiagnosticEligible(scope, {
        limit: MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ + 1,
      }),
    ).rejects.toThrow(/limit/i);
    expect(db.calls).toEqual([]);
  });
});
