import { beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncRunsRepository } from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { dispatchKeywordGovernanceScheduleRequestBySource } from "../keyword-governance-suggestions/trigger-dispatcher.ts";
import { runKeywordGovernanceSuggestionGeneration } from "../keyword-governance-suggestions/run-keyword-governance-suggestion-generation.ts";
import { registerKeywordGovernanceSuggestionGenerationHandler } from "./keyword-governance-suggestion-generation.ts";
import { prepareRunDelivery } from "./recovery.ts";

vi.mock(
  "../keyword-governance-suggestions/run-keyword-governance-suggestion-generation.ts",
  () => ({
    runKeywordGovernanceSuggestionGeneration: vi.fn(async () => ({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: "00000000-0000-4000-8000-000000000004",
    })),
  }),
);
vi.mock("../keyword-governance-suggestions/trigger-dispatcher.ts", () => ({
  dispatchKeywordGovernanceScheduleRequestBySource: vi.fn(async () => ({
    kind: "completed",
  })),
}));
vi.mock("./recovery.ts", () => ({
  prepareRunDelivery: vi.fn(
    async (
      ctx: WorkerContext,
      job: { readonly data: unknown },
      execute: (payload: unknown, runCtx: WorkerContext) => Promise<unknown>,
    ) => execute(job.data, ctx),
  ),
}));

