import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KeywordGovernanceConflictError,
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
  MAX_GENERATED_TOPIC_ASSIGNMENT_BATCH,
  MAX_KEYWORD_DECISION_ORIGIN_BATCH,
  MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH,
  type ApplyGeneratedTopicAssignmentsInput,
  type GeneratedTopicAssignmentSkip,
  type KeywordGovernanceReviewedProjection,
  type ReviewKeywordInput,
  type SystemKeywordApprovalInput,
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
  private readonly executeResults: unknown[] = [];

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

  async execute(...args: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ method: "execute", args });
    return this.executeResults.length > 0
      ? (this.executeResults.shift() as { rows: unknown[] })
      : { rows: [] };
  }

  enqueueExecute(...results: unknown[]): void {
    this.executeResults.push(...results);
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
  invocation: "00000000-0000-4000-8000-000000000009",
  otherKeyword: "00000000-0000-4000-8000-000000000010",
  unknownTopic: "00000000-0000-4000-8000-000000000011",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

const now = "2026-07-28T09:30:00.000Z";
const databaseNow = "2026-07-28 09:30:00.000001+00";
const canonicalDatabaseNow = "2026-07-28T09:30:00.000001Z";
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
      decidedAt: canonicalDatabaseNow,
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
      updatedAt: canonicalDatabaseNow,
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
    const updateSet = db.last("set").args[0] as Record<string, unknown>;
    expect(updateSet).toMatchObject({
      status: "approved",
      intent: "commercial",
      buyer_stage: "consideration",
      cluster_key: "Customer Onboarding",
      mapping_decision: "existing_page",
      mapped_site_page_id: ids.page,
      mapping_review_state: "confirmed",
      mapping_revision: 4,
    });
    const updateInstant = sqlFor({
      method: "updated_at",
      args: [updateSet["updated_at"]],
    });
    expect(updateInstant.sql).toContain("greatest");
    expect(updateInstant.sql).toContain("clock_timestamp()");
    expect(updateInstant.sql).toContain("interval '1 microsecond'");
    expect(updateInstant.params).toEqual([]);
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
      analysis_invocation_id: null,
      decided_by: ids.actor,
      reason: review.reason,
      decided_at: canonicalDatabaseNow,
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

  it("accepts an actorless system ingestion suggestion but still requires an actor for a user decision", async () => {
    const systemDb = new FakeExecutor();
    systemDb.enqueue(
      [keyword],
      [
        {
          ...baseline,
          decision_origin: "system_suggestion",
          decided_by: null,
          reason: "Keyword ingestion generated the initial candidate decision.",
        },
      ],
    );

    await expect(
      new KeywordGovernanceRepository(
        systemDb as never,
        clock,
      ).findCurrent(scope, ids.keyword),
    ).resolves.toMatchObject({
      decision: {
        decisionOrigin: "system_suggestion",
        decidedBy: null,
      },
    });

    const userDb = new FakeExecutor();
    userDb.enqueue(
      [keyword],
      [
        {
          ...baseline,
          decision_origin: "user",
          decided_by: null,
        },
      ],
    );
    await expect(
      new KeywordGovernanceRepository(
        userDb as never,
        clock,
      ).findCurrent(scope, ids.keyword),
    ).rejects.toMatchObject({
      name: "KeywordGovernanceIntegrityError",
      code: "CURRENT_DECISION_DIVERGED",
    });
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

describe("KeywordGovernanceRepository.applySystemApprovals", () => {
  const approval = {
    keywordId: ids.keyword,
    expectedGovernanceRevision: 3,
    clusterKey: "customer onboarding",
    mappingDecision: "unassigned",
    mappedSitePageId: null,
    reason:
      "auto_keyword_governance.v1 approved this candidate from provider evidence.",
  } as const satisfies SystemKeywordApprovalInput;

  it("appends an actorless system decision and advances the legacy mirror once", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      // no user decision in the ledger, no mapped Site Page to resolve
      [],
      [keyword],
      [baseline],
      [{ mapping_revision: 4, updated_at: databaseNow }],
      [],
    );
    const repo = new KeywordGovernanceRepository(db as never, clock);

    await expect(
      repo.applySystemApprovals(scope, [approval]),
    ).resolves.toEqual([
      {
        keywordId: ids.keyword,
        applied: true,
        skipped: null,
        governanceRevision: 4,
      },
    ]);

    expect(db.last("set").args[0]).toMatchObject({
      status: "approved",
      cluster_key: "customer onboarding",
      mapping_decision: "unassigned",
      mapped_site_page_id: null,
      mapping_review_state: "confirmed",
      mapping_revision: 4,
    });
    expect(db.last("values").args[0]).toEqual({
      id: ids.newDecision,
      workspace_id: ids.workspace,
      project_id: ids.project,
      keyword_entity_id: ids.keyword,
      governance_revision: 4,
      decision_origin: "system_suggestion",
      status: "approved",
      intent: null,
      buyer_stage: null,
      topic_node_id: null,
      topic_model_revision: null,
      cluster_key_at_decision: "customer onboarding",
      mapping_decision: "unassigned",
      mapped_site_page_id: null,
      review_state: "confirmed",
      assignment_invalidated_by: null,
      analysis_invocation_id: null,
      decided_by: null,
      reason: approval.reason,
      decided_at: canonicalDatabaseNow,
      reviewed_projection: {
        projectId: ids.project,
        keywordId: ids.keyword,
        governanceRevision: 4,
        status: "approved",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        clusterKey: "customer onboarding",
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        mappingReviewState: "confirmed",
        assignmentInvalidatedBy: null,
        earlierHistoryAvailable: false,
      },
    });
    // Serialized against human review by the same project writer lock.
    const lock = sqlFor(db.calls.find((call) => call.method === "execute")!);
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(db.last("for").args).toEqual(["update"]);
  });

  it("never overwrites a keyword a human has already decided", async () => {
    const db = new FakeExecutor();
    db.enqueue([{ keyword_entity_id: ids.keyword }]);
    const repo = new KeywordGovernanceRepository(db as never, clock);

    await expect(
      repo.applySystemApprovals(scope, [approval]),
    ).resolves.toEqual([
      {
        keywordId: ids.keyword,
        applied: false,
        skipped: "human_decision_exists",
        governanceRevision: null,
      },
    ]);
    expect(db.all("update")).toHaveLength(0);
    expect(db.all("insert")).toHaveLength(0);
  });

  it("is idempotent: a keyword this pass already approved is left untouched", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [
        {
          ...keyword,
          status: "approved",
          cluster_key: "customer onboarding",
          mapping_review_state: "confirmed",
          mapping_revision: 4,
        },
      ],
    );
    const repo = new KeywordGovernanceRepository(db as never, clock);

    await expect(
      repo.applySystemApprovals(scope, [approval]),
    ).resolves.toEqual([
      {
        keywordId: ids.keyword,
        applied: false,
        skipped: "already_reviewed",
        governanceRevision: null,
      },
    ]);
    expect(db.all("update")).toHaveLength(0);
    expect(db.all("insert")).toHaveLength(0);
  });

  it("skips a keyword whose revision moved, a foreign Site Page, and an absent keyword", async () => {
    const movedDb = new FakeExecutor();
    movedDb.enqueue([], [{ ...keyword, mapping_revision: 5 }]);
    await expect(
      new KeywordGovernanceRepository(
        movedDb as never,
        clock,
      ).applySystemApprovals(scope, [approval]),
    ).resolves.toMatchObject([{ applied: false, skipped: "revision_moved" }]);
    expect(movedDb.all("update")).toHaveLength(0);

    const pageDb = new FakeExecutor();
    // no user decisions, and the requested Site Page resolves to nothing
    pageDb.enqueue([], []);
    await expect(
      new KeywordGovernanceRepository(
        pageDb as never,
        clock,
      ).applySystemApprovals(scope, [
        {
          ...approval,
          mappingDecision: "existing_page",
          mappedSitePageId: ids.page,
        },
      ]),
    ).resolves.toMatchObject([
      { applied: false, skipped: "site_page_absent" },
    ]);
    expect(pageDb.all("update")).toHaveLength(0);

    const absentDb = new FakeExecutor();
    absentDb.enqueue([], []);
    await expect(
      new KeywordGovernanceRepository(
        absentDb as never,
        clock,
      ).applySystemApprovals(scope, [approval]),
    ).resolves.toMatchObject([{ applied: false, skipped: "keyword_absent" }]);
    expect(absentDb.all("update")).toHaveLength(0);
  });

  it("reports an unreadable ledger instead of repairing or overwriting it", async () => {
    const missingDb = new FakeExecutor();
    missingDb.enqueue([], [keyword], []);
    await expect(
      new KeywordGovernanceRepository(
        missingDb as never,
        clock,
      ).applySystemApprovals(scope, [approval]),
    ).resolves.toMatchObject([
      { applied: false, skipped: "ledger_unreadable" },
    ]);
    expect(missingDb.all("update")).toHaveLength(0);

    const divergentDb = new FakeExecutor();
    divergentDb.enqueue(
      [],
      [keyword],
      [{ ...baseline, status: "approved" }],
    );
    await expect(
      new KeywordGovernanceRepository(
        divergentDb as never,
        clock,
      ).applySystemApprovals(scope, [approval]),
    ).resolves.toMatchObject([
      { applied: false, skipped: "ledger_unreadable" },
    ]);
    expect(divergentDb.all("update")).toHaveLength(0);
  });

  it("carries the existing classification forward instead of inventing one", async () => {
    const classified = {
      ...keyword,
      intent: "commercial",
      buyer_stage: "consideration",
    };
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [classified],
      [
        {
          ...baseline,
          intent: "commercial",
          buyer_stage: "consideration",
          reviewed_projection: {
            ...baselineProjection,
            intent: "commercial",
            buyerStage: "consideration",
          },
        },
      ],
      [{ mapping_revision: 4, updated_at: databaseNow }],
      [],
    );

    await new KeywordGovernanceRepository(
      db as never,
      clock,
    ).applySystemApprovals(scope, [approval]);

    expect(db.last("values").args[0]).toMatchObject({
      intent: "commercial",
      buyer_stage: "consideration",
      reviewed_projection: expect.objectContaining({
        intent: "commercial",
        buyerStage: "consideration",
      }),
    });
  });

  it("rejects malformed or oversized automated batches before any SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordGovernanceRepository(db as never, clock);

    await expect(
      repo.applySystemApprovals(scope, [{ ...approval, clusterKey: "" }]),
    ).rejects.toThrow(/clusterKey/u);
    await expect(
      repo.applySystemApprovals(scope, [
        { ...approval, clusterKey: "x".repeat(201) },
      ]),
    ).rejects.toThrow(/clusterKey/u);
    await expect(
      repo.applySystemApprovals(scope, [
        { ...approval, mappingDecision: "existing_page" },
      ]),
    ).rejects.toThrow(/mappedSitePageId/u);
    await expect(
      repo.applySystemApprovals(scope, [
        {
          ...approval,
          mappingDecision: "new_asset" as never,
        },
      ]),
    ).rejects.toThrow(/unassigned or map it to an existing page/u);
    await expect(
      repo.applySystemApprovals(scope, [approval, approval]),
    ).rejects.toThrow(/repeat a keywordId/u);
    await expect(
      repo.applySystemApprovals(
        scope,
        Array.from(
          { length: MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH + 1 },
          (_value, index) => ({
            ...approval,
            keywordId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          }),
        ),
      ),
    ).rejects.toThrow(/at most/u);
    expect(db.calls).toEqual([]);
  });

  it("does nothing at all for an empty batch", async () => {
    const db = new FakeExecutor();
    await expect(
      new KeywordGovernanceRepository(
        db as never,
        clock,
      ).applySystemApprovals(scope, []),
    ).resolves.toEqual([]);
    expect(db.calls).toEqual([]);
  });
});

