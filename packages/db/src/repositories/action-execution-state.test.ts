import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  ActionExecutionStateConflictError,
  ActionExecutionStateIntegrityError,
  ActionExecutionStateRepository,
  actionExecutionStateRequestHash,
  actionStepDefinitionRequestHash,
  type ActionExecutionStateClock,
} from "./action-execution-state.ts";
import { contentHash } from "../hash.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

class FakeFailure {
  constructor(readonly error: unknown) {}
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
    const result = this.results.length > 0 ? this.results.shift() : [];
    if (result instanceof FakeFailure) {
      return Promise.reject(result.error);
    }
    return result;
  }

  select(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "select", args });
    return new FakeQuery(this);
  }

  selectDistinctOn(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "selectDistinctOn", args });
    return new FakeQuery(this);
  }

  insert(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "insert", args });
    return new FakeQuery(this);
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
  workspace: "a2000000-0000-4000-8000-000000000001",
  project: "a2000000-0000-4000-8000-000000000002",
  action: "a2000000-0000-4000-8000-000000000003",
  artifact: "a2000000-0000-4000-8000-000000000004",
  actor: "a2000000-0000-4000-8000-000000000005",
  event: "a2000000-0000-4000-8000-000000000006",
  definition: "a2000000-0000-4000-8000-000000000007",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const occurredAt = "2026-07-28T03:00:00.000Z";
const clock: ActionExecutionStateClock = {
  newId: () => ids.event,
  now: () => occurredAt,
};

const action = {
  id: ids.action,
  workspace_id: ids.workspace,
  project_id: ids.project,
  status: "planned",
  revision: 3,
};
const artifact = {
  id: ids.artifact,
  workspace_id: ids.workspace,
  project_id: ids.project,
  action_id: ids.action,
  status: "draft",
};

const blockedRequest = {
  actionId: ids.action,
  artifactId: null,
  state: "blocked",
  phase: "waiting_for_authorization",
  nextStep: "连接 GitHub。",
  blocker: {
    code: "github_authorization_required",
    summary: "GitHub 发布目标尚未完成授权。",
    unlockCondition: "连接 GitHub 并选择允许创建 PR 的仓库。",
    ownerId: null,
    sourceKind: "provider_readiness",
    sourceRef: "github:delivery-connection",
    observedAt: "2026-07-28T02:55:00.000Z",
    freshness: "current",
  },
  progress: null,
  expectedRevision: 0,
  idempotencyKey: "action-execution-blocked-1",
} as const;

const blockedRow = {
  id: ids.event,
  workspace_id: ids.workspace,
  project_id: ids.project,
  action_id: ids.action,
  artifact_id: null,
  revision: 1,
  expected_revision: 0,
  state: "blocked",
  transition_kind: "state_transition",
  phase: blockedRequest.phase,
  next_step: blockedRequest.nextStep,
  blocker_code: blockedRequest.blocker.code,
  blocker_summary: blockedRequest.blocker.summary,
  unlock_condition: blockedRequest.blocker.unlockCondition,
  blocker_owner_id: null,
  blocker_source_kind: blockedRequest.blocker.sourceKind,
  blocker_source_ref: blockedRequest.blocker.sourceRef,
  blocker_observed_at: blockedRequest.blocker.observedAt,
  blocker_freshness: blockedRequest.blocker.freshness,
  step_definition_id: null,
  step_definition_version: null,
  completed_steps: null,
  total_steps: null,
  idempotency_key: blockedRequest.idempotencyKey,
  request_hash: actionExecutionStateRequestHash(
    scope,
    ids.actor,
    blockedRequest,
  ),
  actor_id: ids.actor,
  occurred_at: occurredAt,
  created_at: occurredAt,
};

function validDefinitionRow(
  steps: readonly { readonly key: string; readonly label: string }[],
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const input = {
    actionId: ids.action,
    artifactId: ids.artifact,
    key: "code_patch.v1",
    version: 2,
    steps,
    idempotencyKey: "definition-code-patch-v2",
  } as const;
  return {
    id: ids.definition,
    workspace_id: ids.workspace,
    project_id: ids.project,
    action_id: ids.action,
    artifact_id: ids.artifact,
    definition_key: input.key,
    definition_version: input.version,
    steps,
    step_count: steps.length,
    definition_hash: contentHash({
      authority: "action-step-definition.v1",
      workspaceId: ids.workspace,
      projectId: ids.project,
      actionId: input.actionId,
      artifactId: input.artifactId,
      key: input.key,
      version: input.version,
      steps,
    }),
    idempotency_key: input.idempotencyKey,
    request_hash: actionStepDefinitionRequestHash(
      scope,
      ids.actor,
      input,
    ),
    created_by: ids.actor,
    created_at: occurredAt,
    ...overrides,
  };
}

