import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import {
  ActionExecutionStateRepository,
  type ActionExecutionStateClock,
} from "../repositories/action-execution-state.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const NOW = "2026-07-28T04:00:00.000Z";

interface ExecutionFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly actionId: string;
  readonly artifactId: string;
  readonly concurrentActionId: string;
}

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) {
      return undefined;
    }
    const wrapped = candidate as {
      readonly code?: unknown;
      readonly cause?: unknown;
    };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

function advancingClock(): ActionExecutionStateClock {
  let milliseconds = Date.parse(NOW);
  return {
    newId: randomUUID,
    now: () => {
      const value = new Date(milliseconds).toISOString();
      milliseconds += 1;
      return value;
    },
  };
}

async function createExecutionFixture(
  handle: DbHandle,
): Promise<ExecutionFixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const actionId = randomUUID();
  const artifactId = randomUUID();
  const concurrentActionId = randomUUID();
  const client = await handle.pool.connect();

  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
      [workspaceId, `Action execution ${workspaceId}`],
    );
    await client.query(
      `
        INSERT INTO app.client_projects (
          id, workspace_id, client_name, project_name,
          default_delivery_locale, created_by
        )
        VALUES ($1, $2, $3, $4, 'zh-CN', $5)
      `,
      [
        projectId,
        workspaceId,
        `Client ${projectId}`,
        `Project ${projectId}`,
        actorId,
      ],
    );
    for (const [candidateActionId, actionKey] of [
      [actionId, "b".repeat(64)],
      [concurrentActionId, "c".repeat(64)],
    ] as const) {
      await client.query(
        `
          INSERT INTO app.actions (
            id, workspace_id, project_id, source_finding_id,
            source_diagnostic_run_id, action_key,
            template_id, title, description, content_locale, priority_band,
            roadmap_lane, status, effort, risk, expected_outcome, created_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, 'execution-fixture',
            '执行中心任务', 'Fixture authority row.', 'zh-CN', 'high',
            'now', 'planned', 'small', 'low', 'Fixture only.', $7
          )
        `,
        [
          candidateActionId,
          workspaceId,
          projectId,
          randomUUID(),
          randomUUID(),
          actionKey,
          actorId,
        ],
      );
    }
    await client.query(
      `
        INSERT INTO app.execution_artifacts (
          id, workspace_id, project_id, action_id, artifact_type, status,
          generation_mode, output_locale, current_revision,
          validation_state, content_hash, created_by
        ) VALUES (
          $1, $2, $3, $4, 'technical_ticket', 'ready', 'template', 'zh-CN',
          1, 'valid', $5, $6
        )
      `,
      [
        artifactId,
        workspaceId,
        projectId,
        actionId,
        "a".repeat(64),
        actorId,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    workspaceId,
    projectId,
    actorId,
    actionId,
    artifactId,
    concurrentActionId,
  };
}

