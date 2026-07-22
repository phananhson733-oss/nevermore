import { describe, expect, it } from "vitest";
import {
  executionLocationUrl,
  executionHrefForRef,
  executionTargetAfterQueue,
  executionUrlWithTarget,
  parseExecutionDeepLink,
  queuedActionBlocksGeneration,
  queuedActionTargetAfterQueue,
  queuedActionTargetAfterRefresh,
  queuedActionTargetAfterTerminal,
  recoveryAttemptCanCommit,
  recoveryOwnsExecutionTarget,
  resolveActiveGenerationRecovery,
  resolveQueuedActionProjection,
  resolveExecutionDeepLink,
} from "./_execution-deep-link.ts";

const ACTION_A = "00000000-0000-4000-8000-0000000000a1";
const ACTION_B = "00000000-0000-4000-8000-0000000000b2";
const ARTIFACT_A = "00000000-0000-4000-8000-0000000000c3";
const ARTIFACT_B = "00000000-0000-4000-8000-0000000000d4";

describe("Execution deep-link parsing", () => {
  it("distinguishes an absent target from a valid bounded UUID target", () => {
    expect(parseExecutionDeepLink({})).toEqual({ kind: "none" });
    expect(parseExecutionDeepLink({ actionId: ACTION_A })).toEqual({
      kind: "target",
      actionId: ACTION_A,
      artifactId: null,
    });
    expect(
      parseExecutionDeepLink({ actionId: ACTION_A, artifactId: ARTIFACT_A }),
    ).toEqual({
      kind: "target",
      actionId: ACTION_A,
      artifactId: ARTIFACT_A,
    });
  });

  it("canonicalizes uppercase UUID input before strict projection matching", () => {
    const uppercaseActionId = ACTION_A.toUpperCase();
    const uppercaseArtifactId = ARTIFACT_A.toUpperCase();

    expect(
      parseExecutionDeepLink({
        actionId: uppercaseActionId,
        artifactId: uppercaseArtifactId,
      }),
    ).toEqual({
      kind: "target",
      actionId: ACTION_A,
      artifactId: ARTIFACT_A,
    });
  });

  it.each([
    [{ actionId: "not-a-uuid" }, ["actionId"]],
    [{ artifactId: "x".repeat(37) }, ["artifactId"]],
    [{ actionId: [ACTION_A] }, ["actionId"]],
    [
      { actionId: ACTION_A, artifactId: [ARTIFACT_A, ARTIFACT_B] },
      ["artifactId"],
    ],
  ] as const)("rejects invalid, oversized, or duplicate IDs", (raw, keys) => {
    expect(parseExecutionDeepLink(raw)).toEqual({
      kind: "invalid",
      invalidKeys: keys,
    });
  });
});

