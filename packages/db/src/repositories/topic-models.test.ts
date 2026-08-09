import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { contentHash } from "../hash.ts";
import {
  TopicModelConflictError,
  TopicModelIntegrityError,
  TopicModelsRepository,
  acquireTopicGovernanceProjectWriterLock,
  assertConfirmedTopicTopology,
  canonicalTopicClusterKey,
  type MaterializeSystemConfirmedFirstRevisionInput,
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
  invocation: "20000000-0000-4000-8000-000000000020",
  generatedModel: "20000000-0000-4000-8000-000000000021",
  generatedRoot: "20000000-0000-4000-8000-000000000022",
  generatedRootRow: "20000000-0000-4000-8000-000000000023",
  generatedChild: "20000000-0000-4000-8000-000000000024",
  generatedChildRow: "20000000-0000-4000-8000-000000000025",
  confirmationFact: "20000000-0000-4000-8000-000000000026",
  generatedRootAlias: "20000000-0000-4000-8000-000000000027",
  generatedChildAlias: "20000000-0000-4000-8000-000000000028",
  generationRun: "20000000-0000-4000-8000-000000000029",
  analysisRefreshRun: "20000000-0000-4000-8000-000000000030",
  keywordOne: "20000000-0000-4000-8000-000000000031",
  keywordTwo: "20000000-0000-4000-8000-000000000032",
  keywordThree: "20000000-0000-4000-8000-000000000033",
  snapshot: "20000000-0000-4000-8000-000000000034",
  observation: "20000000-0000-4000-8000-000000000035",
  reservation: "20000000-0000-4000-8000-000000000036",
  initiator: "20000000-0000-4000-8000-000000000037",
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
  generation_basis: {
    origin: "draft_from_latest_confirmed",
    baseTopicModelRevision: 1,
    reason: "Start the next manually reviewed Topic revision.",
  },
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

const systemGenerationBasis = {
  origin: "llm_auto_confirmed",
  generationVersion: "topic-model-generation.v1",
  baseTopicModelRevision: null,
  analysisInvocationId: ids.invocation,
  promptSetVersion: "topic-model.prompt.v1",
  inputHash: "c".repeat(64),
  keywordGroupCount: 2,
  keywordCount: 7,
  reason: "Initial model generated by Analysis Refresh",
} as const;

const exactGenerationManifest = {
  schemaVersion: "topic-model-generation-input.v1",
  analysisRefreshRunId: ids.analysisRefreshRun,
  projectId: ids.project,
  market: "US",
  language: "en-US",
  groups: [
    {
      groupKey: "group-one",
      representativeKeywords: ["topic automation"],
      keywordCount: 2,
      aggregateSearchVolume: 120,
      providerIntentDistribution: {
        informational: 0,
        navigational: 0,
        commercial: 1,
        transactional: 0,
      },
      urls: ["https://example.com/topic-automation"],
    },
    {
      groupKey: "group-two",
      representativeKeywords: ["orphan topic"],
      keywordCount: 1,
      aggregateSearchVolume: null,
      providerIntentDistribution: {
        informational: 0,
        navigational: 0,
        commercial: 0,
        transactional: 0,
      },
      urls: [],
    },
  ],
  productProfile: null,
  icp: null,
  keywords: [
    {
      keywordId: ids.keywordOne,
      expectedGovernanceRevision: 0,
      groupKey: "group-one",
      providerSearchIntent: {
        value: "commercial",
        snapshotId: ids.snapshot,
        observationId: ids.observation,
        observedAt: "2026-08-09T08:00:00.000Z",
      },
    },
    {
      keywordId: ids.keywordTwo,
      expectedGovernanceRevision: 1,
      groupKey: "group-one",
      providerSearchIntent: null,
    },
    {
      keywordId: ids.keywordThree,
      expectedGovernanceRevision: 2,
      groupKey: "group-two",
      providerSearchIntent: null,
    },
  ],
} as const;

const exactGenerationInputHash = contentHash(exactGenerationManifest);
const exactSystemGenerationBasis = {
  ...systemGenerationBasis,
  inputHash: exactGenerationInputHash,
  keywordCount: 3,
} as const;

const exactOutcomeProgress = {
  schemaVersion: "topic-model-generation-outcome.v1",
  keywordGroupCount: 2,
  keywordCount: 3,
  assignedCount: 2,
  skippedCount: 1,
  // The model assigned both groups, but the only group-two keyword was later
  // skipped. The public summary must conservatively derive one group with no
  // durable decision without pretending the model itself left it unassigned.
  unassignedGroupCount: 0,
  skipReasons: {
    unknown_group: 0,
    topic_revision_moved: 0,
    topic_node_absent: 0,
    intent_unavailable: 1,
    keyword_absent: 0,
    human_decision_exists: 0,
    revision_moved: 0,
    revision_exhausted: 0,
    ledger_unreadable: 0,
    conflict: 0,
  },
  limitations: ["keyword_assignments_skipped"],
} as const;

const generatedInput = {
  root: {
    topicKey: "root-output-key",
    label: "Growth strategy",
    description: "The generated Topic root.",
    intentEnvelope: ["commercial"],
  },
  children: [
    {
      topicKey: "child-output-key",
      label: "Customer onboarding",
      description: "Generated from bounded keyword evidence.",
      intentEnvelope: ["informational", "commercial"],
    },
  ],
  generationVersion: systemGenerationBasis.generationVersion,
  analysisInvocationId: ids.invocation,
  initiatedBy: ids.initiator,
  promptSetVersion: systemGenerationBasis.promptSetVersion,
  inputHash: systemGenerationBasis.inputHash,
  keywordGroupCount: systemGenerationBasis.keywordGroupCount,
  keywordCount: systemGenerationBasis.keywordCount,
} as const satisfies MaterializeSystemConfirmedFirstRevisionInput;

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
  it("materializes revision 1 from prompt-local keys and system-confirms it without a human actor", async () => {
    const now = "2026-08-09T09:00:00.000Z";
    const initialDraft = {
      id: ids.generatedModel,
      workspace_id: ids.workspace,
      project_id: ids.project,
      revision: 1,
      edit_revision: 0,
      status: "draft",
      root_topic_node_id: null,
      generation_basis: systemGenerationBasis,
      evidence_refs: [],
      content_hash: null,
      created_by: ids.initiator,
      created_at: now,
      updated_at: now,
      confirmed_by: null,
      confirmed_at: null,
    } as const;
    const materializedDraft = {
      ...initialDraft,
      edit_revision: 1,
      root_topic_node_id: ids.generatedRoot,
    } as const;
    const generatedRootRow = {
      id: ids.generatedRootRow,
      workspace_id: ids.workspace,
      project_id: ids.project,
      topic_node_id: ids.generatedRoot,
      topic_model_revision: 1,
      parent_topic_node_id: null,
      label: generatedInput.root.label,
      description: generatedInput.root.description,
      intent_envelope: generatedInput.root.intentEnvelope,
      lifecycle_state: "active",
      created_by: ids.actor,
      created_at: now,
    } as const;
    const generatedChildRow = {
      ...generatedRootRow,
      id: ids.generatedChildRow,
      topic_node_id: ids.generatedChild,
      parent_topic_node_id: ids.generatedRoot,
      label: generatedInput.children[0].label,
      description: generatedInput.children[0].description,
      intent_envelope: generatedInput.children[0].intentEnvelope,
    } as const;
    const aliases = [
      {
        id: ids.generatedRootAlias,
        topic_node_id: ids.generatedRoot,
        legacy_cluster_key: "growth-strategy",
        valid_from_revision: 1,
        valid_to_revision: null,
        is_current: true,
      },
      {
        id: ids.generatedChildAlias,
        topic_node_id: ids.generatedChild,
        legacy_cluster_key: "customer-onboarding",
        valid_from_revision: 1,
        valid_to_revision: null,
        is_current: true,
      },
    ] as const;
    const confirmed = {
      ...materializedDraft,
      status: "confirmed",
      content_hash: "d".repeat(64),
      confirmed_by: null,
      confirmed_at: now,
    } as const;
    const nodes = [generatedRootRow, generatedChildRow] as const;
    const db = new FakeExecutor();
    db.enqueueExecute([], []);
    db.enqueue(
      [{ id: ids.project, created_by: ids.actor }],
      [],
      [],
      [],
      [],
      [initialDraft],
      [],
      [],
      [materializedDraft],
      [materializedDraft],
      nodes,
      [],
      [],
      [{ initial_cluster_key: "growth-strategy" }],
      [],
      [{ initial_cluster_key: "customer-onboarding" }],
      [],
      [],
      nodes,
      aliases,
      [],
      [confirmed],
      nodes,
      aliases,
      [],
    );
    const generatedIds = [
      ids.generatedModel,
      ids.generatedRoot,
      ids.generatedRootRow,
      ids.generatedChild,
      ids.generatedChildRow,
      ids.confirmationFact,
      ids.generatedRootAlias,
      ids.generatedChildAlias,
    ];
    const repository = new TopicModelsRepository(db as never, {
      newId: () =>
        generatedIds.shift() ??
        (() => {
          throw new Error("Unexpected UUID allocation");
        })(),
      now: () => now,
    });

    const result = await repository.materializeSystemConfirmedFirstRevision(
      scope,
      generatedInput,
    );

    expect(result).toMatchObject({
      topicModelRevisionId: ids.generatedModel,
      topicNodeIdsByKey: {
        "root-output-key": ids.generatedRoot,
        "child-output-key": ids.generatedChild,
      },
      model: {
        state: "confirmed",
        topicModelRevision: 1,
        editRevision: 1,
        rootTopicNodeId: ids.generatedRoot,
        createdBy: ids.initiator,
        confirmedBy: null,
        confirmationMode: "system_auto",
        generationBasis: systemGenerationBasis,
      },
    });
    expect(result.model).not.toHaveProperty("generationSummary");
    expect(generatedIds).toEqual([]);

    const insertedValues = db.all("values").map((call) => call.args[0]);
    expect(insertedValues[0]).toMatchObject({
      id: ids.generatedModel,
      revision: 1,
      edit_revision: 0,
      status: "draft",
      root_topic_node_id: null,
      evidence_refs: [],
      created_by: ids.initiator,
    });
    expect(
      (insertedValues[0] as { generation_basis: unknown })
        .generation_basis,
    ).toEqual(systemGenerationBasis);
    expect(insertedValues[1]).toEqual([
      expect.objectContaining({
        id: ids.generatedRoot,
        created_in_revision: 1,
        initial_cluster_key: "growth-strategy",
        created_by: ids.initiator,
      }),
      expect.objectContaining({
        id: ids.generatedChild,
        created_in_revision: 1,
        initial_cluster_key: "customer-onboarding",
        created_by: ids.initiator,
      }),
    ]);
    expect(insertedValues[2]).toEqual([
      expect.objectContaining({
        id: ids.generatedRootRow,
        topic_node_id: ids.generatedRoot,
        parent_topic_node_id: null,
        created_by: ids.initiator,
      }),
      expect.objectContaining({
        id: ids.generatedChildRow,
        topic_node_id: ids.generatedChild,
        parent_topic_node_id: ids.generatedRoot,
        created_by: ids.initiator,
      }),
    ]);
    const confirmation = db
      .all("set")
      .map((call) => call.args[0])
      .find(
        (value) =>
          (value as { status?: unknown }).status === "confirmed",
      );
    expect(confirmation).toMatchObject({
      status: "confirmed",
      confirmed_by: null,
      confirmed_at: now,
      content_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("rejects client-authored Topic authority fields before SQL", async () => {
    for (const forbidden of [
      { actorId: ids.actor },
      { topicModelRevision: 1 },
      { confirmedBy: ids.actor },
      { createdAt: "2026-08-09T09:00:00.000Z" },
      { contentHash: "a".repeat(64) },
      { limitations: ["client-authored"] },
    ] as const) {
      const db = new FakeExecutor();
      const repository = new TopicModelsRepository(db as never);
      await expect(
        repository.materializeSystemConfirmedFirstRevision(
          scope,
          { ...generatedInput, ...forbidden } as never,
        ),
      ).rejects.toThrow(/only accepts|unexpected|field/u);
      expect(db.calls).toEqual([]);
    }

    const nodeDb = new FakeExecutor();
    await expect(
      new TopicModelsRepository(
        nodeDb as never,
      ).materializeSystemConfirmedFirstRevision(scope, {
        ...generatedInput,
        root: { ...generatedInput.root, id: ids.root } as never,
      }),
    ).rejects.toThrow(/root|field/u);
    expect(nodeDb.calls).toEqual([]);

    for (const initiatedBy of [
      "not-a-uuid",
      "ABCDEF00-0000-4000-8000-000000000037",
    ]) {
      const actorDb = new FakeExecutor();
      await expect(
        new TopicModelsRepository(
          actorDb as never,
        ).materializeSystemConfirmedFirstRevision(scope, {
          ...generatedInput,
          initiatedBy,
        }),
      ).rejects.toThrow(/initiatedBy/u);
      expect(actorDb.calls).toEqual([]);
    }
  });

  it("preserves distinct repository conflicts when a draft or confirmed revision wins the late race", async () => {
    const draftDb = new FakeExecutor();
    draftDb.enqueue(
      [{ id: ids.project, created_by: ids.actor }],
      [draftRow],
    );
    await expect(
      new TopicModelsRepository(
        draftDb as never,
      ).materializeSystemConfirmedFirstRevision(scope, generatedInput),
    ).rejects.toMatchObject({
      name: "TopicModelConflictError",
      code: "DRAFT_EXISTS",
      expectedRevision: 0,
      currentRevision: 2,
    });
    expect(draftDb.all("insert")).toHaveLength(0);

    const confirmedDb = new FakeExecutor();
    confirmedDb.enqueue(
      [{ id: ids.project, created_by: ids.actor }],
      [],
      [{ ...draftRow, revision: 4, status: "confirmed" }],
    );
    await expect(
      new TopicModelsRepository(
        confirmedDb as never,
      ).materializeSystemConfirmedFirstRevision(scope, generatedInput),
    ).rejects.toMatchObject({
      name: "TopicModelConflictError",
      code: "MODEL_REVISION_CONFLICT",
      expectedRevision: 0,
      currentRevision: 4,
    });
    expect(confirmedDb.all("insert")).toHaveLength(0);
  });

  it("projects exact system provenance while conservatively deriving more unassigned groups than the model declared", async () => {
    const systemRow = {
      ...draftRow,
      revision: 1,
      edit_revision: 1,
      status: "confirmed",
      generation_basis: exactSystemGenerationBasis,
      content_hash: "e".repeat(64),
      confirmed_by: null,
      confirmed_at: "2026-08-09T09:00:00.000Z",
    } as const;
    const systemRoot = {
      ...rootRow,
      topic_model_revision: 1,
    } as const;
    const lineage = {
      generation_run_id: ids.generationRun,
      analysis_refresh_run_id: ids.analysisRefreshRun,
      generation_version: "topic-model-generation.v1",
      prompt_set_version: "topic-model.prompt.v1",
      input_manifest: exactGenerationManifest,
      input_hash: exactGenerationInputHash,
      prompt_input_hash: "d".repeat(64),
      result_topic_model_revision_id: ids.model,
      generation_created_at: "2026-08-09T08:30:00.000Z",
      run_kind: "topic_model_generation",
      run_status: "completed",
      run_progress: exactOutcomeProgress,
      run_last_error_code: null,
      run_last_error_summary: null,
      run_result_type: "topic_model_generation_run",
      run_result_id: ids.generationRun,
      run_completed_at: "2026-08-09T09:00:00.000Z",
      invocation_id: ids.invocation,
      invocation_async_run_id: ids.generationRun,
      invocation_task: "topic_model_generation",
      invocation_prompt_set_version: "topic-model.prompt.v1",
      invocation_input_hash: "d".repeat(64),
      invocation_output_hash: "f".repeat(64),
      invocation_status: "succeeded",
      invocation_error_code: null,
      invocation_created_at: "2026-08-09T08:59:00.000Z",
      attempt_generation_run_id: ids.generationRun,
      attempt_planned_invocation_id: ids.invocation,
      attempt_invocation_id: ids.invocation,
      attempt_status: "succeeded",
      attempt_prompt_set_version: "topic-model.prompt.v1",
      attempt_input_hash: "d".repeat(64),
    } as const;
    const exactDecisions = [
      {
        keyword_entity_id: ids.keywordOne,
        governance_revision: 1,
        decision_origin: "system_suggestion",
        status: "approved",
        intent: "commercial",
        topic_node_id: ids.root,
        topic_model_revision: 1,
        review_state: "confirmed",
        assignment_invalidated_by: null,
        analysis_invocation_id: null,
        decided_by: null,
        reason:
          "topic-model-generation.v1 assigned this keyword to the first system-confirmed Topic Model.",
      },
      {
        keyword_entity_id: ids.keywordTwo,
        governance_revision: 2,
        decision_origin: "system_suggestion",
        status: "approved",
        intent: "informational",
        topic_node_id: ids.root,
        topic_model_revision: 1,
        review_state: "confirmed",
        assignment_invalidated_by: null,
        analysis_invocation_id: ids.invocation,
        decided_by: null,
        reason:
          "topic-model-generation.v1 assigned this keyword to the first system-confirmed Topic Model.",
      },
    ] as const;
    const db = new FakeExecutor();
    db.enqueue(
      [systemRow],
      [systemRoot],
      [],
      [],
      [lineage],
      exactDecisions,
    );
    expect(exactOutcomeProgress.unassignedGroupCount).toBe(0);
    await expect(
      new TopicModelsRepository(db as never).getLatestConfirmed(scope),
    ).resolves.toMatchObject({
      state: "confirmed",
      confirmedBy: null,
      confirmationMode: "system_auto",
      generationSummary: {
        ...exactSystemGenerationBasis,
        generatedAt: "2026-08-09T08:59:00.000Z",
        assignedCount: 2,
        unassignedGroupCount: 1,
        skippedCount: 1,
        limitations: [
          "keyword_assignments_skipped",
          "topic_groups_unassigned",
        ],
      },
    });

    for (const generation_basis of [
      { ...systemGenerationBasis, extra: true },
      { ...systemGenerationBasis, analysisInvocationId: null },
      { ...systemGenerationBasis, origin: "migration_baseline" },
    ]) {
      const malformedDb = new FakeExecutor();
      malformedDb.enqueue(
        [{ ...systemRow, generation_basis }],
        [systemRoot],
        [],
        [],
      );
      await expect(
        new TopicModelsRepository(
          malformedDb as never,
        ).getLatestConfirmed(scope),
      ).rejects.toBeInstanceOf(TopicModelIntegrityError);
    }
  });

  it("fails closed when durable outcome progress claims more assignments than exact decisions", async () => {
    const systemRow = {
      ...draftRow,
      revision: 1,
      edit_revision: 1,
      status: "confirmed",
      generation_basis: exactSystemGenerationBasis,
      content_hash: "e".repeat(64),
      confirmed_by: null,
      confirmed_at: "2026-08-09T09:00:00.000Z",
    } as const;
    const systemRoot = { ...rootRow, topic_model_revision: 1 } as const;
    const forgedProgress = {
      ...exactOutcomeProgress,
      assignedCount: 3,
      skippedCount: 0,
      skipReasons: {
        ...exactOutcomeProgress.skipReasons,
        intent_unavailable: 0,
      },
      limitations: [],
    } as const;
    const db = new FakeExecutor();
    db.enqueue(
      [systemRow],
      [systemRoot],
      [],
      [],
      [
        {
          generation_run_id: ids.generationRun,
          analysis_refresh_run_id: ids.analysisRefreshRun,
          generation_version: "topic-model-generation.v1",
          prompt_set_version: "topic-model.prompt.v1",
          input_manifest: exactGenerationManifest,
          input_hash: exactGenerationInputHash,
          prompt_input_hash: "d".repeat(64),
          result_topic_model_revision_id: ids.model,
          generation_created_at: "2026-08-09T08:30:00.000Z",
          run_kind: "topic_model_generation",
          run_status: "completed",
          run_progress: forgedProgress,
          run_last_error_code: null,
          run_last_error_summary: null,
          run_result_type: "topic_model_generation_run",
          run_result_id: ids.generationRun,
          run_completed_at: "2026-08-09T09:00:00.000Z",
          invocation_id: ids.invocation,
          invocation_async_run_id: ids.generationRun,
          invocation_task: "topic_model_generation",
          invocation_prompt_set_version: "topic-model.prompt.v1",
          invocation_input_hash: "d".repeat(64),
          invocation_output_hash: "f".repeat(64),
          invocation_status: "succeeded",
          invocation_error_code: null,
          invocation_created_at: "2026-08-09T08:59:00.000Z",
          attempt_generation_run_id: ids.generationRun,
          attempt_planned_invocation_id: ids.invocation,
          attempt_invocation_id: ids.invocation,
          attempt_status: "succeeded",
          attempt_prompt_set_version: "topic-model.prompt.v1",
          attempt_input_hash: "d".repeat(64),
        },
      ],
      [],
    );

    await expect(
      new TopicModelsRepository(db as never).getLatestConfirmed(scope),
    ).rejects.toMatchObject({
      name: "TopicModelIntegrityError",
    });
  });

  it("projects only exact manual and migration confirmation provenance", async () => {
    const manualBasis = {
      origin: "draft_from_latest_confirmed",
      baseTopicModelRevision: 1,
      reason: "Start the next manually reviewed Topic revision.",
    } as const;
    const manualDb = new FakeExecutor();
    manualDb.enqueue(
      [
        {
          ...draftRow,
          status: "confirmed",
          generation_basis: manualBasis,
          content_hash: "a".repeat(64),
          confirmed_by: ids.actor,
          confirmed_at: "2026-07-28T03:00:00.000Z",
        },
      ],
      [rootRow],
      [],
      [],
    );
    await expect(
      new TopicModelsRepository(manualDb as never).getLatestConfirmed(scope),
    ).resolves.toMatchObject({
      confirmationMode: "user",
      confirmedBy: ids.actor,
      generationSummary: null,
    });

    const legacyDb = new FakeExecutor();
    legacyDb.enqueue(
      [
        {
          ...draftRow,
          revision: 1,
          status: "confirmed",
          generation_basis: {
            origin: "migration_baseline",
            source: "reviewed keyword_entities.cluster_key",
            projectionVersion: "topic-model.1.0.0",
            contentHashMethod:
              "postgres-jsonb-sha256.migration-baseline.v1",
            earlierHistoryAvailable: false,
          },
          content_hash: "b".repeat(64),
          confirmed_by: ids.actor,
          confirmed_at: "2026-07-28T03:00:00.000Z",
        },
      ],
      [{ ...rootRow, topic_model_revision: 1 }],
      [],
      [],
    );
    await expect(
      new TopicModelsRepository(legacyDb as never).getLatestConfirmed(scope),
    ).resolves.toMatchObject({
      confirmationMode: "legacy",
      confirmedBy: ids.actor,
      generationSummary: null,
    });
  });

  it("fails closed instead of calling unknown or malformed confirmation bases user-authored", async () => {
    const exactManualBasis = {
      origin: "draft_from_latest_confirmed",
      baseTopicModelRevision: 1,
      reason: "Start the next manually reviewed Topic revision.",
    } as const;
    for (const generation_basis of [
      {},
      { origin: "unknown_historical_writer" },
      { ...exactManualBasis, extra: true },
      { ...exactManualBasis, baseTopicModelRevision: null },
      { ...exactManualBasis, reason: " padded provenance " },
      systemGenerationBasis,
    ]) {
      const db = new FakeExecutor();
      db.enqueue(
        [
          {
            ...draftRow,
            status: "confirmed",
            generation_basis,
            content_hash: "a".repeat(64),
            confirmed_by: ids.actor,
            confirmed_at: "2026-07-28T03:00:00.000Z",
          },
        ],
        [rootRow],
        [],
        [],
      );

      await expect(
        new TopicModelsRepository(db as never).getLatestConfirmed(scope),
      ).rejects.toMatchObject({
        name: "TopicModelIntegrityError",
        code: "CONFIRMATION_PROVENANCE_INVALID",
      });
    }
  });

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
      generation_basis: {
        origin: "draft_from_latest_confirmed",
        baseTopicModelRevision: null,
        reason: "Start the first manually reviewed Topic revision.",
      },
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
      analysis_invocation_id: null,
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