async function destroyExecutionFixture(
  handle: DbHandle,
  fixture: ExecutionFixture,
): Promise<void> {
  const client = await handle.pool.connect();
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "DELETE FROM app.action_execution_state_events WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await client.query(
      "DELETE FROM app.action_execution_step_definitions WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await client.query(
      "DELETE FROM app.execution_artifacts WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await client.query(
      "DELETE FROM app.actions WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await client.query(
      "DELETE FROM app.client_projects WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await client.query(
      "DELETE FROM app.workspaces WHERE id = $1",
      [fixture.workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describeDb("Action Execution State authority", () => {
  let handle: DbHandle;
  let fixture: ExecutionFixture;
  let repository: ActionExecutionStateRepository;

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
    fixture = await createExecutionFixture(handle);
    repository = new ActionExecutionStateRepository(
      handle.db,
      advancingClock(),
    );
  });

  afterAll(async () => {
    if (handle && fixture) {
      await destroyExecutionFixture(handle, fixture);
    }
    await handle?.end();
  });

  it("retains the blocker after unblock and completion while replaying the exact command", async () => {
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const blocked = await repository.append(scope, fixture.actorId, {
      actionId: fixture.actionId,
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
        observedAt: "2026-07-28T03:55:00.000Z",
        freshness: "current",
      },
      progress: null,
      expectedRevision: 0,
      idempotencyKey: `execution-blocked-${randomUUID()}`,
    });
    expect(blocked).toMatchObject({
      replayed: false,
      event: {
        revision: 1,
        state: "blocked",
        blocker: {
          summary: "GitHub 发布目标尚未完成授权。",
          unlockCondition: "连接 GitHub 并选择允许创建 PR 的仓库。",
        },
      },
    });

    const resumed = await repository.append(scope, fixture.actorId, {
      actionId: fixture.actionId,
      artifactId: null,
      state: "in_progress",
      phase: "implementation",
      nextStep: "生成并审核代码修复。",
      blocker: null,
      progress: null,
      expectedRevision: 1,
      idempotencyKey: `execution-resumed-${randomUUID()}`,
    });
    expect(resumed.event).toMatchObject({
      revision: 2,
      state: "in_progress",
      transitionKind: "state_transition",
      blocker: null,
    });

    const completedCommand = {
      actionId: fixture.actionId,
      artifactId: null,
      state: "completed",
      phase: "verified",
      nextStep: null,
      blocker: null,
      progress: null,
      expectedRevision: 2,
      idempotencyKey: `execution-completed-${randomUUID()}`,
    } as const;
    const completed = await repository.append(
      scope,
      fixture.actorId,
      completedCommand,
    );
    const replay = await repository.append(
      scope,
      fixture.actorId,
      completedCommand,
    );
    expect(completed).toMatchObject({
      replayed: false,
      event: { revision: 3, state: "completed" },
    });
    expect(replay).toEqual({
      event: completed.event,
      replayed: true,
    });

    const current = await repository.findCurrent(
      scope,
      fixture.actionId,
      null,
    );
    const history = await repository.listHistory(
      scope,
      fixture.actionId,
      null,
    );
    expect(current).toEqual(completed.event);
    expect(history.map((event) => event.revision)).toEqual([1, 2, 3]);
    expect(history[0]).toMatchObject({
      state: "blocked",
      blocker: {
        summary: "GitHub 发布目标尚未完成授权。",
      },
    });

    await expect(
      handle.pool.query(
        `
          UPDATE app.action_execution_state_events
          SET phase = 'forged'
          WHERE id = $1
        `,
        [blocked.event.eventId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      handle.pool.query(
        "DELETE FROM app.action_execution_state_events WHERE id = $1",
        [blocked.event.eventId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expectPgCode(
      handle.pool.query(
        `
          INSERT INTO app.action_execution_state_events (
            id, workspace_id, project_id, action_id, artifact_id,
            revision, expected_revision, state, transition_kind,
            phase, next_step, idempotency_key, request_hash,
            actor_id, occurred_at, created_at
          ) VALUES (
            $1, $2, $3, $4, NULL,
            4, 3, 'in_progress', 'state_transition',
            'reopened', '不应重新打开。', $5, $6,
            $7, $8, $8
          )
        `,
        [
          randomUUID(),
          fixture.workspaceId,
          fixture.projectId,
          fixture.actionId,
          `raw-reopen-${randomUUID()}`,
          "d".repeat(64),
          fixture.actorId,
          NOW,
        ],
      ),
      "55000",
    );
  });

  it("accepts numeric progress only against the exact immutable Step Definition", async () => {
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const definitionCommand = {
      actionId: fixture.actionId,
      artifactId: fixture.artifactId,
      key: "technical_patch.v1",
      version: 1,
      steps: [
        { key: "prepare", label: "确认修复范围" },
        { key: "patch", label: "生成代码补丁" },
        { key: "verify", label: "运行验证" },
      ],
      idempotencyKey: `step-definition-${randomUUID()}`,
    } as const;
    const definition = await repository.registerStepDefinition(
      scope,
      fixture.actorId,
      definitionCommand,
    );
    expect(definition).toMatchObject({
      replayed: false,
      definition: {
        projectId: fixture.projectId,
        actionId: fixture.actionId,
        artifactId: fixture.artifactId,
        version: 1,
      },
    });
    await expect(
      repository.registerStepDefinition(
        scope,
        fixture.actorId,
        definitionCommand,
      ),
    ).resolves.toEqual({
      definition: definition.definition,
      replayed: true,
    });
    await expect(
      repository.registerStepDefinition(scope, fixture.actorId, {
        ...definitionCommand,
        steps: [
          ...definitionCommand.steps.slice(0, 2),
          { key: "verify", label: "不同的验证步骤" },
        ],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const progress = await repository.append(scope, fixture.actorId, {
      actionId: fixture.actionId,
      artifactId: fixture.artifactId,
      state: "in_progress",
      phase: "implementation",
      nextStep: "运行验证。",
      blocker: null,
      progress: {
        stepDefinitionId: definition.definition.id,
        stepDefinitionVersion: 1,
        completedSteps: 2,
        totalSteps: 3,
      },
      expectedRevision: 0,
      idempotencyKey: `execution-progress-${randomUUID()}`,
    });
    expect(progress.event).toMatchObject({
      state: "in_progress",
      progress: {
        completedSteps: 2,
        totalSteps: 3,
      },
    });
    await expect(
      repository.listCurrentForArtifacts(scope, [fixture.artifactId]),
    ).resolves.toEqual([
      expect.objectContaining({
        eventId: progress.event.eventId,
        actionId: fixture.actionId,
        artifactId: fixture.artifactId,
        revision: 1,
      }),
    ]);

    await expect(
      repository.append(scope, fixture.actorId, {
        actionId: fixture.actionId,
        artifactId: fixture.artifactId,
        state: "in_progress",
        phase: "implementation",
        nextStep: "不应接受伪造总数。",
        blocker: null,
        progress: {
          stepDefinitionId: definition.definition.id,
          stepDefinitionVersion: 1,
          completedSteps: 2,
          totalSteps: 4,
        },
        expectedRevision: 1,
        idempotencyKey: `fabricated-progress-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({
      code: "STEP_DEFINITION_INVALID",
    });
    await expectPgCode(
      handle.pool.query(
        `
          INSERT INTO app.action_execution_state_events (
            id, workspace_id, project_id, action_id, artifact_id,
            revision, expected_revision, state, transition_kind,
            phase, next_step,
            step_definition_id, step_definition_version,
            completed_steps, total_steps,
            idempotency_key, request_hash,
            actor_id, occurred_at, created_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            2, 1, 'in_progress', 'state_update',
            'implementation', '不应接受伪造总数。',
            $6, 1, 2, 4,
            $7, $8, $9, $10, $10
          )
        `,
        [
          randomUUID(),
          fixture.workspaceId,
          fixture.projectId,
          fixture.actionId,
          fixture.artifactId,
          definition.definition.id,
          `raw-fabricated-progress-${randomUUID()}`,
          "e".repeat(64),
          fixture.actorId,
          NOW,
        ],
      ),
      "23514",
    );

    await expect(
      handle.pool.query(
        `
          UPDATE app.action_execution_step_definitions
          SET step_count = 4
          WHERE id = $1
        `,
        [definition.definition.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("serializes concurrent writers so one stale CAS fails without a second event", async () => {
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const command = (suffix: string) =>
      repository.append(scope, fixture.actorId, {
        actionId: fixture.concurrentActionId,
        artifactId: null,
        state: "in_progress" as const,
        phase: "implementation",
        nextStep: "继续执行。",
        blocker: null,
        progress: null,
        expectedRevision: 0,
        idempotencyKey: `concurrent-${suffix}-${randomUUID()}`,
      });
    const results = await Promise.allSettled([command("a"), command("b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: {
        code: "REVISION_CONFLICT",
        expectedRevision: 0,
        currentRevision: 1,
      },
    });
    await expect(
      repository.listHistory(scope, fixture.concurrentActionId, null),
    ).resolves.toHaveLength(1);
    await expectPgCode(
      handle.pool.query(
        `
          INSERT INTO app.action_execution_state_events (
            id, workspace_id, project_id, action_id, artifact_id,
            revision, expected_revision, state, transition_kind,
            phase, next_step, idempotency_key, request_hash,
            actor_id, occurred_at, created_at
          ) VALUES (
            $1, $2, $3, $4, NULL,
            1, 0, 'in_progress', 'state_transition',
            'implementation', '不应绕过 CAS。', $5, $6,
            $7, $8, $8
          )
        `,
        [
          randomUUID(),
          fixture.workspaceId,
          fixture.projectId,
          fixture.concurrentActionId,
          `raw-stale-cas-${randomUUID()}`,
          "f".repeat(64),
          fixture.actorId,
          NOW,
        ],
      ),
      "40001",
    );
  });

  it("fails closed for a foreign project or an Artifact outside the Action scope", async () => {
    const foreign = await createExecutionFixture(handle);
    try {
      await expect(
        repository.append(
          {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          fixture.actorId,
          {
            actionId: foreign.actionId,
            artifactId: null,
            state: "in_progress",
            phase: "implementation",
            nextStep: null,
            blocker: null,
            progress: null,
            expectedRevision: 0,
            idempotencyKey: `foreign-action-${randomUUID()}`,
          },
        ),
      ).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });

      await expect(
        repository.append(
          {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          fixture.actorId,
          {
            actionId: fixture.actionId,
            artifactId: foreign.artifactId,
            state: "in_progress",
            phase: "implementation",
            nextStep: null,
            blocker: null,
            progress: null,
            expectedRevision: 0,
            idempotencyKey: `foreign-artifact-${randomUUID()}`,
          },
        ),
      ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
    } finally {
      await destroyExecutionFixture(handle, foreign);
    }
  });
});
