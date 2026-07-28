import { afterEach, describe, expect, it, vi } from "vitest";

import {
  actionExecutionStateQueryKey,
  actionExecutionStateUrl,
  artifactExecutionStateBatchQueryKey,
  artifactExecutionStateBatchUrl,
  buildArtifactExecutionStateBatchQueryOptions,
  buildActionExecutionStateQueryOptions,
  combineArtifactExecutionStateBatchResults,
  getArtifactExecutionStateBatch,
  getActionExecutionState,
  parseArtifactExecutionStateBatch,
  postActionExecutionState,
} from "./hooks-action-execution-state.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000041";
const ACTION_ID = "00000000-0000-4000-8000-000000000042";
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000043";
const ARTIFACT_ID_TWO = "00000000-0000-4000-8000-000000000044";

function ok(data: unknown): Response {
  return new Response(
    JSON.stringify({
      data,
      requestId: "req_test",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

const EMPTY_TIMELINE = {
  actionId: ACTION_ID,
  artifactId: ARTIFACT_ID,
  current: null,
  history: [],
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Action Execution State browser API boundary", () => {
  it("canonicalizes a bounded Artifact batch into one cache key and one request", async () => {
    expect(
      artifactExecutionStateBatchUrl(PROJECT_ID, [
        ARTIFACT_ID_TWO,
        ARTIFACT_ID,
        ARTIFACT_ID,
      ]),
    ).toBe(
      `/projects/${PROJECT_ID}/artifacts/execution-states?artifactId=${ARTIFACT_ID}&artifactId=${ARTIFACT_ID_TWO}`,
    );
    expect(
      artifactExecutionStateBatchQueryKey(PROJECT_ID, [
        ARTIFACT_ID_TWO,
        ARTIFACT_ID,
      ]),
    ).toEqual(
      artifactExecutionStateBatchQueryKey(PROJECT_ID, [
        ARTIFACT_ID,
        ARTIFACT_ID_TWO,
      ]),
    );
    expect(
      buildArtifactExecutionStateBatchQueryOptions(PROJECT_ID, []).enabled,
    ).toBe(false);

    const batch = {
      projectId: PROJECT_ID,
      items: [
        {
          actionId: ACTION_ID,
          artifactId: ARTIFACT_ID,
          current: null,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(ok(batch));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getArtifactExecutionStateBatch(PROJECT_ID, [ARTIFACT_ID]),
    ).resolves.toEqual(batch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails the whole browser batch closed when a 200 response omits or substitutes an Artifact", () => {
    const incomplete = {
      projectId: PROJECT_ID,
      items: [
        {
          actionId: ACTION_ID,
          artifactId: ARTIFACT_ID,
          current: null,
        },
      ],
    };

    expect(() =>
      parseArtifactExecutionStateBatch(
        PROJECT_ID,
        [ARTIFACT_ID, ARTIFACT_ID_TWO],
        incomplete,
      ),
    ).toThrow();

    const combined = combineArtifactExecutionStateBatchResults(
      PROJECT_ID,
      [[ARTIFACT_ID], [ARTIFACT_ID_TWO]],
      [
        { data: incomplete, error: null },
        { data: incomplete, error: null },
      ],
    );
    expect(combined.items).toBeUndefined();
    expect(combined.error).toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("keeps Action-level and exact Artifact-level streams in separate keys and URLs", () => {
    expect(actionExecutionStateUrl(PROJECT_ID, ACTION_ID, null)).toBe(
      `/projects/${PROJECT_ID}/actions/${ACTION_ID}/execution-state`,
    );
    expect(actionExecutionStateUrl(PROJECT_ID, ACTION_ID, ARTIFACT_ID)).toBe(
      `/projects/${PROJECT_ID}/actions/${ACTION_ID}/execution-state?artifactId=${ARTIFACT_ID}`,
    );
    expect(
      actionExecutionStateQueryKey(PROJECT_ID, ACTION_ID, null),
    ).not.toEqual(
      actionExecutionStateQueryKey(PROJECT_ID, ACTION_ID, ARTIFACT_ID),
    );
  });

  it("does not run until the full exact stream identity is available", () => {
    expect(
      buildActionExecutionStateQueryOptions(PROJECT_ID, null, ARTIFACT_ID)
        .enabled,
    ).toBe(false);
    expect(
      buildActionExecutionStateQueryOptions(PROJECT_ID, "", ARTIFACT_ID)
        .enabled,
    ).toBe(false);
    expect(
      buildActionExecutionStateQueryOptions(
        PROJECT_ID,
        ACTION_ID,
        ARTIFACT_ID,
      ).enabled,
    ).toBe(true);
  });

  it("reads the exact Artifact stream through the typed envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(EMPTY_TIMELINE));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getActionExecutionState(PROJECT_ID, ACTION_ID, ARTIFACT_ID),
    ).resolves.toEqual(EMPTY_TIMELINE);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/actions/${ACTION_ID}/execution-state?artifactId=${ARTIFACT_ID}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends scope and idempotency outside the strict public body", async () => {
    const event = {
      ...EMPTY_TIMELINE,
      replayed: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(ok(event));
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      state: "in_progress",
      phase: "technical_fix",
      nextStep: "Deploy the reviewed patch",
      expectedRevision: 0,
      blocker: null,
      progress: null,
    } as const;

    await postActionExecutionState(
      PROJECT_ID,
      ACTION_ID,
      ARTIFACT_ID,
      "execution-state-test-key",
      body,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/actions/${ACTION_ID}/execution-state?artifactId=${ARTIFACT_ID}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": "execution-state-test-key",
        }),
        body: JSON.stringify(body),
      }),
    );
  });
});
