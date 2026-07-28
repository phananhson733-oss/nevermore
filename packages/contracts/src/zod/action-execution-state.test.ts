import { describe, expect, it } from "vitest";
import {
  ActionExecutionProgress,
  ActionExecutionStateBatch,
  ActionExecutionState,
  ActionExecutionStateEvent,
  ActionExecutionStateTimeline,
  ActionStepDefinition,
  MAX_INCREMENTABLE_ACTION_EXECUTION_REVISION,
  RecordActionExecutionStateRequest,
  RecordActionExecutionStateResult,
  UpdateActionExecutionStateRequest,
} from "./action-execution-state.ts";

const ids = {
  event: "a1000000-0000-4000-8000-000000000001",
  project: "a1000000-0000-4000-8000-000000000002",
  action: "a1000000-0000-4000-8000-000000000003",
  artifact: "a1000000-0000-4000-8000-000000000004",
  actor: "a1000000-0000-4000-8000-000000000005",
  definition: "a1000000-0000-4000-8000-000000000006",
} as const;

const progress = {
  stepDefinitionId: ids.definition,
  stepDefinitionVersion: 3,
  completedSteps: 2,
  totalSteps: 5,
} as const;

const inProgressCommand = {
  actionId: ids.action,
  artifactId: ids.artifact,
  state: "in_progress",
  phase: "implementation",
  nextStep: "提交并审核代码修复。",
  blocker: null,
  progress,
  expectedRevision: 4,
  idempotencyKey: "action-execution-progress-1",
} as const;