describe("Execution deep-link resolution", () => {
  const actionA = { id: ACTION_A };
  const artifactA = { id: ARTIFACT_A, actionId: ACTION_A };
  const artifactB = { id: ARTIFACT_B, actionId: ACTION_A };

  it("never treats an invalid or requested target as the default selection", () => {
    expect(
      resolveExecutionDeepLink(
        { kind: "invalid", invalidKeys: ["actionId"] },
        [],
        [],
        { artifactsComplete: true, actionsComplete: true },
      ),
    ).toEqual({ kind: "invalid" });
    expect(
      resolveExecutionDeepLink({ kind: "none" }, [], [], {
        artifactsComplete: true,
        actionsComplete: true,
      }),
    ).toEqual({ kind: "default" });
  });

  it("selects an exact artifact and rejects an action/artifact mismatch", () => {
    expect(
      resolveExecutionDeepLink(
        { kind: "target", actionId: ACTION_A, artifactId: ARTIFACT_A },
        [artifactA],
        [actionA],
        { artifactsComplete: false, actionsComplete: false },
      ),
    ).toEqual({ kind: "artifact", artifactId: ARTIFACT_A });
    expect(
      resolveExecutionDeepLink(
        { kind: "target", actionId: ACTION_B, artifactId: ARTIFACT_A },
        [artifactA],
        [actionA],
        { artifactsComplete: false, actionsComplete: false },
      ),
    ).toEqual({ kind: "not_found" });
  });

  it("waits for artifact pagination before declaring an exact artifact missing", () => {
    const target = {
      kind: "target" as const,
      actionId: null,
      artifactId: ARTIFACT_A,
    };
    expect(
      resolveExecutionDeepLink(target, [], [], {
        artifactsComplete: false,
        actionsComplete: false,
      }),
    ).toEqual({ kind: "pending", resource: "artifacts" });
    expect(
      resolveExecutionDeepLink(target, [], [], {
        artifactsComplete: true,
        actionsComplete: false,
      }),
    ).toEqual({ kind: "not_found" });
  });

  it("opens the exact action when it has no artifact", () => {
    expect(
      resolveExecutionDeepLink(
        { kind: "target", actionId: ACTION_A, artifactId: null },
        [],
        [actionA],
        { artifactsComplete: true, actionsComplete: false },
      ),
    ).toEqual({ kind: "action", actionId: ACTION_A });
  });

  it("waits for all artifacts before selecting the only matching artifact", () => {
    const target = {
      kind: "target" as const,
      actionId: ACTION_A,
      artifactId: null,
    };
    expect(
      resolveExecutionDeepLink(target, [artifactA], [actionA], {
        artifactsComplete: false,
        actionsComplete: false,
      }),
    ).toEqual({ kind: "pending", resource: "artifacts" });
    expect(
      resolveExecutionDeepLink(target, [artifactA], [actionA], {
        artifactsComplete: true,
        actionsComplete: false,
      }),
    ).toEqual({ kind: "artifact", artifactId: ARTIFACT_A });
  });

  it("does not guess when an action has multiple artifacts", () => {
    expect(
      resolveExecutionDeepLink(
        { kind: "target", actionId: ACTION_A, artifactId: null },
        [artifactA, artifactB],
        [actionA],
        { artifactsComplete: false, actionsComplete: false },
      ),
    ).toEqual({
      kind: "ambiguous",
      actionId: ACTION_A,
      artifactIds: [ARTIFACT_A, ARTIFACT_B],
    });
  });

  it("waits for action pagination before declaring an artifact-free action missing", () => {
    const target = {
      kind: "target" as const,
      actionId: ACTION_A,
      artifactId: null,
    };
    expect(
      resolveExecutionDeepLink(target, [], [], {
        artifactsComplete: true,
        actionsComplete: false,
      }),
    ).toEqual({ kind: "pending", resource: "actions" });
    expect(
      resolveExecutionDeepLink(target, [], [], {
        artifactsComplete: true,
        actionsComplete: true,
      }),
    ).toEqual({ kind: "not_found" });
  });
});

