import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dependencies: { identity: "offline-run-dependencies" },
  handle: vi.fn(async () => Response.json({ ok: true })),
}));

vi.mock("../../../../../../lib/geo-tools/kb-run-handler.ts", () => ({ handleGeoKbRun: mocks.handle }));
vi.mock("../../../../../../lib/geo-tools/kb-run-runtime.ts", () => ({
  DEFAULT_GEO_KB_RUN_DEPENDENCIES: mocks.dependencies,
}));

import { maxDuration, POST, runtime } from "./route.ts";

describe("GEO knowledge base run route", () => {
  beforeEach(() => mocks.handle.mockClear());

  it("delegates to the shared private run handler", async () => {
    const request = new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v3/run", { method: "POST" });
    await expect(POST(request)).resolves.toBeInstanceOf(Response);
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.handle).toHaveBeenCalledWith(request, mocks.dependencies);
    expect(runtime).toBe("nodejs");
    // The platform ceiling. One invocation stops handing out work well before
    // it, so a kill mid-request is not the normal way this route ends.
    expect(maxDuration).toBe(300);
  });
});
