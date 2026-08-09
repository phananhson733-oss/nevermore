import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  type AsyncRunRow,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { notifyAnalysisRefreshParent } from "./notify-parent.ts";

const CHILD = {
  runId: "00000000-0000-4000-8000-000000000031",
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};
const PARENT_ID = "00000000-0000-4000-8000-000000000030";

function runRow(overrides: Partial<AsyncRunRow>): AsyncRunRow {
  return {
    id: CHILD.runId,
    workspace_id: CHILD.workspaceId,
    project_id: CHILD.projectId,
    kind: "collection",
    status: "completed",
    active_key: null,
    contract_version: "2026-07-21",
    request_payload: {},
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: null,
    result_id: null,
    attempt_count: 1,
    initiated_by: null,
    queued_at: "2026-08-07T14:40:21.000Z",
    started_at: "2026-08-07T14:40:26.000Z",
    completed_at: "2026-08-07T14:43:17.000Z",
    created_at: "2026-08-07T14:40:21.000Z",
    updated_at: "2026-08-07T14:43:17.000Z",
    ...overrides,
  } as AsyncRunRow;
}

function context(send: ReturnType<typeof vi.fn>): WorkerContext {
  const logger = {
    context: { service: "worker", environment: "test" },
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    db: {},
    boss: { send },
    logger,
  } as unknown as WorkerContext;
}

describe("notifyAnalysisRefreshParent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("hands a queued parent its continuation when a child settles", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockImplementation(
      async (_scope, id) =>
        id === CHILD.runId
          ? runRow({ status: "partial" })
          : runRow({
              id: PARENT_ID,
              kind: "analysis_refresh",
              status: "queued",
              result_type: "analysis_refresh_run",
              result_id: PARENT_ID,
            }),
    );
    vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "findParentRunIdByChildRunId",
    ).mockResolvedValue(PARENT_ID);
    const send = vi.fn(async () => "job-id");

    await notifyAnalysisRefreshParent(context(send), CHILD);

    expect(send).toHaveBeenCalledWith("refresh.analysis", {
      runId: PARENT_ID,
      workspaceId: CHILD.workspaceId,
      projectId: CHILD.projectId,
      contractVersion: "2026-07-21",
    });
  });

  it("hands an exact completed Topic Model child to its active parent", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockImplementation(
      async (_scope, id) =>
        id === CHILD.runId
          ? runRow({
              kind: "topic_model_generation",
              status: "completed",
              result_type: "topic_model_generation_run",
              result_id: CHILD.runId,
            })
          : runRow({
              id: PARENT_ID,
              kind: "analysis_refresh",
              status: "running",
              result_type: "analysis_refresh_run",
              result_id: PARENT_ID,
            }),
    );
    vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "findParentRunIdByChildRunId",
    ).mockResolvedValue(PARENT_ID);
    const send = vi.fn(async () => "job-id");

    await notifyAnalysisRefreshParent(context(send), CHILD);

    expect(send).toHaveBeenCalledWith("refresh.analysis", {
      runId: PARENT_ID,
      workspaceId: CHILD.workspaceId,
      projectId: CHILD.projectId,
      contractVersion: "2026-07-21",
    });
  });

  it("fails closed before lookup when a Topic Model child projection drifts", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(
      runRow({
        kind: "topic_model_generation",
        status: "completed",
        result_type: "topic_model_generation_run",
        result_id: "00000000-0000-4000-8000-000000000099",
      }),
    );
    const lookup = vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "findParentRunIdByChildRunId",
    );
    const send = vi.fn();

    await notifyAnalysisRefreshParent(context(send), CHILD);

    expect(lookup).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["still queued", "queued"],
    ["still running", "running"],
  ])("does not notify while the child is %s", async (_label, status) => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(
      runRow({ status: status as AsyncRunRow["status"] }),
    );
    const lookup = vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "findParentRunIdByChildRunId",
    );
    const send = vi.fn();

    await notifyAnalysisRefreshParent(context(send), CHILD);

    expect(lookup).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing for a child no Analysis Refresh step owns", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(
      runRow({ status: "completed" }),
    );
    vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "findParentRunIdByChildRunId",
    ).mockResolvedValue(null);
    const send = vi.fn();

    await notifyAnalysisRefreshParent(context(send), CHILD);

    expect(send).not.toHaveBeenCalled();
  });

  it("does not notify a parent that already reached a terminal state", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockImplementation(
      async (_scope, id) =>
        id === CHILD.runId
          ? runRow({ status: "completed" })
          : runRow({
              id: PARENT_ID,
              kind: "analysis_refresh",
              status: "failed",
            }),
    );
    vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "findParentRunIdByChildRunId",
    ).mockResolvedValue(PARENT_ID);
    const send = vi.fn();

    await notifyAnalysisRefreshParent(context(send), CHILD);

    expect(send).not.toHaveBeenCalled();
  });

  it("does not notify a malformed active parent projection", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockImplementation(
      async (_scope, id) =>
        id === CHILD.runId
          ? runRow({ status: "completed" })
          : runRow({
              id: PARENT_ID,
              kind: "diagnostic",
              status: "queued",
              result_type: "analysis_refresh_run",
              result_id: PARENT_ID,
            }),
    );
    vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "findParentRunIdByChildRunId",
    ).mockResolvedValue(PARENT_ID);
    const send = vi.fn();

    await notifyAnalysisRefreshParent(context(send), CHILD);

    expect(send).not.toHaveBeenCalled();
  });

  it("never lets a notification failure escape to the settled child delivery", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockRejectedValue(
      new Error("connection lost"),
    );
    const send = vi.fn();

    await expect(
      notifyAnalysisRefreshParent(context(send), CHILD),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
