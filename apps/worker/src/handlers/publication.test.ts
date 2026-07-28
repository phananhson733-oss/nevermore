import { describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../context.ts";
import type { PublicationJobPayload } from "../publication/run-publication.ts";
import { registerPublicationHandler } from "./publication.ts";
import { prepareRunDelivery } from "./recovery.ts";

vi.mock("./recovery.ts", () => ({
  prepareRunDelivery: vi.fn(
    async (
      ctx: WorkerContext,
      job: { readonly data: PublicationJobPayload },
      execute: (
        payload: PublicationJobPayload,
        runCtx: WorkerContext,
      ) => Promise<void>,
    ) => execute(job.data, ctx),
  ),
}));

describe("registerPublicationHandler", () => {
  it("registers one metadata-fenced publication queue and passes only canonical payload facts", async () => {
    let callback:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        queue: string,
        options: unknown,
        handler: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        expect(queue).toBe("publication");
        expect(options).toEqual({ includeMetadata: true });
        callback = handler;
        return "publication-worker";
      },
    );
    const info = vi.fn();
    const ctx = {
      boss: { work },
      logger: { info },
    } as unknown as WorkerContext;
    const runner = vi.fn(async () => undefined);
    await registerPublicationHandler(ctx, runner);
    if (!callback) throw new Error("publication handler missing");
    const data: PublicationJobPayload = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
      contractVersion: "publication.0.4.0",
    };
    const job = {
      data,
      retryCount: 0,
      retryLimit: 0,
      id: data.runId,
    };

    await callback([job]);

    expect(prepareRunDelivery).toHaveBeenCalledWith(
      ctx,
      job,
      expect.any(Function),
    );
    expect(runner).toHaveBeenCalledWith(ctx, data);
    expect(data).not.toHaveProperty("publicationAttemptId");
    expect(data).not.toHaveProperty("credential");
    expect(info).toHaveBeenCalledWith(
      "publication_handler_registered",
      {},
    );
  });
});