describe("Action Execution State contract", () => {
  it("admits only the append-only lifecycle states", () => {
    expect(ActionExecutionState.options).toEqual([
      "blocked",
      "in_progress",
      "completed",
    ]);
    expect(ActionExecutionState.safeParse("ready").success).toBe(false);
    expect(ActionExecutionState.safeParse("done").success).toBe(false);
  });

  it("accepts only exact versioned numeric progress", () => {
    expect(ActionExecutionProgress.parse(progress)).toEqual(progress);
    expect(
      ActionExecutionProgress.safeParse({
        stepDefinitionId: ids.definition,
        completedSteps: 2,
        totalSteps: 5,
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionProgress.safeParse({
        ...progress,
        completedSteps: 6,
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionProgress.safeParse({
        ...progress,
        totalSteps: 0,
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionProgress.safeParse({
        ...progress,
        estimatedPercent: 40,
      }).success,
    ).toBe(false);
  });

  it("requires a readable blocker summary and explicit unlock condition", () => {
    const command = {
      ...inProgressCommand,
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
        observedAt: "2026-07-28T02:00:00Z",
        freshness: "current",
      },
      progress: null,
      expectedRevision: 0,
      idempotencyKey: "action-execution-blocked-1",
    } as const;

    expect(RecordActionExecutionStateRequest.parse(command)).toEqual(command);
    for (const observedAt of [
      "2026-02-30T02:00:00Z",
      "2026-07-28T02:00:00.1234567Z",
    ]) {
      expect(
        RecordActionExecutionStateRequest.safeParse({
          ...command,
          blocker: { ...command.blocker, observedAt },
        }).success,
      ).toBe(false);
    }
    for (const invalid of [
      {
        ...command,
        blocker: { ...command.blocker, summary: "   " },
      },
      {
        ...command,
        blocker: { ...command.blocker, unlockCondition: "\n\t" },
      },
      { ...command, blocker: null },
      { ...command, progress },
    ]) {
      expect(
        RecordActionExecutionStateRequest.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("allows in-progress state with null or exact versioned progress", () => {
    expect(RecordActionExecutionStateRequest.parse(inProgressCommand)).toEqual(
      inProgressCommand,
    );
    expect(
      RecordActionExecutionStateRequest.safeParse({
        ...inProgressCommand,
        progress: null,
      }).success,
    ).toBe(true);
    expect(
      RecordActionExecutionStateRequest.safeParse({
        ...inProgressCommand,
        progress: {
          stepDefinitionId: ids.definition,
          completedSteps: 3,
          totalSteps: 6,
        },
      }).success,
    ).toBe(false);
    expect(
      RecordActionExecutionStateRequest.safeParse({
        ...inProgressCommand,
        blocker: {
          code: "dependency",
          summary: "等待依赖。",
          unlockCondition: "依赖完成。",
          ownerId: null,
          sourceKind: "dependency",
          sourceRef: null,
          observedAt: "2026-07-28T02:00:00Z",
          freshness: "unknown",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps completed commands terminal and forbids progress or next step", () => {
    const command = {
      ...inProgressCommand,
      state: "completed",
      phase: "completed",
      nextStep: null,
      blocker: null,
      progress: null,
      expectedRevision: 5,
      idempotencyKey: "action-execution-completed-1",
    } as const;

    expect(RecordActionExecutionStateRequest.parse(command)).toEqual(command);
    expect(
      RecordActionExecutionStateRequest.safeParse({
        ...command,
        progress: { ...progress, completedSteps: 5 },
      }).success,
    ).toBe(false);
    expect(
      RecordActionExecutionStateRequest.safeParse({
        ...command,
        nextStep: "再运行一次。",
      }).success,
    ).toBe(false);
  });

  it("requires exact bounded idempotency and CAS inputs", () => {
    const command = {
      ...inProgressCommand,
      expectedRevision: MAX_INCREMENTABLE_ACTION_EXECUTION_REVISION,
    } as const;

    expect(RecordActionExecutionStateRequest.safeParse(command).success).toBe(
      true,
    );
    for (const invalid of [
      {
        ...command,
        expectedRevision:
          MAX_INCREMENTABLE_ACTION_EXECUTION_REVISION + 1,
      },
      { ...command, expectedRevision: -1 },
      { ...command, expectedRevision: 1.5 },
      { ...command, idempotencyKey: "" },
      { ...command, idempotencyKey: "line\nbreak" },
      { ...command, idempotencyKey: "x".repeat(129) },
    ]) {
      expect(
        RecordActionExecutionStateRequest.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("keeps event identity, actor, occurrence time, and revision server-owned", () => {
    for (const owned of [
      { eventId: ids.event },
      { projectId: ids.project },
      { revision: 5 },
      { transitionKind: "state_transition" },
      { actorId: ids.actor },
      { occurredAt: "2026-07-28T02:00:00Z" },
    ]) {
      expect(
        RecordActionExecutionStateRequest.safeParse({
          ...inProgressCommand,
          ...owned,
        }).success,
      ).toBe(false);
    }
  });

  it("requires exact server event facts and returns replay outside the event", () => {
    const event = {
      ...inProgressCommand,
      eventId: ids.event,
      projectId: ids.project,
      revision: 5,
      transitionKind: "state_transition",
      actorId: ids.actor,
      occurredAt: "2026-07-28T02:00:00Z",
    } as const;

    expect(ActionExecutionStateEvent.parse(event)).toEqual(event);
    expect(
      RecordActionExecutionStateResult.parse({
        event,
        replayed: false,
      }),
    ).toEqual({ event, replayed: false });
    expect(
      ActionExecutionStateEvent.safeParse({
        ...event,
        revision: 0,
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionStateEvent.safeParse({
        ...event,
        actorId: undefined,
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionStateEvent.safeParse({
        ...event,
        occurredAt: "2026-07-28T10:00:00+08:00",
      }).success,
    ).toBe(false);
  });

  it("defines immutable, ordered, content-addressed business steps", () => {
    const definition = {
      id: ids.definition,
      projectId: ids.project,
      actionId: ids.action,
      artifactId: ids.artifact,
      key: "technical_fix.v1",
      version: 3,
      steps: [
        { key: "prepare", label: "准备修复" },
        { key: "review", label: "审核修复" },
      ],
      hash: "a".repeat(64),
      createdBy: ids.actor,
      createdAt: "2026-07-28T02:00:00Z",
    } as const;

    expect(ActionStepDefinition.parse(definition)).toEqual(definition);
    expect(
      ActionStepDefinition.safeParse({
        ...definition,
        steps: [
          { key: "prepare", label: "准备修复" },
          { key: "prepare", label: "重复步骤" },
        ],
      }).success,
    ).toBe(false);
    expect(
      ActionStepDefinition.safeParse({
        ...definition,
        hash: "not-a-hash",
      }).success,
    ).toBe(false);
  });

  it("keeps path scope, evidence authority, actor, time, and idempotency server-owned on the public update", () => {
    const request = {
      state: "blocked",
      phase: "waiting_for_review",
      nextStep: "补充审核结论。",
      blocker: {
        code: "review_required",
        summary: "当前交付物等待客户审核。",
        unlockCondition: "审核并确认当前版本。",
      },
      progress: null,
      expectedRevision: 2,
    } as const;
    expect(UpdateActionExecutionStateRequest.parse(request)).toEqual(request);

    for (const extra of [
      { actionId: ids.action },
      { artifactId: ids.artifact },
      { idempotencyKey: "browser-authored-key" },
      { actorId: ids.actor },
      { occurredAt: "2026-07-28T02:00:00.000Z" },
      { sourceKind: "manual" },
      { sourceRef: "browser:claim" },
      { observedAt: "2026-07-28T02:00:00.000Z" },
      { freshness: "current" },
      { ownerId: ids.actor },
    ]) {
      expect(
        UpdateActionExecutionStateRequest.safeParse({
          ...request,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("returns one exact Action- or Artifact-level execution history without implicit aggregation", () => {
    const event = ActionExecutionStateEvent.parse({
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
      idempotencyKey: "execution-timeline-1",
      actorId: ids.actor,
      occurredAt: "2026-07-28T02:00:00.000Z",
    });
    const timeline = {
      actionId: ids.action,
      artifactId: ids.artifact,
      current: event,
      history: [event],
    };
    expect(ActionExecutionStateTimeline.parse(timeline)).toEqual(timeline);
    expect(
      ActionExecutionStateTimeline.safeParse({
        actionId: ids.action,
        artifactId: null,
        current: null,
        history: [],
      }).success,
    ).toBe(true);
    expect(
      ActionExecutionStateTimeline.safeParse({
        ...timeline,
        artifactId: null,
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionStateTimeline.safeParse({
        ...timeline,
        current: null,
      }).success,
    ).toBe(false);
  });

  it("returns a bounded exact current-state batch for Artifact queue cards", () => {
    const event = ActionExecutionStateEvent.parse({
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
      idempotencyKey: "execution-batch-1",
      actorId: ids.actor,
      occurredAt: "2026-07-28T02:00:00.000Z",
    });
    const batch = {
      projectId: ids.project,
      items: [
        {
          actionId: ids.action,
          artifactId: ids.artifact,
          current: event,
        },
      ],
    };

    expect(ActionExecutionStateBatch.parse(batch)).toEqual(batch);
    expect(
      ActionExecutionStateBatch.safeParse({
        ...batch,
        items: [{ ...batch.items[0], current: null }],
      }).success,
    ).toBe(true);
    expect(
      ActionExecutionStateBatch.safeParse({
        ...batch,
        items: [batch.items[0], batch.items[0]],
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionStateBatch.safeParse({
        ...batch,
        items: [
          {
            ...batch.items[0],
            current: { ...event, artifactId: null },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ActionExecutionStateBatch.safeParse({
        ...batch,
        items: [
          {
            ...batch.items[0],
            current: {
              ...event,
              actionId: "a1000000-0000-4000-8000-000000000099",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
