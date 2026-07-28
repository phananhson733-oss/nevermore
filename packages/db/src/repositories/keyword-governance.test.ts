import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KeywordGovernanceConflictError,
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
  type KeywordGovernanceReviewedProjection,
  type ReviewKeywordInput,
} from "./keyword-governance.ts";
import {
  MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
  MAX_POSTGRES_INTEGER_REVISION,
} from "@sf/contracts";

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

  for(...args: unknown[]): this {
    return this.chain("for", args);
  }

  set(...args: unknown[]): this {
    return this.chain("set", args);
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

  insert(...args: unknown[]): FakeQuery {
    return this.query("insert", args);
  }

  async execute(...args: unknown[]): Promise<{ rows: never[] }> {
    this.calls.push({ method: "execute", args });
    return { rows: [] };
  }

  async transaction<T>(run: (tx: never) => Promise<T>): Promise<T> {
    this.calls.push({ method: "transaction", args: [] });
    return run(this as never);
  }

  all(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  keyword: "00000000-0000-4000-8000-000000000003",
  actor: "00000000-0000-4000-8000-000000000004",
  topic: "00000000-0000-4000-8000-000000000005",
  page: "00000000-0000-4000-8000-000000000006",
  baselineDecision: "00000000-0000-4000-8000-000000000007",
  newDecision: "00000000-0000-4000-8000-000000000008",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

const now = "2026-07-28T09:30:00.000Z";
const databaseNow = "2026-07-28 09:30:00+00";
const clock = {
  newId: () => ids.newDecision,
  now: () => now,
};

const keyword = {
  id: ids.keyword,
  workspace_id: ids.workspace,
  project_id: ids.project,
  status: "candidate",
  intent: null,
  buyer_stage: null,
  cluster_key: null,
  mapping_decision: "unassigned",
  mapped_site_page_id: null,
  mapping_review_state: "unreviewed",
  mapping_revision: 3,
  updated_at: "2026-07-27 08:00:00+00",
} as const;

const baselineProjection = {
  projectId: ids.project,
  keywordId: ids.keyword,
  governanceRevision: 3,
  status: "candidate",
  intent: null,
  buyerStage: null,
  topicNodeId: null,
  topicModelRevision: null,
  clusterKey: null,
  mappingDecision: "unassigned",
  mappedSitePageId: null,
  mappingReviewState: "unreviewed",
  assignmentInvalidatedBy: null,
  earlierHistoryAvailable: false,
} as const satisfies KeywordGovernanceReviewedProjection;

const baseline = {
  id: ids.baselineDecision,
  workspace_id: ids.workspace,
  project_id: ids.project,
  keyword_entity_id: ids.keyword,
  governance_revision: 3,
  decision_origin: "migration_baseline",
  status: "candidate",
  intent: null,
  buyer_stage: null,
  topic_node_id: null,
  topic_model_revision: null,
  cluster_key_at_decision: null,
  mapping_decision: "unassigned",
  mapped_site_page_id: null,
  review_state: "unreviewed",
  assignment_invalidated_by: null,
  decided_by: null,
  reason: "Migrated current keyword review projection.",
  decided_at: "2026-07-27 08:00:00+00",
  reviewed_projection: baselineProjection,
  created_at: "2026-07-27 08:00:00+00",
} as const;

const review = {
  expectedGovernanceRevision: 3,
  status: "approved",
  intent: "commercial",
  buyerStage: "consideration",
  topicNodeId: ids.topic,
  topicModelRevision: 2,
  mappingDecision: "existing_page",
  mappedSitePageId: ids.page,
  reason: "Confirmed against the exact Topic Model revision.",
} as const satisfies ReviewKeywordInput;

function sqlFor(call: RecordedCall): {
  readonly sql: string;
  readonly params: unknown[];
} {
  return new PgDialect().sqlToQuery(call.args[0] as never);
}

function transactionView(db: FakeExecutor) {
  return {
    select: db.select.bind(db),
    update: db.update.bind(db),
    insert: db.insert.bind(db),
    execute: db.execute.bind(db),
  };
}

describe("KeywordGovernanceRepository", () => {
  it("atomically appends a server-resolved Topic review and advances the legacy mirror", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [keyword],
      [baseline],
      [{ label: "Customer Onboarding" }],
      [{ id: ids.page }],
      [{ mapping_revision: 4, updated_at: databaseNow }],
      [],
    );
    const repo = new KeywordGovernanceRepository(db as never, clock);

    const result = await repo.reviewKeyword(
      scope,
      ids.keyword,
      ids.actor,
      review,
    );

    expect(result.replayed).toBe(false);
    expect(result.clusterKey).toBe("Customer Onboarding");
    expect(result.decision).toEqual({
      decisionId: ids.newDecision,
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 4,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.topic,
      topicModelRevision: 2,
      mappingDecision: "existing_page",
      mappedSitePageId: ids.page,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      reason: review.reason,
      decisionOrigin: "user",
      decidedBy: ids.actor,
      decidedAt: now,
    });
    expect(result.projection).toEqual({
      currentDecisionId: ids.newDecision,
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 4,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.topic,
      topicModelRevision: 2,
      mappingDecision: "existing_page",
      mappedSitePageId: ids.page,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      mappingRevision: 4,
      executionState: "ready",
      reason: review.reason,
      updatedAt: now,
    });
    expect(result.reviewedProjection).toEqual({
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 4,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.topic,
      topicModelRevision: 2,
      clusterKey: "Customer Onboarding",
      mappingDecision: "existing_page",
      mappedSitePageId: ids.page,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      earlierHistoryAvailable: false,
    });

    expect(db.all("transaction")).toHaveLength(1);
    const lockIndex = db.calls.findIndex(
      (call) => call.method === "execute",
    );
    const rowLockIndex = db.calls.findIndex(
      (call) =>
        call.method === "for" && call.args[0] === "update",
    );
    expect(sqlFor(db.calls[lockIndex]!)).toMatchObject({
      sql: expect.stringContaining("pg_advisory_xact_lock"),
      params: [
        `topic-governance:${ids.workspace}:${ids.project}`,
      ],
    });
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(rowLockIndex).toBeGreaterThan(lockIndex);
    expect(db.last("for").args).toEqual(["update"]);
    expect(db.last("set").args[0]).toEqual({
      status: "approved",
      intent: "commercial",
      buyer_stage: "consideration",
      cluster_key: "Customer Onboarding",
      mapping_decision: "existing_page",
      mapped_site_page_id: ids.page,
      mapping_review_state: "confirmed",
      mapping_revision: 4,
      updated_at: now,
    });
    expect(db.last("values").args[0]).toEqual({
      id: ids.newDecision,
      workspace_id: ids.workspace,
      project_id: ids.project,
      keyword_entity_id: ids.keyword,
      governance_revision: 4,
      decision_origin: "user",
      status: "approved",
      intent: "commercial",
      buyer_stage: "consideration",
      topic_node_id: ids.topic,
      topic_model_revision: 2,
      cluster_key_at_decision: "Customer Onboarding",
      mapping_decision: "existing_page",
      mapped_site_page_id: ids.page,
      review_state: "confirmed",
      assignment_invalidated_by: null,
      decided_by: ids.actor,
      reason: review.reason,
      decided_at: now,
      reviewed_projection: result.reviewedProjection,
    });

    const wheres = db.all("where").map(sqlFor);
    expect(wheres[0]!.sql).toContain('"archived_at" is null');
    expect(wheres[0]!.params).toEqual(
      expect.arrayContaining([ids.workspace, ids.project, ids.keyword]),
    );
    expect(wheres[2]!.params).toEqual(
      expect.arrayContaining([
        ids.workspace,
        ids.project,
        ids.topic,
        2,
        "active",
        "confirmed",
      ]),
    );
    expect(wheres[3]!.params).toEqual(
      expect.arrayContaining([ids.workspace, ids.project, ids.page]),
    );
    expect(wheres[4]!.sql).toContain('"mapping_revision" = $');
    expect(wheres[4]!.params).toEqual(
      expect.arrayContaining([ids.workspace, ids.project, ids.keyword, 3]),
    );
  });

  it("works inside a caller transaction and clears every excluded assignment", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [keyword],
      [baseline],
      [{ mapping_revision: 4, updated_at: databaseNow }],
      [],
    );
    const repo = new KeywordGovernanceRepository(
      transactionView(db) as never,
      clock,
    );

    const result = await repo.reviewKeyword(scope, ids.keyword, ids.actor, {
      ...review,
      status: "excluded",
      reason: "This query is outside the product scope.",
    });

    expect(result.replayed).toBe(false);
    expect(result.reviewedProjection).toMatchObject({
      status: "excluded",
      topicNodeId: null,
      topicModelRevision: null,
      clusterKey: null,
      mappingDecision: "unassigned",
      mappedSitePageId: null,
      mappingReviewState: "confirmed",
    });
    expect(db.all("select")).toHaveLength(2);
    expect(db.all("transaction")).toHaveLength(0);
    expect(db.last("set").args[0]).toMatchObject({
      status: "excluded",
      cluster_key: null,
      mapping_decision: "unassigned",
      mapped_site_page_id: null,
    });
  });

  it("rejects unconfirmed or inactive Topic authority and foreign Site Pages before writes", async () => {
    const topicDb = new FakeExecutor();
    topicDb.enqueue([keyword], [baseline], []);
    const topicRepo = new KeywordGovernanceRepository(
      topicDb as never,
      clock,
    );

    await expect(
      topicRepo.reviewKeyword(scope, ids.keyword, ids.actor, review),
    ).rejects.toMatchObject({
      name: "KeywordGovernanceConflictError",
      code: "TOPIC_ASSIGNMENT_INVALID",
    });
    expect(topicDb.all("update")).toHaveLength(0);
    expect(topicDb.all("insert")).toHaveLength(0);

    const pageDb = new FakeExecutor();
    pageDb.enqueue(
      [keyword],
      [baseline],
      [{ label: "Customer Onboarding" }],
      [],
    );
    const pageRepo = new KeywordGovernanceRepository(pageDb as never, clock);

    await expect(
      pageRepo.reviewKeyword(scope, ids.keyword, ids.actor, review),
    ).rejects.toMatchObject({
      name: "KeywordGovernanceConflictError",
      code: "SITE_PAGE_NOT_FOUND",
    });
    expect(pageDb.all("update")).toHaveLength(0);
    expect(pageDb.all("insert")).toHaveLength(0);
  });

  it("returns an exact one-step replay without consulting mutable authorities or writing twice", async () => {
    const reviewedProjection = {
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 4,
      status: review.status,
      intent: review.intent,
      buyerStage: review.buyerStage,
      topicNodeId: review.topicNodeId,
      topicModelRevision: review.topicModelRevision,
      clusterKey: "Customer Onboarding",
      mappingDecision: review.mappingDecision,
      mappedSitePageId: review.mappedSitePageId,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      earlierHistoryAvailable: false,
    } as const satisfies KeywordGovernanceReviewedProjection;
    const currentKeyword = {
      ...keyword,
      status: review.status,
      intent: review.intent,
      buyer_stage: review.buyerStage,
      cluster_key: "Customer Onboarding",
      mapping_decision: review.mappingDecision,
      mapped_site_page_id: review.mappedSitePageId,
      mapping_review_state: "confirmed",
      mapping_revision: 4,
      updated_at: now,
    };
    const currentDecision = {
      ...baseline,
      id: ids.newDecision,
      governance_revision: 4,
      decision_origin: "user",
      status: review.status,
      intent: review.intent,
      buyer_stage: review.buyerStage,
      topic_node_id: review.topicNodeId,
      topic_model_revision: review.topicModelRevision,
      cluster_key_at_decision: "Customer Onboarding",
      mapping_decision: review.mappingDecision,
      mapped_site_page_id: review.mappedSitePageId,
      review_state: "confirmed",
      decided_by: ids.actor,
      reason: review.reason,
      decided_at: now,
      reviewed_projection: reviewedProjection,
      created_at: now,
    };
    const db = new FakeExecutor();
    db.enqueue([currentKeyword], [currentDecision]);
    const repo = new KeywordGovernanceRepository(db as never, clock);

    const result = await repo.reviewKeyword(
      scope,
      ids.keyword,
      ids.actor,
      review,
    );

    expect(result.replayed).toBe(true);
    expect(result.decision.decisionId).toBe(ids.newDecision);
    expect(result.reviewedProjection).toBe(reviewedProjection);
    expect(db.all("select")).toHaveLength(2);
    expect(db.all("update")).toHaveLength(0);
    expect(db.all("insert")).toHaveLength(0);
  });

  it("returns a typed revision conflict for a changed replay or any older stale command", async () => {
    const currentKeyword = {
      ...keyword,
      mapping_revision: 4,
    };
    const currentDecision = {
      ...baseline,
      governance_revision: 4,
      reviewed_projection: {
        ...baselineProjection,
        governanceRevision: 4,
      },
    };
    const changedDb = new FakeExecutor();
    changedDb.enqueue([currentKeyword], [currentDecision]);
    const changedRepo = new KeywordGovernanceRepository(
      changedDb as never,
      clock,
    );

    await expect(
      changedRepo.reviewKeyword(scope, ids.keyword, ids.actor, review),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "KeywordGovernanceConflictError",
        code: "REVISION_CONFLICT",
        expectedRevision: 3,
        currentRevision: 4,
      }),
    );

    const oldDb = new FakeExecutor();
    oldDb.enqueue([currentKeyword], [currentDecision]);
    const oldRepo = new KeywordGovernanceRepository(oldDb as never, clock);
    await expect(
      oldRepo.reviewKeyword(scope, ids.keyword, ids.actor, {
        ...review,
        expectedGovernanceRevision: 2,
      }),
    ).rejects.toBeInstanceOf(KeywordGovernanceConflictError);
    expect(oldDb.all("update")).toHaveLength(0);
    expect(oldDb.all("insert")).toHaveLength(0);
  });

  it("fails closed for absent, foreign, or archived keywords under the locked SQL scope", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const repo = new KeywordGovernanceRepository(db as never, clock);

    await expect(
      repo.reviewKeyword(scope, ids.keyword, ids.actor, review),
    ).rejects.toMatchObject({
      name: "KeywordGovernanceConflictError",
      code: "KEYWORD_NOT_FOUND",
    });
    const predicate = sqlFor(db.last("where"));
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toEqual(
      expect.arrayContaining([ids.workspace, ids.project, ids.keyword]),
    );
    expect(db.last("for").args).toEqual(["update"]);
  });

  it("refuses to advance when append-only current history is missing or diverges from the legacy mirror", async () => {
    const missingDb = new FakeExecutor();
    missingDb.enqueue([keyword], []);
    const missingRepo = new KeywordGovernanceRepository(
      missingDb as never,
      clock,
    );
    await expect(
      missingRepo.reviewKeyword(scope, ids.keyword, ids.actor, review),
    ).rejects.toMatchObject({
      name: "KeywordGovernanceIntegrityError",
      code: "CURRENT_DECISION_MISSING",
    });

    const divergentDb = new FakeExecutor();
    divergentDb.enqueue([
      {
        ...keyword,
        status: "approved",
      },
    ], [baseline]);
    const divergentRepo = new KeywordGovernanceRepository(
      divergentDb as never,
      clock,
    );
    await expect(
      divergentRepo.reviewKeyword(scope, ids.keyword, ids.actor, review),
    ).rejects.toBeInstanceOf(KeywordGovernanceIntegrityError);
    expect(divergentDb.all("update")).toHaveLength(0);
    expect(divergentDb.all("insert")).toHaveLength(0);
  });

  it("reads only the persisted current decision and returns null only when the scoped keyword is absent", async () => {
    const db = new FakeExecutor();
    db.enqueue([keyword], [baseline]);
    const repo = new KeywordGovernanceRepository(db as never, clock);

    const current = await repo.findCurrent(scope, ids.keyword);

    expect(current).toEqual({
      decision: {
        decisionId: ids.baselineDecision,
        projectId: ids.project,
        keywordId: ids.keyword,
        governanceRevision: 3,
        status: "candidate",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: null,
        reason: baseline.reason,
        decisionOrigin: "migration_baseline",
        decidedBy: null,
        decidedAt: "2026-07-27T08:00:00.000Z",
      },
      projection: {
        currentDecisionId: ids.baselineDecision,
        projectId: ids.project,
        keywordId: ids.keyword,
        governanceRevision: 3,
        status: "candidate",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: null,
        mappingRevision: 3,
        executionState: "blocked",
        reason: baseline.reason,
        updatedAt: "2026-07-27T08:00:00.000Z",
      },
      clusterKey: null,
      reviewedProjection: baselineProjection,
    });

    const absentDb = new FakeExecutor();
    absentDb.enqueue([]);
    const absentRepo = new KeywordGovernanceRepository(
      absentDb as never,
      clock,
    );
    await expect(
      absentRepo.findCurrent(scope, ids.keyword),
    ).resolves.toBeNull();
    expect(absentDb.all("select")).toHaveLength(1);
  });

  it("reads a retired Topic assignment as blocked, append-only review authority", async () => {
    const retiredProjection = {
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 4,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.topic,
      topicModelRevision: 2,
      clusterKey: "Customer Onboarding",
      mappingDecision: "existing_page",
      mappedSitePageId: ids.page,
      mappingReviewState: "unreviewed",
      assignmentInvalidatedBy: "topic_retire",
      earlierHistoryAvailable: false,
    } as const satisfies KeywordGovernanceReviewedProjection;
    const retiredKeyword = {
      ...keyword,
      status: "approved",
      intent: "commercial",
      buyer_stage: "consideration",
      cluster_key: "Customer Onboarding",
      mapping_decision: "existing_page",
      mapped_site_page_id: ids.page,
      mapping_review_state: "unreviewed",
      mapping_revision: 4,
      updated_at: now,
    };
    const retiredDecision = {
      ...baseline,
      id: ids.newDecision,
      governance_revision: 4,
      decision_origin: "system_suggestion",
      status: "approved",
      intent: "commercial",
      buyer_stage: "consideration",
      topic_node_id: ids.topic,
      topic_model_revision: 2,
      cluster_key_at_decision: "Customer Onboarding",
      mapping_decision: "existing_page",
      mapped_site_page_id: ids.page,
      review_state: "unreviewed",
      assignment_invalidated_by: "topic_retire",
      decided_by: ids.actor,
      reason: "The assigned Topic was retired; review is required.",
      decided_at: now,
      reviewed_projection: retiredProjection,
      created_at: now,
    };
    const db = new FakeExecutor();
    db.enqueue([retiredKeyword], [retiredDecision]);

    const current = await new KeywordGovernanceRepository(
      db as never,
      clock,
    ).findCurrent(scope, ids.keyword);

    expect(current).toMatchObject({
      decision: {
        assignmentInvalidatedBy: "topic_retire",
        mappingReviewState: "unreviewed",
      },
      projection: {
        assignmentInvalidatedBy: "topic_retire",
        executionState: "blocked",
      },
    });
  });

  it("validates bounded canonical command fields before opening a transaction", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordGovernanceRepository(db as never, clock);

    await expect(
      repo.reviewKeyword(scope, ids.keyword, ids.actor, {
        ...review,
        expectedGovernanceRevision: -1,
      }),
    ).rejects.toThrow(/expectedGovernanceRevision/u);
    await expect(
      repo.reviewKeyword(scope, ids.keyword, ids.actor, {
        ...review,
        expectedGovernanceRevision:
          MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION + 1,
      }),
    ).rejects.toThrow(/expectedGovernanceRevision/u);
    await expect(
      repo.reviewKeyword(scope, ids.keyword, ids.actor, {
        ...review,
        reason: " x ",
      }),
    ).rejects.toThrow(/reason/u);
    await expect(
      repo.reviewKeyword(scope, ids.keyword, ids.actor, {
        ...review,
        topicModelRevision: null,
      }),
    ).rejects.toThrow(/Topic assignment/u);
    expect(db.calls).toEqual([]);
  });

  it("allows the final incrementable PostgreSQL integer revision and never overflows the column", async () => {
    const expectedRevision =
      MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION;
    const maxKeyword = {
      ...keyword,
      mapping_revision: expectedRevision,
    };
    const maxProjection = {
      ...baselineProjection,
      governanceRevision: expectedRevision,
    };
    const maxDecision = {
      ...baseline,
      governance_revision: expectedRevision,
      reviewed_projection: maxProjection,
    };
    const db = new FakeExecutor();
    db.enqueue(
      [maxKeyword],
      [maxDecision],
      [{
        mapping_revision: MAX_POSTGRES_INTEGER_REVISION,
        updated_at: databaseNow,
      }],
      [],
    );
    const repo = new KeywordGovernanceRepository(db as never, clock);

    const result = await repo.reviewKeyword(
      scope,
      ids.keyword,
      ids.actor,
      {
        ...review,
        expectedGovernanceRevision: expectedRevision,
        status: "excluded",
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "Exclude at the final incrementable database revision.",
      },
    );

    expect(result.projection.governanceRevision).toBe(
      MAX_POSTGRES_INTEGER_REVISION,
    );
    expect(db.last("set").args[0]).toMatchObject({
      mapping_revision: MAX_POSTGRES_INTEGER_REVISION,
    });
  });

  it("fails closed when persisted revisions exceed the PostgreSQL integer domain", async () => {
    const corruptRevision = MAX_POSTGRES_INTEGER_REVISION + 1;
    const db = new FakeExecutor();
    db.enqueue(
      [{ ...keyword, mapping_revision: corruptRevision }],
      [{
        ...baseline,
        governance_revision: corruptRevision,
        reviewed_projection: {
          ...baselineProjection,
          governanceRevision: corruptRevision,
        },
      }],
    );
    const repo = new KeywordGovernanceRepository(db as never, clock);

    await expect(
      repo.findCurrent(scope, ids.keyword),
    ).rejects.toMatchObject({
      name: "KeywordGovernanceIntegrityError",
      code: "CURRENT_DECISION_DIVERGED",
    });
  });
});
