import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemError } from "@sf/observability";
import type { OverviewView } from "@/lib/api/types";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  getWorkspaceView: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  shouldUseE2eProjectShell: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));
vi.mock("@/lib/services/workspace-view", () => ({
  getWorkspaceView: mocks.getWorkspaceView,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../_e2e-shell", () => ({
  shouldUseE2eProjectShell: mocks.shouldUseE2eProjectShell,
}));

const { loadInitialOverviewView } = await import("./_overview-server");

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
const VIEW: OverviewView = {
  view: "overview",
  project: {
    id: PROJECT_ID,
    clientName: "Server client",
    projectName: "Server overview",
    stage: "planning",
    site: {
      id: "00000000-0000-4000-8000-000000000043",
      origin: "https://example.test",
      host: "example.test",
      marketCodes: ["US"],
      languageCodes: ["en"],
    },
    contextStatus: "complete",
    currentIcpProfileVersion: 2,
    defaultDeliveryLocale: "en",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    archivedAt: null,
  },
  coverage: { overall: "complete", domains: {}, limitations: [] },
  activeRuns: [],
  frozenDiagnosticRunId: null,
  topActions: [],
  decisionReminders: [],
  contentDecayMonitor: {
    version: "content-decay-monitor.v1",
    projectionMode: "read_time",
    scheduleState: "not_configured",
    status: "unavailable",
    timezone: "UTC",
    timezoneSource: "fallback",
    latestCheckpointMonth: null,
    limitations: ["尚未接入月度自动任务。"],
    alerts: [],
  },
  latestSnapshot: null,
  topActionEvidence: [],
  deliveryFocus: null,
};

beforeEach(() => {
  mocks.getOperatorContext.mockReset();
  mocks.getWorkspaceView.mockReset();
  mocks.notFound.mockClear();
  mocks.shouldUseE2eProjectShell.mockReset();
  mocks.shouldUseE2eProjectShell.mockReturnValue(false);
});

describe("Overview page first paint", () => {
  it("passes the scoped canonical Overview projection into the client", async () => {
    mocks.getOperatorContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: WORKSPACE_ID,
    });
    mocks.getWorkspaceView.mockResolvedValue(VIEW);

    const initialView = await loadInitialOverviewView(PROJECT_ID, {});

    expect(mocks.getWorkspaceView).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID },
      PROJECT_ID,
      "overview",
    );
    expect(initialView).toBe(VIEW);
  });

  it("preserves the browser-backed database-free E2E harness", async () => {
    mocks.shouldUseE2eProjectShell.mockReturnValue(true);

    const initialView = await loadInitialOverviewView(PROJECT_ID, {});

    expect(mocks.getOperatorContext).not.toHaveBeenCalled();
    expect(mocks.getWorkspaceView).not.toHaveBeenCalled();
    expect(initialView).toBeUndefined();
  });

  it("maps an unauthenticated request to the shared 404 boundary", async () => {
    mocks.getOperatorContext.mockResolvedValue(null);

    await expect(loadInitialOverviewView(PROJECT_ID, {})).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.getWorkspaceView).not.toHaveBeenCalled();
  });

  it("maps a missing scoped project to the shared 404 boundary", async () => {
    mocks.getOperatorContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: WORKSPACE_ID,
    });
    mocks.getWorkspaceView.mockRejectedValue(
      new ProblemError("NOT_FOUND", "Project not found."),
    );

    await expect(loadInitialOverviewView(PROJECT_ID, {})).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched workspace union member", async () => {
    mocks.getOperatorContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: WORKSPACE_ID,
    });
    mocks.getWorkspaceView.mockResolvedValue({ view: "plan", actions: [] });

    await expect(loadInitialOverviewView(PROJECT_ID, {})).rejects.toMatchObject(
      { code: "DEPENDENCY_UNAVAILABLE" },
    );
  });
});
