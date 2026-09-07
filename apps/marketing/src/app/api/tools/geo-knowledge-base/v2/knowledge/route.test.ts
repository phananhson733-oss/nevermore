import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generation: { identity: "offline-generation-dependencies" },
  handle: vi.fn(async () => Response.json({ ok: true })),
}));

vi.mock("../../../../../../lib/geo-tools/kb-generation-handler.ts", () => ({ handleGeoKbGeneration: mocks.handle }));
vi.mock("../../../../../../lib/geo-tools/kb-v2-runtime.ts", () => ({ DEFAULT_GEO_KB_V2_RUNTIME: { generation: mocks.generation } }));

import { maxDuration, POST, runtime } from "./route.ts";

describe("GEO knowledge generation route", () => {
  beforeEach(() => mocks.handle.mockClear());

  it("delegates only the knowledge_pack kind to the shared private generation handler", async () => {
    const request = new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v2/knowledge", { method: "POST" });
    await expect(POST(request)).resolves.toBeInstanceOf(Response);
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.handle).toHaveBeenCalledWith(request, "knowledge_pack", mocks.generation);
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });
});
