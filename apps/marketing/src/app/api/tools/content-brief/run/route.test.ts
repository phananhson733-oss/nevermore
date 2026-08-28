// @input  -- one POST at the Content Brief Builder's API boundary
// @output -- proof it reaches the handler and keeps the platform kill above the soft budget
// @pos    -- wiring test for the brief route
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENVELOPE_MS,
  RUN_BUDGET_MS,
} from "@sf/public-tools/content-brief/constants";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock("../../../../../lib/tools/content-brief-handler.ts", () => ({
  handleContentBriefRequest: mocks.handle,
}));

const route = await import("./route.ts");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/tools/content-brief/run", () => {
  it("runs on Node with a platform limit far above the soft budget", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(300);
    expect(route.maxDuration * 1000).toBeGreaterThan(RUN_BUDGET_MS + ENVELOPE_MS);
  });

  it("hands the request to the handler unchanged", async () => {
    const response = new Response(null, { status: 204 });
    mocks.handle.mockResolvedValueOnce(response);
    const request = new Request("https://example.test/api/tools/content-brief/run", {
      method: "POST",
    });

    await expect(route.POST(request)).resolves.toBe(response);
    expect(mocks.handle).toHaveBeenCalledWith(request);
  });
});
