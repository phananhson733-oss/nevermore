import { describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../context.ts";
import { runCollection } from "../collection/run-collection.ts";
import { registerArtifactHandlers } from "./artifact.ts";
import { registerCollectHandlers } from "./collect.ts";
import { registerDiagnoseHandler } from "./diagnose.ts";
import { prepareRunDelivery } from "./recovery.ts";

// This suite verifies only pg-boss registration options and queue names. Keep
// the four heavy runners isolated here: their behavior is covered by dedicated
// unit/real-Postgres suites, and executing them is not part of registration.
vi.mock("../collection/run-collection.ts", () => ({ runCollection: vi.fn() }));
vi.mock("../diagnostic/run-diagnostic.ts", () => ({ runDiagnostic: vi.fn() }));
vi.mock("../artifact/run-artifact.ts", () => ({ runArtifact: vi.fn() }));
vi.mock("../export/run-export.ts", () => ({ runExport: vi.fn() }));
vi.mock("./recovery.ts", () => ({
  prepareRunDelivery: vi.fn(
    async (
      _ctx: WorkerContext,
      job: { readonly data: unknown },
      execute: (payload: unknown, runCtx: WorkerContext) => Promise<void>,
    ) => execute(job.data, _ctx),
  ),
}));

describe("worker handler registration", () => {
  it("requests pg-boss delivery metadata for all seven queues", async () => {
    const work = vi.fn(async (..._args: unknown[]) => "worker-id");
    const info = vi.fn();
    const ctx = {
      boss: { work },
      logger: { info },
    } as unknown as WorkerContext;

    await registerCollectHandlers(ctx);
    await registerDiagnoseHandler(ctx);
    await registerArtifactHandlers(ctx);

    expect(work).toHaveBeenCalledTimes(7);
    expect(work.mock.calls.map((call) => call[0])).toEqual([
      "collect.crawl",
      "collect.gsc",
      "collect.ga4",
      "collect.csv",
      "diagnose",
      "artifact.generate",
      "export.bundle",
    ]);
    for (const call of work.mock.calls) {
      expect(call[1]).toEqual({ includeMetadata: true });
      expect(call[2]).toEqual(expect.any(Function));
    }
  });

  it("keeps delivery fencing and passes retry exhaustion metadata outside the canonical payload", async () => {
    vi.clearAllMocks();
    let collectHandler:
      | ((jobs: readonly Record<string, unknown>[]) => Promise<void>)
      | undefined;
    const work = vi.fn(
      async (
        queue: string,
        _options: unknown,
        handler: (jobs: readonly Record<string, unknown>[]) => Promise<void>,
      ) => {
        if (queue === "collect.gsc") collectHandler = handler;
        return "worker-id";
      },
    );
    const info = vi.fn();
    const ctx = {
      boss: { work },
      logger: { info },
    } as unknown as WorkerContext;
    await registerCollectHandlers(ctx);
    expect(collectHandler).toEqual(expect.any(Function));
    if (!collectHandler) throw new Error("collect.gsc handler was not registered");

    const data = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
    };
    const job = {
      data,
      retryCount: 3,
      retryLimit: 3,
    };
    await collectHandler([job]);

    expect(prepareRunDelivery).toHaveBeenCalledWith(
      ctx,
      job,
      expect.any(Function),
    );
    expect(runCollection).toHaveBeenCalledWith(ctx, data, {
      retryCount: 3,
      retryLimit: 3,
    });
    expect(data).not.toHaveProperty("retryCount");
    expect(data).not.toHaveProperty("retryLimit");
  });
});
