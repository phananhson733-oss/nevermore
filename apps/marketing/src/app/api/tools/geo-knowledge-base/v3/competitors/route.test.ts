import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtime: { competitors: { identity: "offline-competitor-dependencies" } },
  handle: vi.fn(async () => Response.json({ ok: true })),
}));

vi.mock("../../../../../../lib/geo-tools/kb-v3-competitor-handler.ts", () => ({ handleGeoKbV3Competitors: mocks.handle }));
vi.mock("../../../../../../lib/geo-tools/kb-v3-runtime.ts", () => ({ DEFAULT_GEO_KB_V3_RUNTIME: mocks.runtime }));

import { maxDuration, POST, runtime } from "./route.ts";

describe("GEO knowledge base competitors route", () => {
  beforeEach(() => mocks.handle.mockClear());

  it("delegates to the shared private competitor handler with the runtime's competitor half", async () => {
    const request = new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v3/competitors", { method: "POST" });
    await expect(POST(request)).resolves.toBeInstanceOf(Response);
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.handle).toHaveBeenCalledWith(request, mocks.runtime.competitors);
    expect(runtime).toBe("nodejs");
    // One page read bounded at 8 s behind a crawl gate that may wait; the
    // ceiling leaves room for both rather than being the working budget.
    expect(maxDuration).toBe(60);
  });
});