function repository(db = new FakeExecutor()) {
  return {
    db,
    repo: new ActionExecutionStateRepository(db as never, clock),
  };
}

function compiled(call: RecordedCall) {
  return new PgDialect().sqlToQuery(call.args[0] as never);
}

describe("ActionExecutionStateRepository", () => {
  it("appends a server-authored blocked event under the project writer lock", async () => {
    const { db, repo } = repository();
    db.enqueue([], [], [action], [], [blockedRow]);

    await expect(
      repo.append(scope, ids.actor, blockedRequest),
    ).resolves.toEqual({
      event: expect.objectContaining({
        eventId: ids.event,
        projectId: ids.project,
        actionId: ids.action,
        revision: 1,
        state: "blocked",
        actorId: ids.actor,
        occurredAt,
        blocker: expect.objectContaining({
          summary: blockedRequest.blocker.summary,
          unlockCondition: blockedRequest.blocker.unlockCondition,
        }),
      }),
      replayed: false,
    });

    expect(db.all("transaction")).toHaveLength(1);
    const lock = compiled(db.last("execute"));
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.params).toContain(
      `action-execution:${ids.workspace}:${ids.project}`,
    );
    const values = db.last("values").args[0] as Record<string, unknown>;
    expect(values).toMatchObject({
      actor_id: ids.actor,
      occurred_at: occurredAt,
      revision: 1,
      expected_revision: 0,
    });
    expect(values).not.toHaveProperty("progress_percent");
  });

  it("permanently replays only the exact request and never appends twice", async () => {
    const { db, repo } = repository();
    db.enqueue([blockedRow]);

    await expect(
      repo.append(scope, ids.actor, blockedRequest),
    ).resolves.toMatchObject({
      event: { eventId: ids.event, revision: 1 },
      replayed: true,
    });

    expect(db.all("transaction")).toHaveLength(0);
    expect(db.all("insert")).toHaveLength(0);
  });

  it("canonicalizes a valid blocker observation instant before hashing and persistence", async () => {
    const nonCanonicalRequest = {
      ...blockedRequest,
      blocker: {
        ...blockedRequest.blocker,
        observedAt: "2026-07-28T02:55:00Z",
      },
      idempotencyKey: "action-execution-canonical-instant",
    } as const;
    const canonicalRow = {
      ...blockedRow,
      blocker_observed_at: "2026-07-28T02:55:00.000Z",
      idempotency_key: nonCanonicalRequest.idempotencyKey,
      request_hash: actionExecutionStateRequestHash(
        scope,
        ids.actor,
        nonCanonicalRequest,
      ),
    };
    const { db, repo } = repository();
    db.enqueue([], [], [action], [], [canonicalRow]);

    await expect(
      repo.append(scope, ids.actor, nonCanonicalRequest),
    ).resolves.toMatchObject({
      event: {
        blocker: {
          observedAt: "2026-07-28T02:55:00.000Z",
        },
      },
      replayed: false,
    });

    expect(db.last("values").args[0]).toMatchObject({
      blocker_observed_at: "2026-07-28T02:55:00.000Z",
    });
  });

  it("rejects an Idempotency-Key rebound to different facts", async () => {
    const { db, repo } = repository();
    db.enqueue([blockedRow]);

    await expect(
      repo.append(scope, ids.actor, {
        ...blockedRequest,
        phase: "different_phase",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(db.all("insert")).toHaveLength(0);
  });

  it("reports a corrupted persisted hash as integrity failure before idempotency conflict", async () => {
    const { db, repo } = repository();
    db.enqueue([{ ...blockedRow, request_hash: "f".repeat(64) }]);

    await expect(
      repo.append(scope, ids.actor, {
        ...blockedRequest,
        phase: "different_phase",
      }),
    ).rejects.toEqual(
      new ActionExecutionStateIntegrityError(
        "PERSISTED_REQUEST_HASH_INVALID",
      ),
    );
    expect(db.all("insert")).toHaveLength(0);
  });

  it("fails closed when persisted event facts diverge from their exact request hash", async () => {
    const { db, repo } = repository();
    db.enqueue([{ ...blockedRow, phase: "forged_phase" }]);

    await expect(
      repo.append(scope, ids.actor, blockedRequest),
    ).rejects.toEqual(
      new ActionExecutionStateIntegrityError(
        "PERSISTED_REQUEST_HASH_INVALID",
      ),
    );
    expect(db.all("insert")).toHaveLength(0);
  });

  it("fails CAS against the canonical current event without inserting", async () => {
    const { db, repo } = repository();
    db.enqueue([], [], [action], [blockedRow]);

    await expect(
      repo.append(scope, ids.actor, {
        ...blockedRequest,
        idempotencyKey: "action-execution-stale-cas",
      }),
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      expectedRevision: 0,
      currentRevision: 1,
    });
    expect(db.all("insert")).toHaveLength(0);
  });

  it("fails closed on a corrupted current authority row before appending a new event", async () => {
    const { db, repo } = repository();
    db.enqueue(
      [],
      [],
      [action],
      [{ ...blockedRow, request_hash: "f".repeat(64) }],
    );

    await expect(
      repo.append(scope, ids.actor, {
        ...blockedRequest,
        state: "in_progress",
        blocker: null,
        progress: null,
        expectedRevision: 1,
        idempotencyKey: "action-execution-after-corrupt-current",
      }),
    ).rejects.toEqual(
      new ActionExecutionStateIntegrityError(
        "PERSISTED_REQUEST_HASH_INVALID",
      ),
    );
    expect(db.all("insert")).toHaveLength(0);
  });

  it("accepts numeric progress only when the exact scoped Step Definition exists", async () => {
    const progressRequest = {
      actionId: ids.action,
      artifactId: ids.artifact,
      state: "in_progress",
      phase: "implementation",
      nextStep: "审核代码修复。",
      blocker: null,
      progress: {
        stepDefinitionId: ids.definition,
        stepDefinitionVersion: 2,
        completedSteps: 2,
        totalSteps: 5,
      },
      expectedRevision: 0,
      idempotencyKey: "action-execution-progress-1",
    } as const;
    const definition = validDefinitionRow([
      { key: "prepare", label: "准备修复" },
      { key: "patch", label: "生成补丁" },
      { key: "test", label: "运行测试" },
      { key: "review", label: "审核补丁" },
      { key: "publish", label: "发布变更" },
    ]);
    const eventRow = {
      ...blockedRow,
      artifact_id: ids.artifact,
      state: "in_progress",
      phase: progressRequest.phase,
      next_step: progressRequest.nextStep,
      blocker_code: null,
      blocker_summary: null,
      unlock_condition: null,
      blocker_source_kind: null,
      blocker_source_ref: null,
      blocker_observed_at: null,
      blocker_freshness: null,
      step_definition_id: ids.definition,
      step_definition_version: 2,
      completed_steps: 2,
      total_steps: 5,
      idempotency_key: progressRequest.idempotencyKey,
      request_hash: actionExecutionStateRequestHash(
        scope,
        ids.actor,
        progressRequest,
      ),
    };
    const { db, repo } = repository();
    db.enqueue(
      [],
      [],
      [action],
      [artifact],
      [],
      [definition],
      [eventRow],
    );

    await expect(
      repo.append(scope, ids.actor, progressRequest),
    ).resolves.toMatchObject({
      event: {
        state: "in_progress",
        progress: {
          stepDefinitionId: ids.definition,
          stepDefinitionVersion: 2,
          completedSteps: 2,
          totalSteps: 5,
        },
      },
      replayed: false,
    });
  });

  it("rejects a fabricated total that diverges from the Step Definition", async () => {
    const { db, repo } = repository();
    db.enqueue(
      [],
      [],
      [action],
      [artifact],
      [],
      [
        validDefinitionRow([
          { key: "prepare", label: "准备修复" },
          { key: "patch", label: "生成补丁" },
          { key: "test", label: "运行测试" },
          { key: "review", label: "审核补丁" },
          { key: "publish", label: "发布变更" },
          { key: "verify", label: "验证上线" },
        ]),
      ],
    );

    await expect(
      repo.append(scope, ids.actor, {
        actionId: ids.action,
        artifactId: ids.artifact,
        state: "in_progress",
        phase: "implementation",
        nextStep: "审核代码修复。",
        blocker: null,
        progress: {
          stepDefinitionId: ids.definition,
          stepDefinitionVersion: 2,
          completedSteps: 2,
          totalSteps: 5,
        },
        expectedRevision: 0,
        idempotencyKey: "fabricated-progress-total",
      }),
    ).rejects.toMatchObject({
      code: "STEP_DEFINITION_INVALID",
    });
    expect(db.all("insert")).toHaveLength(0);
  });

  it("fails closed on a corrupted Step Definition before it can authorize progress", async () => {
    const steps = [
      { key: "prepare", label: "准备修复" },
      { key: "patch", label: "生成补丁" },
      { key: "test", label: "运行测试" },
      { key: "review", label: "审核补丁" },
      { key: "publish", label: "发布变更" },
    ] as const;
    const { db, repo } = repository();
    db.enqueue(
      [],
      [],
      [action],
      [artifact],
      [],
      [
        validDefinitionRow(steps, {
          definition_hash: "f".repeat(64),
        }),
      ],
    );

    await expect(
      repo.append(scope, ids.actor, {
        actionId: ids.action,
        artifactId: ids.artifact,
        state: "in_progress",
        phase: "implementation",
        nextStep: "审核代码修复。",
        blocker: null,
        progress: {
          stepDefinitionId: ids.definition,
          stepDefinitionVersion: 2,
          completedSteps: 2,
          totalSteps: steps.length,
        },
        expectedRevision: 0,
        idempotencyKey: "progress-after-corrupt-definition",
      }),
    ).rejects.toEqual(
      new ActionExecutionStateIntegrityError(
        "PERSISTED_DEFINITION_HASH_INVALID",
      ),
    );
    expect(db.all("insert")).toHaveLength(0);
  });

  it("keeps completed terminal and leaves the prior events untouched", async () => {
    const completedRequest = {
      actionId: ids.action,
      artifactId: null,
      state: "completed",
      phase: "completed",
      nextStep: null,
      blocker: null,
      progress: null,
      expectedRevision: 0,
      idempotencyKey: "completed-action-authority",
    } as const;
    const { db, repo } = repository();
    db.enqueue(
      [],
      [],
      [action],
      [
        {
          ...blockedRow,
          state: "completed",
          phase: completedRequest.phase,
          next_step: null,
          blocker_code: null,
          blocker_summary: null,
          unlock_condition: null,
          blocker_owner_id: null,
          blocker_source_kind: null,
          blocker_source_ref: null,
          blocker_observed_at: null,
          blocker_freshness: null,
          idempotency_key: completedRequest.idempotencyKey,
          request_hash: actionExecutionStateRequestHash(
            scope,
            ids.actor,
            completedRequest,
          ),
        },
      ],
    );

    await expect(
      repo.append(scope, ids.actor, {
        actionId: ids.action,
        artifactId: null,
        state: "in_progress",
        phase: "reopened",
        nextStep: "不应发生。",
        blocker: null,
        progress: null,
        expectedRevision: 1,
        idempotencyKey: "reopen-completed-action",
      }),
    ).rejects.toMatchObject({
      code: "COMPLETED_TERMINAL",
    });
    expect(db.all("insert")).toHaveLength(0);
  });

  it("reads current and history through exact workspace/project/action scope", async () => {
    const { db, repo } = repository();
    db.enqueue([blockedRow], [blockedRow]);

    await expect(
      repo.findCurrent(scope, ids.action, null),
    ).resolves.toMatchObject({ eventId: ids.event });
    await expect(
      repo.listHistory(scope, ids.action, null),
    ).resolves.toHaveLength(1);

    for (const where of db.all("where")) {
      const predicate = compiled(where);
      expect(predicate.sql).toContain('"workspace_id" = $1');
      expect(predicate.sql).toContain('"project_id" = $2');
      expect(predicate.sql).toContain('"action_id" = $3');
    }
  });

  it("reads one latest immutable event per requested Artifact in a single scoped query", async () => {
    const artifactRequest = {
      ...blockedRequest,
      artifactId: ids.artifact,
      idempotencyKey: "action-execution-artifact-batch",
    };
    const artifactRow = {
      ...blockedRow,
      artifact_id: ids.artifact,
      idempotency_key: artifactRequest.idempotencyKey,
      request_hash: actionExecutionStateRequestHash(
        scope,
        ids.actor,
        artifactRequest,
      ),
    };
    const { db, repo } = repository();
    db.enqueue([artifactRow]);

    await expect(
      repo.listCurrentForArtifacts(scope, [ids.artifact]),
    ).resolves.toEqual([
      expect.objectContaining({
        artifactId: ids.artifact,
        actionId: ids.action,
        revision: 1,
      }),
    ]);

    expect(db.all("selectDistinctOn")).toHaveLength(1);
    expect(db.all("select")).toHaveLength(0);
    const predicate = compiled(db.last("where"));
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"artifact_id" is not null');
    expect(predicate.sql).toContain('"artifact_id" in');
  });

  it("exposes a typed conflict class for callers without leaking foreign rows", () => {
    const error = new ActionExecutionStateConflictError(
      "ACTION_NOT_FOUND",
    );
    expect(error.code).toBe("ACTION_NOT_FOUND");
    expect(error.message).not.toContain(ids.action);
  });

  it("classifies an unexpected database check rejection as authority integrity failure", async () => {
    const databaseError = Object.assign(
      new Error("transition classification rejected"),
      { code: "23514" },
    );
    const { db, repo } = repository();
    db.enqueue(
      [],
      [],
      [action],
      [],
      new FakeFailure(databaseError),
    );

    await expect(
      repo.append(scope, ids.actor, {
        ...blockedRequest,
        idempotencyKey: "action-execution-db-constraint",
      }),
    ).rejects.toEqual(
      new ActionExecutionStateIntegrityError(
        "DATABASE_CONSTRAINT_REJECTED",
      ),
    );
  });
});