describe("KeywordGovernanceRepository.applyGeneratedTopicAssignments", () => {
  const group = {
    groupKey: "group:onboarding",
    topicNodeId: ids.topic,
    topicModelRevision: 1,
  } as const;
  const providerAssignment = {
    groupKey: group.groupKey,
    keywordId: ids.keyword,
    expectedGovernanceRevision: 3,
    resolvedIntent: {
      authority: "provider_observed",
      value: "commercial",
      analysisInvocationId: null,
    },
  } as const;
  const generatedAssignment = {
    ...providerAssignment,
    resolvedIntent: {
      authority: "llm_generated",
      value: "informational",
      analysisInvocationId: ids.invocation,
    },
  } as const;
  const input = {
    groups: [group],
    assignments: [providerAssignment],
  } as const satisfies ApplyGeneratedTopicAssignmentsInput;

  function skippedCounts(
    reason: GeneratedTopicAssignmentSkip,
  ): Readonly<Record<GeneratedTopicAssignmentSkip, number>> {
    return {
      unknown_group: 0,
      topic_revision_moved: 0,
      topic_node_absent: 0,
      intent_unavailable: 0,
      keyword_absent: 0,
      human_decision_exists: 0,
      revision_moved: 0,
      revision_exhausted: 0,
      ledger_unreadable: 0,
      conflict: 0,
      [reason]: 1,
    };
  }

  it("assigns the exact confirmed Topic while provider intent wins without model lineage", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [{ revision: 1 }],
      [{
        topic_node_id: ids.topic,
        topic_model_revision: 1,
        label: "Customer Onboarding",
      }],
      [],
      [keyword],
      [baseline],
      [{ mapping_revision: 4, updated_at: databaseNow }],
      [],
    );
    const report = await new KeywordGovernanceRepository(
      db as never,
      clock,
    ).applyGeneratedTopicAssignments(scope, input);

    expect(report).toMatchObject({
      assignedCount: 1,
      skippedCount: 0,
      outcomes: [{
        groupKey: group.groupKey,
        keywordId: ids.keyword,
        applied: true,
        skipped: null,
        governanceRevision: 4,
      }],
    });
    expect(Object.values(report.skipped).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(db.last("set").args[0]).toMatchObject({
      status: "approved",
      intent: "commercial",
      cluster_key: "Customer Onboarding",
      mapping_review_state: "confirmed",
      mapping_revision: 4,
    });
    expect(db.last("values").args[0]).toMatchObject({
      decision_origin: "system_suggestion",
      intent: "commercial",
      topic_node_id: ids.topic,
      topic_model_revision: 1,
      cluster_key_at_decision: "Customer Onboarding",
      analysis_invocation_id: null,
      decided_by: null,
      reviewed_projection: expect.objectContaining({
        topicNodeId: ids.topic,
        topicModelRevision: 1,
        intent: "commercial",
      }),
    });
    const topicPredicate = db
      .all("where")
      .map(sqlFor)
      .find((query) => query.params.includes(ids.topic));
    expect(topicPredicate?.params).toEqual(
      expect.arrayContaining([
        ids.workspace,
        ids.project,
        ids.topic,
        1,
        "active",
        "confirmed",
      ]),
    );
  });

  it("persists the successful invocation on every LLM fallback and nowhere else", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [{ revision: 1 }],
      [{
        topic_node_id: ids.topic,
        topic_model_revision: 1,
        label: "Customer Onboarding",
      }],
      [],
      [keyword],
      [baseline],
      [{ mapping_revision: 4, updated_at: databaseNow }],
      [],
    );
    const report = await new KeywordGovernanceRepository(
      db as never,
      clock,
    ).applyGeneratedTopicAssignments(scope, {
      groups: [group],
      assignments: [generatedAssignment],
    });

    expect(report.outcomes).toMatchObject([{ applied: true }]);
    expect(db.last("values").args[0]).toMatchObject({
      intent: "informational",
      analysis_invocation_id: ids.invocation,
    });

    for (const resolvedIntent of [
      {
        authority: "provider_observed",
        value: "commercial",
        analysisInvocationId: ids.invocation,
      },
      {
        authority: "llm_generated",
        value: "commercial",
        analysisInvocationId: null,
      },
      {
        authority: "user_confirmed",
        value: "commercial",
        analysisInvocationId: ids.invocation,
      },
      {
        authority: "governed_legacy",
        value: "commercial",
        analysisInvocationId: null,
      },
    ] as const) {
      const invalidDb = new FakeExecutor();
      await expect(
        new KeywordGovernanceRepository(
          invalidDb as never,
          clock,
        ).applyGeneratedTopicAssignments(scope, {
          groups: [group],
          assignments: [{
            ...providerAssignment,
            resolvedIntent,
          } as never],
        }),
      ).rejects.toThrow(/resolvedIntent|invocation|authority/u);
      expect(invalidDb.calls).toEqual([]);
    }
  });

  it("never overwrites a human decision and reports the skip", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [{ revision: 1 }],
      [{
        topic_node_id: ids.topic,
        topic_model_revision: 1,
        label: "Customer Onboarding",
      }],
      [{ keyword_entity_id: ids.keyword }],
    );

    await expect(
      new KeywordGovernanceRepository(
        db as never,
        clock,
      ).applyGeneratedTopicAssignments(scope, input),
    ).resolves.toEqual({
      assignedCount: 0,
      skippedCount: 1,
      skipped: skippedCounts("human_decision_exists"),
      outcomes: [{
        groupKey: group.groupKey,
        keywordId: ids.keyword,
        applied: false,
        skipped: "human_decision_exists",
        governanceRevision: null,
      }],
    });
    expect(db.all("update")).toHaveLength(0);
    expect(db.all("insert")).toHaveLength(0);
  });

  it("counts unknown groups, unavailable intent, moved Topic revisions, and absent Topic nodes as skips", async () => {
    const unknownGroupDb = new FakeExecutor();
    await expect(
      new KeywordGovernanceRepository(
        unknownGroupDb as never,
        clock,
      ).applyGeneratedTopicAssignments(scope, {
        groups: [group],
        assignments: [{
          ...providerAssignment,
          groupKey: "group:unknown",
        }],
      }),
    ).resolves.toMatchObject({
      assignedCount: 0,
      skippedCount: 1,
      skipped: skippedCounts("unknown_group"),
    });
    expect(unknownGroupDb.calls).toEqual([]);

    const unavailableDb = new FakeExecutor();
    await expect(
      new KeywordGovernanceRepository(
        unavailableDb as never,
        clock,
      ).applyGeneratedTopicAssignments(scope, {
        groups: [group],
        assignments: [{ ...providerAssignment, resolvedIntent: null }],
      }),
    ).resolves.toMatchObject({
      assignedCount: 0,
      skippedCount: 1,
      skipped: skippedCounts("intent_unavailable"),
    });
    expect(unavailableDb.calls).toEqual([]);

    const movedDb = new FakeExecutor();
    movedDb.enqueue([{ revision: 2 }]);
    await expect(
      new KeywordGovernanceRepository(
        movedDb as never,
        clock,
      ).applyGeneratedTopicAssignments(scope, input),
    ).resolves.toMatchObject({
      assignedCount: 0,
      skippedCount: 1,
      skipped: skippedCounts("topic_revision_moved"),
    });
    expect(movedDb.all("update")).toHaveLength(0);

    const absentTopicDb = new FakeExecutor();
    absentTopicDb.enqueue([{ revision: 1 }], []);
    await expect(
      new KeywordGovernanceRepository(
        absentTopicDb as never,
        clock,
      ).applyGeneratedTopicAssignments(scope, input),
    ).resolves.toMatchObject({
      assignedCount: 0,
      skippedCount: 1,
      skipped: skippedCounts("topic_node_absent"),
    });
    expect(absentTopicDb.all("update")).toHaveLength(0);
  });

  it("counts a moved keyword revision and a failed CAS as conflicts without appending", async () => {
    const movedKeywordDb = new FakeExecutor();
    movedKeywordDb.enqueue(
      [{ revision: 1 }],
      [{
        topic_node_id: ids.topic,
        topic_model_revision: 1,
        label: "Customer Onboarding",
      }],
      [],
      [{ ...keyword, mapping_revision: 4 }],
    );
    await expect(
      new KeywordGovernanceRepository(
        movedKeywordDb as never,
        clock,
      ).applyGeneratedTopicAssignments(scope, input),
    ).resolves.toMatchObject({
      skipped: skippedCounts("revision_moved"),
    });
    expect(movedKeywordDb.all("insert")).toHaveLength(0);

    const conflictDb = new FakeExecutor();
    conflictDb.enqueue(
      [{ revision: 1 }],
      [{
        topic_node_id: ids.topic,
        topic_model_revision: 1,
        label: "Customer Onboarding",
      }],
      [],
      [keyword],
      [baseline],
      [],
    );
    await expect(
      new KeywordGovernanceRepository(
        conflictDb as never,
        clock,
      ).applyGeneratedTopicAssignments(scope, input),
    ).resolves.toMatchObject({
      assignedCount: 0,
      skippedCount: 1,
      skipped: skippedCounts("conflict"),
    });
    expect(conflictDb.all("insert")).toHaveLength(0);
  });

  it("keeps the existing evidence-only system path Topic-free and invocation-free", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [keyword],
      [baseline],
      [{ mapping_revision: 4, updated_at: databaseNow }],
      [],
    );
    await new KeywordGovernanceRepository(
      db as never,
      clock,
    ).applySystemApprovals(scope, [{
      keywordId: ids.keyword,
      expectedGovernanceRevision: 3,
      clusterKey: "customer onboarding",
      mappingDecision: "unassigned",
      mappedSitePageId: null,
      reason: "auto_keyword_governance.v1 approved provider evidence.",
    }]);
    expect(db.last("values").args[0]).toMatchObject({
      topic_node_id: null,
      topic_model_revision: null,
      analysis_invocation_id: null,
    });
  });

  it("rejects duplicate or oversized generated assignment batches before SQL", async () => {
    const duplicateDb = new FakeExecutor();
    const repository = new KeywordGovernanceRepository(
      duplicateDb as never,
      clock,
    );
    await expect(
      repository.applyGeneratedTopicAssignments(scope, {
        groups: [group],
        assignments: [providerAssignment, providerAssignment],
      }),
    ).rejects.toThrow(/repeat a keywordId/u);
    await expect(
      repository.applyGeneratedTopicAssignments(scope, {
        groups: [group],
        assignments: Array.from(
          { length: MAX_GENERATED_TOPIC_ASSIGNMENT_BATCH + 1 },
          (_value, index) => ({
            ...providerAssignment,
            keywordId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          }),
        ),
      }),
    ).rejects.toThrow(/at most/u);
    expect(duplicateDb.calls).toEqual([]);
  });
});

