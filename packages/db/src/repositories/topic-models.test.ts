import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  TopicModelConflictError,
  TopicModelIntegrityError,
  TopicModelsRepository,
  acquireTopicGovernanceProjectWriterLock,
  assertConfirmedTopicTopology,
  canonicalTopicClusterKey,
} from "./topic-models.ts";

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
  private readonly executeResults: unknown[][] = [];

  enqueue(...results: unknown[]): void {
    this.results.push(...results);
  }

  enqueueExecute(...results: unknown[][]): void {
    this.executeResults.push(...results);
  }

  take(): unknown {
    return this.results.length === 0 ? [] : this.results.shift();
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

  update(...args: unknown[]): FakeQuery {
    return this.query("update", args);
  }

  async execute(...args: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ method: "execute", args });
    return { rows: this.executeResults.shift() ?? [] };
  }

  async transaction<T>(run: (tx: never) => Promise<T>): Promise<T> {
    this.calls.push({ method: "transaction", args: [] });
    return run(this as never);
  }

  all(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }
}

const ids = {
  workspace: "20000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000002",
  actor: "20000000-0000-4000-8000-000000000003",
  model: "20000000-0000-4000-8000-000000000004",
  root: "20000000-0000-4000-8000-000000000005",
  child: "20000000-0000-4000-8000-000000000006",
  detached: "20000000-0000-4000-8000-000000000007",
  nodeRow: "20000000-0000-4000-8000-000000000008",
  childRow: "20000000-0000-4000-8000-000000000009",
  previousModel: "20000000-0000-4000-8000-000000000010",
  rootAlias: "20000000-0000-4000-8000-000000000011",
  childAlias: "20000000-0000-4000-8000-000000000012",
  keyword: "20000000-0000-4000-8000-000000000013",
  currentDecision: "20000000-0000-4000-8000-000000000014",
  invalidationDecision: "20000000-0000-4000-8000-000000000015",
  clockFact: "20000000-0000-4000-8000-000000000016",
  previousRootRow: "20000000-0000-4000-8000-000000000017",
  previousChildRow: "20000000-0000-4000-8000-000000000018",
  page: "20000000-0000-4000-8000-000000000019",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

const draftRow = {
  id: ids.model,
  workspace_id: ids.workspace,
  project_id: ids.project,
  revision: 2,
  edit_revision: 3,
  status: "draft",
  root_topic_node_id: ids.root,
  generation_basis: {},
  evidence_refs: [],
  content_hash: null,
  created_by: ids.actor,
  created_at: "2026-07-28T01:00:00.000Z",
  updated_at: "2026-07-28T02:00:00.000Z",
  confirmed_by: null,
  confirmed_at: null,
} as const;

const rootRow = {
  id: ids.nodeRow,
  workspace_id: ids.workspace,
  project_id: ids.project,
  topic_node_id: ids.root,
  topic_model_revision: 2,
  parent_topic_node_id: null,
  label: "Customer onboarding",
  description: null,
  intent_envelope: ["commercial"],
  lifecycle_state: "active",
  created_by: ids.actor,
  created_at: "2026-07-28T01:00:00.000Z",
} as const;

const childRow = {
  ...rootRow,
  id: ids.childRow,
  topic_node_id: ids.child,
  parent_topic_node_id: ids.root,
  label: "Onboarding automation",
} as const;

describe("Topic Model topology authority", () => {
  it("accepts one parentless root only when every node reaches it", () => {
    expect(() =>
      assertConfirmedTopicTopology({
        rootTopicNodeId: ids.root,
        nodes: [
          { topicNodeId: ids.root, parentTopicNodeId: null },
          { topicNodeId: ids.child, parentTopicNodeId: ids.root },
        ],
      }),
    ).not.toThrow();

    for (const topology of [
      {
        rootTopicNodeId: null,
        nodes: [{ topicNodeId: ids.root, parentTopicNodeId: null }],
      },
      {
        rootTopicNodeId: ids.root,
        nodes: [
          { topicNodeId: ids.root, parentTopicNodeId: null },
          { topicNodeId: ids.detached, parentTopicNodeId: null },
        ],
      },
      {
        rootTopicNodeId: ids.root,
        nodes: [
          { topicNodeId: ids.root, parentTopicNodeId: null },
          { topicNodeId: ids.child, parentTopicNodeId: ids.detached },
          { topicNodeId: ids.detached, parentTopicNodeId: ids.child },
        ],
      },
    ] as const) {
      expect(() => assertConfirmedTopicTopology(topology)).toThrow(
        TopicModelConflictError,
      );
    }
  });

  it("allocates canonical aliases on the server and resolves collisions deterministically", () => {
    expect(
      canonicalTopicClusterKey("  Customer Onboarding!  ", new Set(), ids.root),
    ).toBe("customer-onboarding");
    expect(
      canonicalTopicClusterKey(
        "Customer Onboarding",
        new Set(["customer-onboarding"]),
        ids.root,
      ),
    ).toBe("customer-onboarding-200000000000");
  });

  it("uses the same transaction-scoped project advisory lock key as Keyword Review", async () => {
    const db = new FakeExecutor();
    await acquireTopicGovernanceProjectWriterLock(db as never, scope);

    const compiled = new PgDialect().sqlToQuery(
      db.calls.find((call) => call.method === "execute")!.args[0] as never,
    );
    expect(compiled.sql).toContain("pg_advisory_xact_lock");
    expect(compiled.params).toEqual([
      `topic-governance:${ids.workspace}:${ids.project}`,
    ]);
  });
});

describe("TopicModelsRepository", () => {
  it("projects the one current draft with its real edit revision", async () => {
    const db = new FakeExecutor();
    db.enqueue([draftRow], [rootRow], [], []);
    const repository = new TopicModelsRepository(db as never);

    await expect(repository.getDraft(scope)).resolves.toMatchObject({
      state: "draft",
      projectId: ids.project,
      topicModelRevision: 2,
      editRevision: 3,
      rootTopicNodeId: ids.root,
      nodes: [
        {
          topicNodeId: ids.root,
          topicModelRevision: 2,
          label: "Customer onboarding",
        },
      ],
    });
  });

  it("fails closed if storage contains more than one draft", async () => {
    const db = new FakeExecutor();
    db.enqueue([draftRow, { ...draftRow, id: ids.detached }]);
    const repository = new TopicModelsRepository(db as never);

    await expect(repository.getDraft(scope)).rejects.toBeInstanceOf(
      TopicModelIntegrityError,
    );
  });

  it("rejects a stale edit CAS after the shared project lock and before node writes", async () => {
    const db = new FakeExecutor();
    db.enqueue([{ id: ids.project }], [draftRow]);
    const repository = new TopicModelsRepository(db as never);

    await expect(
      repository.patchDraft(scope, ids.actor, {
        topicModelRevision: 2,
        expectedEditRevision: 2,
        reason: "Rename after editorial review.",
        intents: [
          {
            kind: "rename",
            topicNodeId: ids.root,
            label: "Customer onboarding automation",
          },
        ],
      }),
    ).rejects.toMatchObject({
      name: "TopicModelConflictError",
      code: "EDIT_REVISION_CONFLICT",
      expectedRevision: 2,
      currentRevision: 3,
    });

    const lockIndex = db.calls.findIndex(
      (call) => call.method === "execute",
    );
    const rowLockIndex = db.calls.findIndex(
      (call) =>
        call.method === "for" && call.args[0] === "update",
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(rowLockIndex).toBeGreaterThan(lockIndex);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
    expect(db.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("rejects retiring the root or a Topic with active children as explicit semantic conflicts", async () => {
    const rootDb = new FakeExecutor();
    rootDb.enqueue(
      [{ id: ids.project }],
      [draftRow],
      [rootRow, childRow],
      [],
      [],
    );
    await expect(
      new TopicModelsRepository(rootDb as never).patchDraft(
        scope,
        ids.actor,
        {
          topicModelRevision: 2,
          expectedEditRevision: 3,
          reason: "Remove an obsolete Topic from the customer map.",
          intents: [
            {
              kind: "retire",
              topicNodeId: ids.root,
              affectedKeywordReviewState: "unreviewed",
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      code: "TOPIC_ROOT_RETIRE_FORBIDDEN",
    });
    expect(rootDb.all("update")).toHaveLength(0);

    const childDb = new FakeExecutor();
    childDb.enqueue(
      [{ id: ids.project }],
      [draftRow],
      [
        rootRow,
        childRow,
        {
          ...childRow,
          id: ids.detached,
          topic_node_id: ids.detached,
          parent_topic_node_id: ids.child,
          label: "Implementation checklist",
        },
      ],
      [],
      [],
    );
    await expect(
      new TopicModelsRepository(childDb as never).patchDraft(
        scope,
        ids.actor,
        {
          topicModelRevision: 2,
          expectedEditRevision: 3,
          reason: "Remove an obsolete Topic from the customer map.",
          intents: [
            {
              kind: "retire",
              topicNodeId: ids.child,
              affectedKeywordReviewState: "unreviewed",
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      code: "TOPIC_NODE_HAS_ACTIVE_CHILDREN",
    });
    expect(childDb.all("update")).toHaveLength(0);

    const retiredParentDb = new FakeExecutor();
    retiredParentDb.enqueue(
      [{ id: ids.project }],
      [draftRow],
      [
        rootRow,
        { ...childRow, lifecycle_state: "superseded" },
      ],
      [],
      [],
    );
    await expect(
      new TopicModelsRepository(retiredParentDb as never).patchDraft(
        scope,
        ids.actor,
        {
          topicModelRevision: 2,
          expectedEditRevision: 3,
          reason: "Do not attach new content below a deleted Topic.",
          intents: [
            {
              kind: "create",
              parentTopicNodeId: ids.child,
              label: "Invalid active child",
              description: null,
              intentEnvelope: [],
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "TOPIC_NODE_INVALID" });
    expect(retiredParentDb.all("insert")).toHaveLength(0);
  });

  it("retires a leaf only in the draft and advances the exact edit CAS without deleting history", async () => {
    const now = "2026-07-28T03:00:00.000Z";
    const retiredChild = {
      ...childRow,
      lifecycle_state: "superseded",
    } as const;
    const updatedDraft = {
      ...draftRow,
      edit_revision: 4,
      updated_at: now,
    } as const;
    const db = new FakeExecutor();
    db.enqueue(
      [{ id: ids.project }],
      [draftRow],
      [rootRow, childRow],
      [],
      [],
      [],
      [],
      [updatedDraft],
      [rootRow, retiredChild],
      [],
      [],
    );
    const repository = new TopicModelsRepository(db as never, {
      newId: () => ids.clockFact,
      now: () => now,
    });

    await expect(
      repository.patchDraft(scope, ids.actor, {
        topicModelRevision: 2,
        expectedEditRevision: 3,
        reason: "Remove an obsolete Topic from the customer map.",
        intents: [
          {
            kind: "retire",
            topicNodeId: ids.child,
            affectedKeywordReviewState: "unreviewed",
          },
        ],
      }),
    ).resolves.toMatchObject({
      state: "draft",
      topicModelRevision: 2,
      editRevision: 4,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          topicNodeId: ids.child,
          lifecycleState: "superseded",
        }),
      ]),
    });

    expect(
      db
        .all("set")
        .map((call) => call.args[0])
        .find(
          (value) =>
            (value as { lifecycle_state?: unknown })
              .lifecycle_state === "superseded",
        ),
    ).toMatchObject({ lifecycle_state: "superseded" });
    expect(
      db
        .all("set")
        .map((call) => call.args[0])
        .find(
          (value) =>
            (value as { edit_revision?: unknown }).edit_revision === 4,
        ),
    ).toMatchObject({ edit_revision: 4 });
    expect(db.calls.some((call) => call.method === "delete")).toBe(false);
  });

  it("refuses confirmation when a draft contains a detached root", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [{ id: ids.project }],
      [draftRow],
      [
        rootRow,
        {
          ...rootRow,
          id: ids.detached,
          topic_node_id: ids.detached,
          label: "Detached",
        },
      ],
    );
    const repository = new TopicModelsRepository(db as never);

    await expect(
      repository.confirmDraft(scope, ids.actor, {
        topicModelRevision: 2,
        expectedEditRevision: 3,
        reason: "Freeze the reviewed Topic tree.",
      }),
    ).rejects.toMatchObject({
      name: "TopicModelConflictError",
      code: "TOPIC_NODE_INVALID",
    });
    expect(db.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("atomically invalidates current Keyword assignments when a retired draft is confirmed", async () => {
    const now = "2026-07-28T04:00:00.000Z";
    const databaseInvalidationInstant =
      "2026-07-28 04:00:00.000001+00";
    const canonicalDatabaseInvalidationInstant =
      "2026-07-28T04:00:00.000001Z";
    const retiredChild = {
      ...childRow,
      lifecycle_state: "superseded",
    } as const;
    const currentNodes = [rootRow, retiredChild] as const;
    const previousNodes = [
      {
        ...rootRow,
        id: ids.previousRootRow,
        topic_model_revision: 1,
        created_at: "2026-07-27T01:00:00.000Z",
      },
      {
        ...childRow,
        id: ids.previousChildRow,
        topic_model_revision: 1,
        created_at: "2026-07-27T01:00:00.000Z",
      },
    ] as const;
    const previousModel = {
      ...draftRow,
      id: ids.previousModel,
      revision: 1,
      edit_revision: 1,
      status: "confirmed",
      content_hash: "a".repeat(64),
      created_at: "2026-07-27T01:00:00.000Z",
      updated_at: "2026-07-27T02:00:00.000Z",
      confirmed_by: ids.actor,
      confirmed_at: "2026-07-27T02:00:00.000Z",
    } as const;
    const confirmedModel = {
      ...draftRow,
      status: "confirmed",
      content_hash: "b".repeat(64),
      confirmed_by: ids.actor,
      confirmed_at: now,
    } as const;
    const aliases = [
      {
        id: ids.rootAlias,
        topic_node_id: ids.root,
        legacy_cluster_key: "customer-onboarding",
        valid_from_revision: 1,
        valid_to_revision: null,
        is_current: true,
      },
      {
        id: ids.childAlias,
        topic_node_id: ids.child,
        legacy_cluster_key: "onboarding-automation",
        valid_from_revision: 1,
        valid_to_revision: null,
        is_current: true,
      },
    ] as const;
    const currentKeywordDecision = {
      id: ids.currentDecision,
      keyword_entity_id: ids.keyword,
      governance_revision: 7,
      status: "approved",
      intent: "commercial",
      buyer_stage: "consideration",
      topic_node_id: ids.child,
      topic_model_revision: 1,
      cluster_key_at_decision: "onboarding-automation",
      mapping_decision: "existing_page",
      mapped_site_page_id: ids.page,
      review_state: "confirmed",
      assignment_invalidated_by: null,
      reviewed_projection: { earlierHistoryAvailable: false },
      entity_revision: 7,
      entity_status: "approved",
      entity_intent: "commercial",
      entity_buyer_stage: "consideration",
      entity_cluster_key: "onboarding-automation",
      entity_mapping_decision: "existing_page",
      entity_mapped_site_page_id: ids.page,
      entity_review_state: "confirmed",
    } as const;
    const db = new FakeExecutor();
    db.enqueueExecute([], [currentKeywordDecision]);
    db.enqueue(
      [{ id: ids.project }],
      [draftRow],
      currentNodes,
      [previousModel],
      previousNodes,
      aliases,
      [],
      [{
        id: ids.keyword,
        updated_at: databaseInvalidationInstant,
      }],
      [],
      currentNodes,
      aliases,
      [],
      [confirmedModel],
      currentNodes,
      aliases,
      [],
    );
    const generatedIds = [ids.clockFact, ids.invalidationDecision];
    const repository = new TopicModelsRepository(db as never, {
      newId: () =>
        generatedIds.shift() ??
        (() => {
          throw new Error("Unexpected UUID allocation");
        })(),
      now: () => now,
    });

    await expect(
      repository.confirmDraft(scope, ids.actor, {
        topicModelRevision: 2,
        expectedEditRevision: 3,
        reason: "Confirm the reviewed Topic retirement.",
      }),
    ).resolves.toMatchObject({
      state: "confirmed",
      topicModelRevision: 2,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          topicNodeId: ids.child,
          lifecycleState: "superseded",
        }),
      ]),
    });

    const invalidationUpdate = db
      .all("set")
      .map((call) => call.args[0])
      .find(
        (value) =>
          (value as { mapping_review_state?: unknown })
            .mapping_review_state === "unreviewed",
      ) as Record<string, unknown> | undefined;
    expect(invalidationUpdate).toMatchObject({
      mapping_review_state: "unreviewed",
      mapping_revision: 8,
    });
    const invalidationInstant = new PgDialect().sqlToQuery(
      invalidationUpdate!["updated_at"] as never,
    );
    expect(invalidationInstant.sql).toContain("greatest");
    expect(invalidationInstant.sql).toContain("clock_timestamp()");
    expect(invalidationInstant.sql).toContain(
      "interval '1 microsecond'",
    );
    expect(invalidationInstant.params).toEqual([]);

    const invalidationDecision = db
      .all("values")
      .map((call) => call.args[0])
      .find(
        (value) =>
          (value as { assignment_invalidated_by?: unknown })
            .assignment_invalidated_by === "topic_retire",
      );
    expect(invalidationDecision).toMatchObject({
      id: ids.invalidationDecision,
      keyword_entity_id: ids.keyword,
      governance_revision: 8,
      topic_node_id: ids.child,
      topic_model_revision: 1,
      review_state: "unreviewed",
      assignment_invalidated_by: "topic_retire",
      decided_by: ids.actor,
      reason: "Confirm the reviewed Topic retirement.",
      decided_at: canonicalDatabaseInvalidationInstant,
      created_at: canonicalDatabaseInvalidationInstant,
      reviewed_projection: expect.objectContaining({
        assignmentInvalidatedBy: "topic_retire",
        mappingReviewState: "unreviewed",
      }),
    });
    expect(db.calls.some((call) => call.method === "delete")).toBe(false);
  });
});