describe("registerKeywordGovernanceSuggestionGenerationHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(runKeywordGovernanceSuggestionGeneration).mockResolvedValue({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: "00000000-0000-4000-8000-000000000004",
    });
    vi.mocked(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).mockResolvedValue({ kind: "completed" });
    vi.mocked(prepareRunDelivery).mockImplementation(
      async (ctx, job, execute) => execute(job.data, ctx),
    );
  });

  it("fences the independent queue delivery and runs only its scoped payload", async () => {
    let handler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        _queue: string,
        _options: unknown,
        callback: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        handler = callback;
        return "worker-id";
      },
    );
    const ctx = {
      boss: { work },
      logger: { info: vi.fn() },
    } as unknown as WorkerContext;

    await registerKeywordGovernanceSuggestionGenerationHandler(ctx);
    if (!handler) throw new Error("suggestion generation handler missing");
    const data = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
      contractVersion: "2026-08-10",
    };
    const job = { data, retryCount: 1, retryLimit: 2 };

    await handler([job]);

    expect(work).toHaveBeenCalledWith(
      "keyword-governance-suggestion.generate",
      { includeMetadata: true },
      expect.any(Function),
    );
    expect(prepareRunDelivery).toHaveBeenCalledWith(
      ctx,
      job,
      expect.any(Function),
    );
    expect(runKeywordGovernanceSuggestionGeneration).toHaveBeenCalledWith(
      ctx,
      {
        runId: data.runId,
        workspaceId: data.workspaceId,
        projectId: data.projectId,
      },
    );
    expect(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).toHaveBeenCalledWith(
      ctx,
      {
        scope: {
          workspaceId: data.workspaceId,
          projectId: data.projectId,
        },
        sourceKind: "generation_continuation",
        sourceRef: data.runId,
      },
    );
    expect(data).not.toHaveProperty("retryCount");
  });

  it.each([
    "stale_authority",
    "concurrent_human",
    "conflict",
  ] as const)("dispatches the durable continuation after a %s supersession", async (reason) => {
    let handler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        _queue: string,
        _options: unknown,
        callback: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        handler = callback;
        return "worker-id";
      },
    );
    const ctx = {
      db: {},
      boss: { work },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as WorkerContext;
    vi.mocked(runKeywordGovernanceSuggestionGeneration).mockResolvedValueOnce({
      kind: "reschedule",
      reason,
      requestNextBatch: true,
      initiatedBy: "00000000-0000-4000-8000-000000000004",
    });

    await registerKeywordGovernanceSuggestionGenerationHandler(ctx);
    if (!handler) throw new Error("suggestion generation handler missing");
    await handler([
      {
        data: {
          runId: "00000000-0000-4000-8000-000000000001",
          workspaceId: "00000000-0000-4000-8000-000000000002",
          projectId: "00000000-0000-4000-8000-000000000003",
        },
        retryCount: 0,
        retryLimit: 2,
      },
    ]);

    expect(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).toHaveBeenCalledOnce();
  });

  it("ACKs the generation delivery when immediate continuation dispatch fails because maintenance owns the retry", async () => {
    let handler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        _queue: string,
        _options: unknown,
        callback: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        handler = callback;
        return "worker-id";
      },
    );
    const ctx = {
      db: {},
      boss: { work },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as WorkerContext;
    const schedulingFailure = new Error("database unavailable");
    vi.mocked(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).mockRejectedValueOnce(schedulingFailure);

    await registerKeywordGovernanceSuggestionGenerationHandler(ctx);
    if (!handler) throw new Error("suggestion generation handler missing");
    const firstDelivery = {
      data: {
        runId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002",
        projectId: "00000000-0000-4000-8000-000000000003",
      },
      retryCount: 0,
      retryLimit: 2,
    };

    await expect(handler([firstDelivery])).resolves.toBeUndefined();

    expect(runKeywordGovernanceSuggestionGeneration).toHaveBeenCalledOnce();
    expect(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).toHaveBeenCalledOnce();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "keyword_governance_schedule_dispatch_failed",
      {
        code: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
        source: "generation_continuation",
      },
    );
  });

  it("does not bypass preparation when a skipped canonical run is not terminal", async () => {
    let handler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        _queue: string,
        _options: unknown,
        callback: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        handler = callback;
        return "worker-id";
      },
    );
    const ctx = {
      db: {},
      boss: { work },
      logger: { info: vi.fn() },
    } as unknown as WorkerContext;
    vi.mocked(prepareRunDelivery).mockImplementationOnce(async () => undefined);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "00000000-0000-4000-8000-000000000002",
      project_id: "00000000-0000-4000-8000-000000000003",
      kind: "keyword_governance_suggestion_generation",
      status: "queued",
      active_key: "keyword-governance-suggestion:generation",
      contract_version: "2026-08-10",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: "keyword_governance_suggestion_generation_run",
      result_id: "00000000-0000-4000-8000-000000000001",
      attempt_count: 0,
      initiated_by: "00000000-0000-4000-8000-000000000004",
      queued_at: "2026-08-10T00:00:00.000Z",
      started_at: null,
      completed_at: null,
    });

    await registerKeywordGovernanceSuggestionGenerationHandler(ctx);
    if (!handler) throw new Error("suggestion generation handler missing");
    await handler([
      {
        data: {
          runId: "00000000-0000-4000-8000-000000000001",
          workspaceId: "00000000-0000-4000-8000-000000000002",
          projectId: "00000000-0000-4000-8000-000000000003",
        },
        retryCount: 1,
        retryLimit: 2,
      },
    ]);

    expect(runKeywordGovernanceSuggestionGeneration).not.toHaveBeenCalled();
    expect(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).not.toHaveBeenCalled();
  });

  it("dispatches a continuation request recovered from an already-terminal delivery without replaying the paid runner", async () => {
    let handler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        _queue: string,
        _options: unknown,
        callback: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        handler = callback;
        return "worker-id";
      },
    );
    const ctx = {
      db: {},
      boss: { work },
      logger: { info: vi.fn() },
    } as unknown as WorkerContext;
    vi.mocked(prepareRunDelivery).mockImplementationOnce(async () => undefined);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "00000000-0000-4000-8000-000000000002",
      project_id: "00000000-0000-4000-8000-000000000003",
      kind: "keyword_governance_suggestion_generation",
      status: "completed",
      active_key: "keyword-governance-suggestion:generation",
      contract_version: "2026-08-10",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: "keyword_governance_suggestion_generation_run",
      result_id: "00000000-0000-4000-8000-000000000001",
      attempt_count: 1,
      initiated_by: "00000000-0000-4000-8000-000000000004",
      queued_at: "2026-08-10T00:00:00.000Z",
      started_at: "2026-08-10T00:00:01.000Z",
      completed_at: "2026-08-10T00:00:02.000Z",
    });

    await registerKeywordGovernanceSuggestionGenerationHandler(ctx);
    if (!handler) throw new Error("suggestion generation handler missing");

    await expect(
      handler([
        {
          data: {
            runId: "00000000-0000-4000-8000-000000000001",
            workspaceId: "00000000-0000-4000-8000-000000000002",
            projectId: "00000000-0000-4000-8000-000000000003",
          },
          retryCount: 0,
          retryLimit: 2,
        },
      ]),
    ).resolves.toBeUndefined();
    expect(runKeywordGovernanceSuggestionGeneration).not.toHaveBeenCalled();
    expect(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).toHaveBeenCalledOnce();
  });

  it("does not schedule after a fatal settled outcome", async () => {
    let handler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        _queue: string,
        _options: unknown,
        callback: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        handler = callback;
        return "worker-id";
      },
    );
    const ctx = {
      boss: { work },
      logger: { info: vi.fn() },
    } as unknown as WorkerContext;
    vi.mocked(runKeywordGovernanceSuggestionGeneration).mockResolvedValueOnce({
      kind: "settled",
      requestNextBatch: false,
    });

    await registerKeywordGovernanceSuggestionGenerationHandler(ctx);
    if (!handler) throw new Error("suggestion generation handler missing");
    await handler([
      {
        data: {
          runId: "00000000-0000-4000-8000-000000000001",
          workspaceId: "00000000-0000-4000-8000-000000000002",
          projectId: "00000000-0000-4000-8000-000000000003",
        },
        retryCount: 0,
        retryLimit: 2,
      },
    ]);

    expect(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).not.toHaveBeenCalled();
  });

  it("preserves preparation failures without invoking the runner", async () => {
    let handler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        _queue: string,
        _options: unknown,
        callback: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        handler = callback;
        return "worker-id";
      },
    );
    const ctx = {
      boss: { work },
      logger: { info: vi.fn() },
    } as unknown as WorkerContext;
    const failure = new Error("final delivery fixture");
    vi.mocked(prepareRunDelivery).mockRejectedValueOnce(failure);

    await registerKeywordGovernanceSuggestionGenerationHandler(ctx);
    if (!handler) throw new Error("suggestion generation handler missing");

    await expect(
      handler([
        {
          data: {
            runId: "00000000-0000-4000-8000-000000000001",
            workspaceId: "00000000-0000-4000-8000-000000000002",
            projectId: "00000000-0000-4000-8000-000000000003",
          },
          retryCount: 2,
          retryLimit: 2,
        },
      ]),
    ).rejects.toBe(failure);

    expect(runKeywordGovernanceSuggestionGeneration).not.toHaveBeenCalled();
    expect(
      dispatchKeywordGovernanceScheduleRequestBySource,
    ).not.toHaveBeenCalled();
  });
});
