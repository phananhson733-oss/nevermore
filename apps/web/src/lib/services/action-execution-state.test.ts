import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionExecutionStateConflictError,
  ActionExecutionStateIntegrityError,
  ActionExecutionStateRepository,
  ActionsRepository,
  ExecutionArtifactsRepository,
  ProjectsRepository,
} from "@sf/db";

import {
  getArtifactExecutionStateBatch,
  getActionExecutionStateTimeline,
  updateActionExecutionState,
} from "./action-execution-state.ts";

const ids = {
  workspace: "b1000000-0000-4000-8000-000000000001",
  project: "b1000000-0000-4000-8000-000000000002",
  action: "b1000000-0000-4000-8000-000000000003",
  artifact: "b1000000-0000-4000-8000-000000000004",
  actor: "b1000000-0000-4000-8000-000000000005",
  event: "b1000000-0000-4000-8000-000000000006",
  artifactTwo: "b1000000-0000-4000-8000-000000000007",
  actionTwo: "b1000000-0000-4000-8000-000000000008",
} as const;

const scope = { workspaceId: ids.workspace };
const project = { id: ids.project, archived_at: null };
const action = { id: ids.action };
const artifact = {
  id: ids.artifact,
  action_id: ids.action,
};
const event = {
  eventId: ids.event,
  projectId: ids.project,
  actionId: ids.action,
  artifactId: ids.artifact,
  revision: 1,
  expectedRevision: 0,
  transitionKind: "state_transition",
  state: "in_progress",
  phase: "implementation",
  nextStep: "完成当前交付物。",
  blocker: null,
  progress: null,
  idempotencyKey: "execution-state-service-1",
  actorId: ids.actor,
  occurredAt: "2026-07-28T06:00:00.000Z",
} as const;
const exec = {} as never;

afterEach(() => {
  vi.restoreAllMocks();
});

function mockScopeRows(): void {
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
    project as never,
  );
  vi.spyOn(ActionsRepository.prototype, "findById").mockResolvedValue(
    action as never,
  );
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findById",
  ).mockResolvedValue(artifact as never);
}