describe("KeywordGovernanceRepository.listDecisionOriginsAt", () => {
  const otherKeyword = "00000000-0000-4000-8000-000000000012";

  it("reads one project-scoped statement keyed by the EXACT revision", async () => {
    const db = new FakeExecutor();
    db.enqueueExecute({
      rows: [
        {
          keyword_entity_id: ids.keyword,
          governance_revision: 1,
          decision_origin: "system_suggestion",
          analysis_invocation_id: ids.invocation,
        },
        {
          keyword_entity_id: otherKeyword,
          governance_revision: 4,
          decision_origin: "user",
          analysis_invocation_id: null,
        },
      ],
    });

    const rows = await new KeywordGovernanceRepository(
      db as never,
      clock,
    ).listDecisionOriginsAt(scope, [
      { keywordId: ids.keyword, governanceRevision: 1 },
      { keywordId: otherKeyword, governanceRevision: 4 },
    ]);

    expect(rows).toEqual([
      {
        keywordId: ids.keyword,
        governanceRevision: 1,
        decisionOrigin: "system_suggestion",
        analysisInvocationId: ids.invocation,
      },
      {
        keywordId: otherKeyword,
        governanceRevision: 4,
        decisionOrigin: "user",
        analysisInvocationId: null,
      },
    ]);
    // One statement for the whole page: never one query per keyword.
    expect(db.all("execute")).toHaveLength(1);
    const query = sqlFor(db.last("execute"));
    expect(query.sql).toMatch(/"workspace_id" = \$\d+::uuid/u);
    // Project isolation lives in the same WHERE, never in memory.
    expect(query.sql).toMatch(/"project_id" = \$\d+::uuid/u);
    expect(query.sql).toContain("governance_revision");
    expect(query.sql).toContain("analysis_invocation_id");
    expect(query.params).toEqual([
      ids.workspace,
      ids.project,
      ids.keyword,
      1,
      otherKeyword,
      4,
    ]);
  });

  it("leaves a keyword with no decision at that revision out of the result", async () => {
    const db = new FakeExecutor();
    db.enqueueExecute({ rows: [] });

    await expect(
      new KeywordGovernanceRepository(db as never, clock).listDecisionOriginsAt(
        scope,
        [{ keywordId: ids.keyword, governanceRevision: 7 }],
      ),
    ).resolves.toEqual([]);
  });

  it("touches the database for nothing when no keyword is requested", async () => {
    const db = new FakeExecutor();
    await expect(
      new KeywordGovernanceRepository(db as never, clock).listDecisionOriginsAt(
        scope,
        [],
      ),
    ).resolves.toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("refuses an unbounded, repeated or impossible request before any read", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordGovernanceRepository(db as never, clock);
    await expect(
      repo.listDecisionOriginsAt(scope, [
        { keywordId: ids.keyword, governanceRevision: 1 },
        { keywordId: ids.keyword, governanceRevision: 2 },
      ]),
    ).rejects.toThrow(/repeat a keywordId/u);
    await expect(
      repo.listDecisionOriginsAt(scope, [
        { keywordId: ids.keyword, governanceRevision: -1 },
      ]),
    ).rejects.toThrow(/governanceRevision/u);
    await expect(
      repo.listDecisionOriginsAt(scope, [
        { keywordId: "not-a-uuid", governanceRevision: 1 },
      ]),
    ).rejects.toThrow(/keywordId/u);
    await expect(
      repo.listDecisionOriginsAt(
        scope,
        Array.from(
          { length: MAX_KEYWORD_DECISION_ORIGIN_BATCH + 1 },
          (_value, index) => ({
            keywordId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            governanceRevision: 0,
          }),
        ),
      ),
    ).rejects.toThrow(/at most/u);
    expect(db.calls).toEqual([]);
  });

  it("fails closed instead of reporting an origin the ledger never proved", async () => {
    const unrequested = new FakeExecutor();
    unrequested.enqueueExecute({
      rows: [
        {
          keyword_entity_id: otherKeyword,
          governance_revision: 1,
          decision_origin: "user",
          analysis_invocation_id: null,
        },
      ],
    });
    await expect(
      new KeywordGovernanceRepository(
        unrequested as never,
        clock,
      ).listDecisionOriginsAt(scope, [
        { keywordId: ids.keyword, governanceRevision: 1 },
      ]),
    ).rejects.toBeInstanceOf(KeywordGovernanceIntegrityError);

    const unknownOrigin = new FakeExecutor();
    unknownOrigin.enqueueExecute({
      rows: [
        {
          keyword_entity_id: ids.keyword,
          governance_revision: 1,
          decision_origin: "auto_pilot",
          analysis_invocation_id: null,
        },
      ],
    });
    await expect(
      new KeywordGovernanceRepository(
        unknownOrigin as never,
        clock,
      ).listDecisionOriginsAt(scope, [
        { keywordId: ids.keyword, governanceRevision: 1 },
      ]),
    ).rejects.toBeInstanceOf(KeywordGovernanceIntegrityError);

    for (const row of [
      {
        keyword_entity_id: ids.keyword,
        governance_revision: 1,
        decision_origin: "user",
        analysis_invocation_id: ids.invocation,
      },
      {
        keyword_entity_id: ids.keyword,
        governance_revision: 1,
        decision_origin: "migration_baseline",
        analysis_invocation_id: ids.invocation,
      },
      {
        keyword_entity_id: ids.keyword,
        governance_revision: 1,
        decision_origin: "system_suggestion",
        analysis_invocation_id: "not-a-uuid",
      },
      {
        keyword_entity_id: ids.keyword,
        governance_revision: 2,
        decision_origin: "system_suggestion",
        analysis_invocation_id: null,
      },
    ]) {
      const malformed = new FakeExecutor();
      malformed.enqueueExecute({ rows: [row] });
      await expect(
        new KeywordGovernanceRepository(
          malformed as never,
          clock,
        ).listDecisionOriginsAt(scope, [
          { keywordId: ids.keyword, governanceRevision: 1 },
        ]),
      ).rejects.toBeInstanceOf(KeywordGovernanceIntegrityError);
    }
  });
});
