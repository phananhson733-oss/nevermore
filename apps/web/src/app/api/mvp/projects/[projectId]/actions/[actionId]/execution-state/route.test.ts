import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  assertWorkspaceRateLimit: vi.fn(),
  getActionExecutionStateTimeline: vi.fn(),
  updateActionExecutionState: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/action-execution-state", () => ({
  getActionExecutionStateTimeline:
    mocks.getActionExecutionStateTimeline,
  updateActionExecutionState: mocks.updateActionExecutionState,
}));

const { GET, POST } = await import("./route.ts");

const ids = {
  actor: "b2000000-0000-4000-8000-000000000001",
  workspace: "b2000000-0000-4000-8000-000000000002",
  project: "b2000000-0000-4000-8000-000000000003",
  action: "b2000000-0000-4000-8000-000000000004",
  artifact: "b2000000-0000-4000-8000-000000000005",
  event: "b2000000-0000-4000-8000-000000000006",
} as const;
const params = {
  params: Promise.resolve({
    projectId: ids.project,
    actionId: ids.action,
  }),
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
  idempotencyKey: "execution-state-route-event",
  actorId: ids.actor,
  occurredAt: "2026-07-28T06:00:00.000Z",
} as const;
const timeline = {
  actionId: ids.action,
  artifactId: ids.artifact,
  current: event,
  history: [event],
};
const body = {
  state: "in_progress",
  phase: "implementation",
  nextStep: "完成当前交付物。",
  blocker: null,
  progress: null,
  expectedRevision: 0,
} as const;

function request(
  method: "GET" | "POST",
  options: {
    query?: string;
    body?: unknown;
    idempotencyKey?: string | null;
  } = {},
): NextRequest {
  const key =
    options.idempotencyKey === undefined
      ? "execution-state-route-key"
      : options.idempotencyKey;
  return new NextRequest(
    `http://localhost/api/mvp/projects/${ids.project}/actions/${ids.action}/execution-state${options.query ?? ""}`,
    {
      method,
      headers: {
        ...(method === "POST"
          ? { "Content-Type": "application/json" }
          : {}),
        Origin: "http://localhost",
        "X-Request-Id": `request-execution-${method.toLowerCase()}`,
        ...(key === null || method === "GET"
          ? {}
          : { "Idempotency-Key": key }),
      },
      ...(method === "POST"
        ? { body: JSON.stringify(options.body ?? body) }
        : {}),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.getOperatorContext.mockResolvedValue({
    userId: ids.actor,
    workspaceId: ids.workspace,
  });
  mocks.getActionExecutionStateTimeline.mockResolvedValue(timeline);
  mocks.updateActionExecutionState.mockResolvedValue({
    event,
    replayed: false,
  });
});

mocks.getOperatorContext.mockResolvedValue({
  userId: ids.actor,
  workspaceId: ids.workspace,
});
mocks.getActionExecutionStateTimeline.mockResolvedValue(timeline);
mocks.updateActionExecutionState.mockResolvedValue({
  event,
  replayed: false,
});

describe("Action Execution State route", () => {
  it("reads the exact Artifact-level execution stream", async () => {
    const response = await GET(
      request("GET", { query: `?artifactId=${ids.artifact}` }),
      params,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: timeline });
    expect(mocks.getActionExecutionStateTimeline).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
      ids.action,
      ids.artifact,
    );
  });

  it("uses null only for the independent Action-level execution stream", async () => {
    await GET(request("GET"), params);
    expect(mocks.getActionExecutionStateTimeline).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
      ids.action,
      null,
    );
  });

  it("appends a server-scoped update with header idempotency", async () => {
    const response = await POST(
      request("POST", {
        query: `?artifactId=${ids.artifact}`,
        body,
      }),
      params,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { event, replayed: false },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      ids.workspace,
      {
        idempotencyKey: "execution-state-route-key",
        scope: "action_execution_state",
        maxAttempts: 60,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.updateActionExecutionState).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
      ids.action,
      ids.artifact,
      ids.actor,
      "execution-state-route-key",
      body,
    );
  });

  it.each([
    `?artifactId=not-a-uuid`,
    `?artifactId=${ids.artifact}&artifactId=${ids.artifact}`,
    "?target=all",
  ])("rejects ambiguous or undeclared query scope %s", async (query) => {
    const response = await GET(request("GET", { query }), params);
    expect(response.status).toBe(422);
    expect(mocks.getActionExecutionStateTimeline).not.toHaveBeenCalled();
  });

  it("rejects browser-authored source authority before the service", async () => {
    const response = await POST(
      request("POST", {
        query: `?artifactId=${ids.artifact}`,
        body: { ...body, observedAt: "2026-07-28T06:00:00.000Z" },
      }),
      params,
    );
    expect(response.status).toBe(422);
    expect(mocks.updateActionExecutionState).not.toHaveBeenCalled();
  });

  it("requires a valid Idempotency-Key before rate limiting", async () => {
    const response = await POST(
      request("POST", {
        query: `?artifactId=${ids.artifact}`,
        idempotencyKey: null,
      }),
      params,
    );
    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.updateActionExecutionState).not.toHaveBeenCalled();
  });
});
