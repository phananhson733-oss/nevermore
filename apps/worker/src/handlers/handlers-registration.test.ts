import { describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../context.ts";
import { registerArtifactHandlers } from "./artifact.ts";
import { registerCollectHandlers } from "./collect.ts";
import { registerDiagnoseHandler } from "./diagnose.ts";

// This suite verifies only pg-boss registration options and queue names. Keep
// the four heavy runners isolated here: their behavior is covered by dedicated
// unit/real-Postgres suites, and executing them is not part of registration.
vi.mock("../collection/run-collection.ts", () => ({ runCollection: vi.fn() }));
vi.mock("../diagnostic/run-diagnostic.ts", () => ({ runDiagnostic: vi.fn() }));
vi.mock("../artifact/run-artifact.ts", () => ({ runArtifact: vi.fn() }));
vi.mock("../export/run-export.ts", () => ({ runExport: vi.fn() }));

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
});
