import { describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../context.ts";
import { runCollection } from "../collection/run-collection.ts";
import { runProductProfileSynthesis } from "../product-profile/run-product-profile-synthesis.ts";
import { registerArtifactHandlers } from "./artifact.ts";
import { registerContentShadowHandler } from "./content-shadow.ts";
import { registerCollectHandlers } from "./collect.ts";
import { registerDiagnoseHandler } from "./diagnose.ts";
import { registerProfileSynthesizeHandler } from "./profile-synthesize.ts";
import { prepareRunDelivery } from "./recovery.ts";

// This suite verifies only pg-boss registration options and queue names. Keep
// the heavy runners isolated here: their behavior is covered by dedicated
// unit/real-Postgres suites, and executing them is not part of registration.
vi.mock("../collection/run-collection.ts", () => ({ runCollection: vi.fn() }));
vi.mock("../diagnostic/run-diagnostic.ts", () => ({ runDiagnostic: vi.fn() }));
vi.mock("../artifact/run-artifact.ts", () => ({ runArtifact: vi.fn() }));
vi.mock("../export/run-export.ts", () => ({ runExport: vi.fn() }));
vi.mock("../content-shadow/run-content-shadow.ts", () => ({
  runContentShadow: vi.fn(),
}));
vi.mock("../product-profile/run-product-profile-synthesis.ts", () => ({
  runProductProfileSynthesis: vi.fn(),
}));
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
  it("requests pg-boss delivery metadata for every registered queue", async () => {
    const work = vi.fn(async (..._args: unknown[]) => "worker-id");
    const info = vi.fn();
    const ctx = {
      boss: { work },
      logger: { info },
    } as unknown as WorkerContext;

    await registerCollectHandlers(ctx);
    await registerDiagnoseHandler(ctx);
    await registerProfileSynthesizeHandler(ctx);
    await registerArtifactHandlers(ctx);
    await registerContentShadowHandler(ctx);

    expect(work).toHaveBeenCalledTimes(10);
    expect(work.mock.calls.map((call) => call[0])).toEqual([
      "collect.crawl",
      "collect.gsc",
      "collect.ga4",
      "collect.csv",
      "collect.dataforseo",
      "diagnose",
      "profile.synthesize",
      "artifact.generate",
      "export.bundle",
      "content-shadow",
    ]);
    for (const call of work.mock.calls) {
      expect(call[1]).toEqual({ includeMetadata: true });
      expect(call[2]).toEqual(expect.any(Function));
    }
  });

  it("keeps Product Profile delivery fencing outside the canonical payload", async () => {
    vi.clearAllMocks();
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
    await registerProfileSynthesizeHandler(ctx);
    if (!handler) throw new Error("profile.synthesize handler missing");
    const data = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
    };
    const job = { data, retryCount: 1, retryLimit: 2 };

    await handler([job]);

    expect(prepareRunDelivery).toHaveBeenCalledWith(ctx, job, expect.any(Function));
    expect(runProductProfileSynthesis).toHaveBeenCalledWith(ctx, data);
    expect(data).not.toHaveProperty("retryCount");
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