describe("Execution selection URLs", () => {
  it("preserves unrelated query state while setting or clearing exact IDs", () => {
    const existing = new URLSearchParams("mode=edit&actionId=stale");
    expect(
      executionUrlWithTarget("/p/project/execution", existing, {
        actionId: ACTION_A,
        artifactId: ARTIFACT_A,
      }),
    ).toBe(
      `/p/project/execution?mode=edit&actionId=${ACTION_A}&artifactId=${ARTIFACT_A}`,
    );
    expect(
      executionUrlWithTarget("/p/project/execution", existing, null),
    ).toBe("/p/project/execution?mode=edit");
  });

  it("keeps an action-only target when a queued run has no artifact projection yet", () => {
    expect(executionTargetAfterQueue(ACTION_A, null)).toEqual({
      actionId: ACTION_A,
      artifactId: null,
    });
    expect(executionTargetAfterQueue(ACTION_A, ARTIFACT_A)).toEqual({
      actionId: ACTION_A,
      artifactId: ARTIFACT_A,
    });
  });

  it("keeps completed resource-less runs settling across stale and failed refreshes", () => {
    const queued = queuedActionTargetAfterQueue(
      ACTION_A,
      "run-a",
      "technical_ticket",
    );
    const completed = queuedActionTargetAfterTerminal(queued, {
      runId: "run-a",
      status: "completed",
      resultArtifactId: null,
    });

    expect(completed).toMatchObject({
      actionId: ACTION_A,
      runId: "run-a",
      phase: "settling",
      refreshing: true,
      expectedArtifactId: null,
    });
    expect(
      resolveQueuedActionProjection(completed, [
        {
          id: ARTIFACT_A,
          actionId: ACTION_A,
          artifactType: "technical_ticket",
          activeRunId: null,
        },
      ]),
    ).toEqual({ kind: "pending" });
    expect(
      queuedActionTargetAfterRefresh(completed, "run-a", false),
    ).toMatchObject({ phase: "settling", refreshing: false });
    expect(
      queuedActionTargetAfterRefresh(completed, "run-a", true),
    ).toMatchObject({
      phase: "settling",
      refreshing: false,
      lastRefreshFailed: true,
    });
  });

  it("blocks duplicate generation only for the fenced action and artifact type", () => {
    const queued = queuedActionTargetAfterQueue(
      ACTION_A,
      "run-a",
      "technical_ticket",
    );

    expect(
      queuedActionBlocksGeneration(
        [queued],
        ACTION_A,
        "technical_ticket",
      ),
    ).toBe(true);
    expect(queuedActionBlocksGeneration([queued], ACTION_A)).toBe(true);
    expect(
      queuedActionBlocksGeneration([queued], ACTION_A, "content_brief"),
    ).toBe(false);
    expect(
      queuedActionBlocksGeneration(
        [queued],
        ACTION_B,
        "technical_ticket",
      ),
    ).toBe(false);
  });

  it("keeps an already-active recovery fenced when projection has only stale matches", () => {
    expect(
      resolveActiveGenerationRecovery(
        ACTION_A,
        "technical_ticket",
        [
          {
            id: ARTIFACT_A,
            actionId: ACTION_A,
            artifactType: "technical_ticket",
            artifactLive: true,
            liveRunId: null,
          },
          {
            id: ARTIFACT_B,
            actionId: ACTION_A,
            artifactType: "technical_ticket",
            artifactLive: true,
            liveRunId: null,
          },
          {
            id: "00000000-0000-4000-8000-0000000000e5",
            actionId: ACTION_B,
            artifactType: "technical_ticket",
            artifactLive: true,
            liveRunId: "run-foreign",
          },
        ],
        true,
      ),
    ).toEqual({ kind: "pending" });
    expect(
      resolveActiveGenerationRecovery(
        ACTION_A,
        "technical_ticket",
        [
          {
            id: ARTIFACT_A,
            actionId: ACTION_A,
            artifactType: "technical_ticket",
            artifactLive: false,
            liveRunId: "run-archived",
          },
        ],
        true,
      ),
    ).toEqual({ kind: "pending" });
  });

  it("rejects ambiguous active-run bindings and adopts only one exact binding", () => {
    const oldArtifact = {
      id: ARTIFACT_A,
      actionId: ACTION_A,
      artifactType: "technical_ticket",
      artifactLive: true,
      liveRunId: null,
    };
    const activeArtifact = {
      id: ARTIFACT_B,
      actionId: ACTION_A,
      artifactType: "technical_ticket",
      artifactLive: true,
      liveRunId: "run-b",
    };

    expect(
      resolveActiveGenerationRecovery(
        ACTION_A,
        "technical_ticket",
        [oldArtifact, activeArtifact],
        true,
      ),
    ).toEqual({
      kind: "active",
      artifactId: ARTIFACT_B,
      runId: "run-b",
    });
    expect(
      resolveActiveGenerationRecovery(
        ACTION_A,
        "technical_ticket",
        [
          { ...activeArtifact, id: ARTIFACT_A, liveRunId: "run-a" },
          activeArtifact,
        ],
        true,
      ),
    ).toEqual({
      kind: "ambiguous",
      artifactIds: [ARTIFACT_A, ARTIFACT_B],
    });
    expect(
      resolveActiveGenerationRecovery(
        ACTION_A,
        "technical_ticket",
        [activeArtifact],
        false,
      ),
    ).toEqual({ kind: "pending" });
  });

  it("lets recovery auto-select only while its original action-only target still owns the view", () => {
    expect(
      recoveryOwnsExecutionTarget(ACTION_A, {
        kind: "target",
        actionId: ACTION_A,
        artifactId: null,
      }),
    ).toBe(true);
    expect(recoveryOwnsExecutionTarget(ACTION_A, { kind: "none" })).toBe(
      false,
    );
    expect(
      recoveryOwnsExecutionTarget(ACTION_A, {
        kind: "target",
        actionId: ACTION_B,
        artifactId: null,
      }),
    ).toBe(false);
    expect(
      recoveryOwnsExecutionTarget(ACTION_A, {
        kind: "target",
        actionId: ACTION_A,
        artifactId: ARTIFACT_A,
      }),
    ).toBe(false);
  });

  it("invalidates stale recovery attempts after retry, project change, or unmount", () => {
    const expected = { attemptId: 7, projectId: "project-a" };

    expect(
      recoveryAttemptCanCommit(expected, {
        attemptId: 7,
        projectId: "project-a",
      }),
    ).toBe(true);
    expect(
      recoveryAttemptCanCommit(expected, {
        attemptId: 8,
        projectId: "project-a",
      }),
    ).toBe(false);
    expect(
      recoveryAttemptCanCommit(expected, {
        attemptId: 7,
        projectId: "project-b",
      }),
    ).toBe(false);
    expect(
      recoveryAttemptCanCommit(expected, {
        attemptId: undefined,
        projectId: null,
      }),
    ).toBe(false);
  });

  it("settles a completed run only when canonical projection proves its artifact", () => {
    const queued = queuedActionTargetAfterQueue(
      ACTION_A,
      "run-a",
      "technical_ticket",
    );
    const completed = queuedActionTargetAfterTerminal(queued, {
      runId: "run-a",
      status: "completed",
      resultArtifactId: ARTIFACT_B,
    });

    expect(resolveQueuedActionProjection(completed, [])).toEqual({
      kind: "pending",
    });
    expect(
      resolveQueuedActionProjection(completed, [
        {
          id: ARTIFACT_A,
          actionId: ACTION_A,
          artifactType: "technical_ticket",
          activeRunId: null,
        },
        {
          id: ARTIFACT_B,
          actionId: ACTION_A,
          artifactType: "technical_ticket",
          activeRunId: null,
        },
      ]),
    ).toEqual({ kind: "artifact", artifactId: ARTIFACT_B });
    expect(
      resolveQueuedActionProjection(queued, [
        {
          id: ARTIFACT_B,
          actionId: ACTION_A,
          artifactType: "technical_ticket",
          activeRunId: "run-a",
        },
      ]),
    ).toEqual({ kind: "artifact", artifactId: ARTIFACT_B });
  });

  it.each(["failed", "cancelled"] as const)(
    "releases a matching %s run but never another queued run",
    (status) => {
      const queued = queuedActionTargetAfterQueue(
        ACTION_A,
        "run-a",
        "technical_ticket",
      );
      expect(
        queuedActionTargetAfterTerminal(queued, {
          runId: "run-a",
          status,
          resultArtifactId: null,
        }),
      ).toBeNull();
      expect(
        queuedActionTargetAfterTerminal(queued, {
          runId: "run-b",
          status,
          resultArtifactId: null,
        }),
      ).toEqual(queued);
    },
  );

  it("snapshots the accepted URL so a dirty rollback cannot inherit attempted query state", () => {
    const pathname = "/p/project/execution";
    const accepted = executionLocationUrl(
      pathname,
      new URLSearchParams(
        `mode=edit&foo=1&actionId=${ACTION_A}&artifactId=${ARTIFACT_A}`,
      ),
    );
    const attempted = new URLSearchParams(`actionId=${ACTION_B}&bar=2`);

    expect(accepted).toBe(
      `${pathname}?mode=edit&foo=1&actionId=${ACTION_A}&artifactId=${ARTIFACT_A}`,
    );
    expect(
      executionUrlWithTarget(pathname, attempted, {
        actionId: ACTION_A,
        artifactId: ARTIFACT_A,
      }),
    ).toBe(
      `${pathname}?bar=2&actionId=${ACTION_A}&artifactId=${ARTIFACT_A}`,
    );
    expect(accepted).not.toContain("bar=2");
  });

  it("links an execution ref by action and includes an artifact only when unique", () => {
    expect(
      executionHrefForRef("project-id", {
        actionId: ACTION_A,
        artifactIds: [],
      }),
    ).toBe(`/p/project-id/execution?actionId=${ACTION_A}`);
    expect(
      executionHrefForRef("project-id", {
        actionId: ACTION_A,
        artifactIds: [ARTIFACT_A],
      }),
    ).toBe(
      `/p/project-id/execution?actionId=${ACTION_A}&artifactId=${ARTIFACT_A}`,
    );
    expect(
      executionHrefForRef("project-id", {
        actionId: ACTION_A,
        artifactIds: [ARTIFACT_A, ARTIFACT_B],
      }),
    ).toBe(`/p/project-id/execution?actionId=${ACTION_A}`);
  });
});
