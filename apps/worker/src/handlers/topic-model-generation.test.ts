import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../context.ts";
import { notifyAnalysisRefreshParent } from "../analysis-refresh/notify-parent.ts";
import { runTopicModelGeneration } from "../topic-model/run-topic-model-generation.ts";
import { prepareRunDelivery } from "./recovery.ts";
import { registerTopicModelGenerationHandler } from "./topic-model-generation.ts";

vi.mock("../topic-model/run-topic-model-generation.ts", () => ({
  runTopicModelGeneration: vi.fn(async () => undefined),
}));
vi.mock("../analysis-refresh/notify-parent.ts", () => ({
  notifyAnalysisRefreshParent: vi.fn(async () => undefined),
}));
vi.mock("./recovery.ts", () => ({
  prepareRunDelivery: vi.fn(
    async (
      ctx: WorkerContext,
      job: { readonly data: unknown },
      execute: (payload: unknown, runCtx: WorkerContext) => Promise<void>,
    ) => execute(job.data, ctx),
  ),
}));

describe("registerTopicModelGenerationHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fences the internal child delivery, runs it, then notifies only its exact parent", async () => {
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
    await registerTopicModelGenerationHandler(ctx);
    if (!handler) throw new Error("topic-model.generate handler missing");
    const data = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
      contractVersion: "2026-07-21",
    };
    const job = { data, retryCount: 1, retryLimit: 2 };

    await handler([job]);

    expect(work).toHaveBeenCalledWith(
      "topic-model.generate",
      { includeMetadata: true },
      expect.any(Function),
    );
    expect(prepareRunDelivery).toHaveBeenCalledWith(
      ctx,
      job,
      expect.any(Function),
    );
    expect(runTopicModelGeneration).toHaveBeenCalledWith(ctx, {
      runId: data.runId,
      workspaceId: data.workspaceId,
      projectId: data.projectId,
    });
    expect(notifyAnalysisRefreshParent).toHaveBeenCalledWith(ctx, data);
    expect(data).not.toHaveProperty("retryCount");
  });

  it("notifies the parent after final-delivery reconciliation fails and preserves the runner error", async () => {
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
    await registerTopicModelGenerationHandler(ctx);
    if (!handler) throw new Error("topic-model.generate handler missing");
    const data = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
      contractVersion: "2026-07-21",
    };

    await expect(
      handler([{ data, retryCount: 2, retryLimit: 2 }]),
    ).rejects.toBe(failure);

    expect(runTopicModelGeneration).not.toHaveBeenCalled();
    expect(notifyAnalysisRefreshParent).toHaveBeenCalledWith(ctx, data);
  });
});