describe("Action Execution State service", () => {
  it("reads all requested Artifact queue states with two bounded repository queries", async () => {
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project as never,
    );
    const artifacts = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "listByIds")
      .mockResolvedValue([
        artifact,
        { id: ids.artifactTwo, action_id: ids.actionTwo },
      ] as never);
    const current = vi
      .spyOn(
        ActionExecutionStateRepository.prototype,
        "listCurrentForArtifacts",
      )
      .mockResolvedValue([event]);

    await expect(
      getArtifactExecutionStateBatch(
        scope,
        ids.project,
        [ids.artifact, ids.artifactTwo],
        exec,
      ),
    ).resolves.toEqual({
      projectId: ids.project,
      items: [
        {
          actionId: ids.action,
          artifactId: ids.artifact,
          current: event,
        },
        {
          actionId: ids.actionTwo,
          artifactId: ids.artifactTwo,
          current: null,
        },
      ],
    });
    expect(artifacts).toHaveBeenCalledTimes(1);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("fails the whole batch closed for missing, mismatched, or duplicate authority rows", async () => {
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project as never,
    );
    const artifacts = vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "listByIds",
    );
    const current = vi.spyOn(
      ActionExecutionStateRepository.prototype,
      "listCurrentForArtifacts",
    );

    artifacts.mockResolvedValueOnce([artifact] as never);
    await expect(
      getArtifactExecutionStateBatch(
        scope,
        ids.project,
        [ids.artifact, ids.artifactTwo],
        exec,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(current).not.toHaveBeenCalled();

    artifacts.mockResolvedValue([
      artifact,
      { id: ids.artifactTwo, action_id: ids.actionTwo },
    ] as never);
    current.mockResolvedValueOnce([
      { ...event, actionId: ids.actionTwo },
    ] as never);
    await expect(
      getArtifactExecutionStateBatch(
        scope,
        ids.project,
        [ids.artifact, ids.artifactTwo],
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });

    current.mockResolvedValueOnce([event, event] as never);
    await expect(
      getArtifactExecutionStateBatch(
        scope,
        ids.project,
        [ids.artifact, ids.artifactTwo],
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("reads one exact Artifact stream and never derives it from legacy Action status", async () => {
    mockScopeRows();
    const history = vi
      .spyOn(ActionExecutionStateRepository.prototype, "listHistory")
      .mockResolvedValue([event]);

    await expect(
      getActionExecutionStateTimeline(
        scope,
        ids.project,
        ids.action,
        ids.artifact,
        exec,
      ),
    ).resolves.toEqual({
      actionId: ids.action,
      artifactId: ids.artifact,
      current: event,
      history: [event],
    });
    expect(history).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.action,
      ids.artifact,
    );
  });

  it("returns an honest empty timeline when no execution event exists", async () => {
    mockScopeRows();
    vi.spyOn(
      ActionExecutionStateRepository.prototype,
      "listHistory",
    ).mockResolvedValue([]);

    await expect(
      getActionExecutionStateTimeline(
        scope,
        ids.project,
        ids.action,
        ids.artifact,
        exec,
      ),
    ).resolves.toEqual({
      actionId: ids.action,
      artifactId: ids.artifact,
      current: null,
      history: [],
    });
  });

  it("fails closed when an Artifact does not belong to the selected Action", async () => {
    mockScopeRows();
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findById",
    ).mockResolvedValue({
      ...artifact,
      action_id: "b1000000-0000-4000-8000-000000000099",
    } as never);
    const history = vi.spyOn(
      ActionExecutionStateRepository.prototype,
      "listHistory",
    );

    await expect(
      getActionExecutionStateTimeline(
        scope,
        ids.project,
        ids.action,
        ids.artifact,
        exec,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(history).not.toHaveBeenCalled();
  });

  it("turns a public manual blocker into server-owned source, owner, time, path scope, and idempotency facts", async () => {
    mockScopeRows();
    const append = vi
      .spyOn(ActionExecutionStateRepository.prototype, "append")
      .mockResolvedValue({ event, replayed: false });
    const body = {
      state: "blocked",
      phase: "waiting_for_review",
      nextStep: "审核当前交付物。",
      blocker: {
        code: "review_required",
        summary: "当前交付物等待客户审核。",
        unlockCondition: "审核并确认当前版本。",
      },
      progress: null,
      expectedRevision: 0,
    } as const;

    await updateActionExecutionState(
      scope,
      ids.project,
      ids.action,
      ids.artifact,
      ids.actor,
      "execution-state-header-key",
      body,
      {
        exec,
        now: () => "2026-07-28T06:30:00.000Z",
      },
    );

    expect(append).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.actor,
      {
        actionId: ids.action,
        artifactId: ids.artifact,
        state: "blocked",
        phase: "waiting_for_review",
        nextStep: "审核当前交付物。",
        blocker: {
          code: "review_required",
          summary: "当前交付物等待客户审核。",
          unlockCondition: "审核并确认当前版本。",
          ownerId: ids.actor,
          sourceKind: "manual",
          sourceRef: null,
          observedAt: "2026-07-28T06:30:00.000Z",
          freshness: "current",
        },
        progress: null,
        expectedRevision: 0,
        idempotencyKey: "execution-state-header-key",
      },
    );
  });

  it("maps stale CAS, replay conflicts, terminal state, invalid progress, and integrity drift to stable problems", async () => {
    mockScopeRows();
    const append = vi.spyOn(
      ActionExecutionStateRepository.prototype,
      "append",
    );
    const body = {
      state: "in_progress",
      phase: "implementation",
      nextStep: "完成交付物。",
      blocker: null,
      progress: null,
      expectedRevision: 1,
    } as const;
    const cases = [
      [
        new ActionExecutionStateConflictError(
          "REVISION_CONFLICT",
          1,
          2,
        ),
        "VERSION_CONFLICT",
        409,
      ],
      [
        new ActionExecutionStateConflictError(
          "IDEMPOTENCY_CONFLICT",
        ),
        "IDEMPOTENCY_KEY_REUSED",
        409,
      ],
      [
        new ActionExecutionStateConflictError(
          "COMPLETED_TERMINAL",
        ),
        "ACTION_NOT_EXECUTABLE",
        422,
      ],
      [
        new ActionExecutionStateConflictError(
          "STEP_DEFINITION_INVALID",
        ),
        "VALIDATION_ERROR",
        422,
      ],
      [
        new ActionExecutionStateIntegrityError(
          "PERSISTED_REQUEST_HASH_INVALID",
        ),
        "DEPENDENCY_UNAVAILABLE",
        503,
      ],
    ] as const;

    for (const [failure, code, status] of cases) {
      append.mockRejectedValueOnce(failure);
      await expect(
        updateActionExecutionState(
          scope,
          ids.project,
          ids.action,
          ids.artifact,
          ids.actor,
          "execution-state-error-key",
          body,
          { exec },
        ),
      ).rejects.toMatchObject({ code, status });
    }
  });
});
