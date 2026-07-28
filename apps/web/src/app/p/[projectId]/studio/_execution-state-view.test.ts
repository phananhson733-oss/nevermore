import { describe, expect, it } from "vitest";

import type {
  ActionExecutionStateEvent,
  ActionExecutionStateTimeline,
} from "@sf/contracts";
import {
  buildExecutionQueueStateView,
  buildExecutionStateView,
} from "./_execution-state-view.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000041";
const ACTION_ID = "00000000-0000-4000-8000-000000000042";
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000043";
const ACTOR_ID = "00000000-0000-4000-8000-000000000044";
const EVENT_ID = "00000000-0000-4000-8000-000000000045";

function event(
  overrides: Partial<ActionExecutionStateEvent>,
): ActionExecutionStateEvent {
  return {
    eventId: EVENT_ID,
    projectId: PROJECT_ID,
    actionId: ACTION_ID,
    artifactId: ARTIFACT_ID,
    state: "in_progress",
    phase: "technical_fix",
    nextStep: "Deploy the reviewed patch",
    blocker: null,
    progress: null,
    expectedRevision: 0,
    revision: 1,
    transitionKind: "state_transition",
    idempotencyKey: "execution-state-view-test",
    actorId: ACTOR_ID,
    occurredAt: "2026-07-28T02:00:00.000Z",
    ...overrides,
  } as ActionExecutionStateEvent;
}

function timeline(
  current: ActionExecutionStateEvent | null,
): ActionExecutionStateTimeline {
  return {
    actionId: ACTION_ID,
    artifactId: ARTIFACT_ID,
    current,
    history: current === null ? [] : [current],
  };
}

describe("buildExecutionStateView", () => {
  it("shows a truthful empty state without deriving the legacy Action status", () => {
    expect(buildExecutionStateView(timeline(null))).toEqual({
      kind: "empty",
      historyCount: 0,
    });
  });

  it("does not fabricate numeric progress when no step definition exists", () => {
    const view = buildExecutionStateView(timeline(event({})));

    expect(view).toMatchObject({
      kind: "in_progress",
      phase: "technical_fix",
      phaseKey: "technicalFix",
      nextStep: "Deploy the reviewed patch",
      progress: null,
    });
    expect(view).not.toHaveProperty("percentage");
  });

  it("keeps an unknown customer-authored phase readable without mis-translating it", () => {
    expect(
      buildExecutionStateView(
        timeline(event({ phase: "客户复核第二轮" })),
      ),
    ).toMatchObject({
      phase: "客户复核第二轮",
      phaseKey: null,
    });
  });

  it("localizes the persisted waiting-for-approval phase instead of exposing a snake_case fallback", () => {
    expect(
      buildExecutionStateView(
        timeline(event({ phase: "waiting_for_approval" })),
      ),
    ).toMatchObject({
      phase: "waiting_for_approval",
      phaseKey: "waitingForApproval",
    });
  });

  it("uses only persisted step counts when real progress exists", () => {
    const view = buildExecutionStateView(
      timeline(
        event({
          progress: {
            stepDefinitionId: "00000000-0000-4000-8000-000000000046",
            stepDefinitionVersion: 2,
            completedSteps: 3,
            totalSteps: 7,
          },
        }),
      ),
    );

    expect(view).toMatchObject({
      kind: "in_progress",
      progress: { completedSteps: 3, totalSteps: 7 },
    });
    expect(view).not.toHaveProperty("percentage");
  });

  it("surfaces the persisted blocker and unlock condition", () => {
    const blocked = event({
      state: "blocked",
      blocker: {
        code: "approval.missing",
        summary: "发布前仍需客户确认。",
        unlockCondition: "客户批准当前 Revision。",
        ownerId: ACTOR_ID,
        sourceKind: "approval",
        sourceRef: null,
        observedAt: "2026-07-28T02:00:00.000Z",
        freshness: "current",
      },
      progress: null,
    });

    expect(buildExecutionStateView(timeline(blocked))).toMatchObject({
      kind: "blocked",
      blockerSummary: "发布前仍需客户确认。",
      unlockCondition: "客户批准当前 Revision。",
    });
  });

  it("marks completion without inventing a next step", () => {
    const completed = event({
      state: "completed",
      phase: "delivered",
      nextStep: null,
      blocker: null,
      progress: null,
    });

    expect(buildExecutionStateView(timeline(completed))).toMatchObject({
      kind: "completed",
      nextStep: null,
    });
  });

  it("projects only immutable current facts into the always-visible queue summary", () => {
    const blocked = event({
      state: "blocked",
      blocker: {
        code: "approval.missing",
        summary: "发布前仍需客户确认。",
        unlockCondition: "客户批准当前 Revision。",
        ownerId: ACTOR_ID,
        sourceKind: "approval",
        sourceRef: null,
        observedAt: "2026-07-28T02:00:00.000Z",
        freshness: "current",
      },
      progress: null,
    });
    const progressing = event({
      progress: {
        stepDefinitionId: "00000000-0000-4000-8000-000000000046",
        stepDefinitionVersion: 2,
        completedSteps: 3,
        totalSteps: 7,
      },
    });

    expect(buildExecutionQueueStateView(null)).toEqual({ kind: "empty" });
    expect(buildExecutionQueueStateView(blocked)).toEqual({
      kind: "blocked",
      blockerSummary: "发布前仍需客户确认。",
      unlockCondition: "客户批准当前 Revision。",
    });
    expect(buildExecutionQueueStateView(progressing)).toEqual({
      kind: "in_progress",
      progress: { completedSteps: 3, totalSteps: 7 },
    });
    expect(
      buildExecutionQueueStateView(
        event({
          state: "completed",
          phase: "completed",
          nextStep: null,
          blocker: null,
          progress: null,
        }),
      ),
    ).toEqual({ kind: "completed" });
  });
});
