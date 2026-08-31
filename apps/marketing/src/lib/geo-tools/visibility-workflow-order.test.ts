import { describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("./visibility-workflow-steps.ts", () => ({
  visibilityPrepareStep: async () => { mocked.calls.push("prepare"); return { status: "ready", context: {}, plan: [{}] }; },
  visibilitySampleStep: async () => { mocked.calls.push("sample"); return {}; },
  visibilityAssembleStep: async () => { mocked.calls.push("assemble"); return { kind: "completed", report: {} }; },
  visibilitySiteEvidenceStep: async () => { mocked.calls.push("site-evidence"); return { kind: "completed", report: {} }; },
  visibilityPersistStep: async () => { mocked.calls.push("persist"); return { kind: "completed", report: {} }; },
}));
import { geoVisibilityWorkflow } from "./visibility-workflow.ts";
describe("durable evidence ordering", () => {
  it("finishes independent site evidence before freezing the persisted run output", async () => {
    mocked.calls.length = 0;
    await geoVisibilityWorkflow({ inputToken: "offline-sealed" });
    expect(mocked.calls).toEqual(["prepare", "sample", "assemble", "site-evidence", "persist"]);
  });
});
