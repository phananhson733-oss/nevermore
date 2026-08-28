// @input  -- the two draft routes
// @output -- proof both reach their handlers and keep the platform kill above their soft budgets
// @pos    -- wiring tests for the draft routes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_TOTAL_BUDGET_MS,
  ENVELOPE_MS,
  SECTION_ENDPOINT_BUDGET_MS,
} from "@sf/public-tools/content-brief/constants";

const mocks = vi.hoisted(() => ({ run: vi.fn(), section: vi.fn() }));

vi.mock("../../../../lib/tools/content-draft-handler.ts", () => ({
  handleContentDraftRunRequest: mocks.run,
  handleContentDraftSectionRequest: mocks.section,
}));

const run = await import("./run/route.ts");
const section = await import("./section/route.ts");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("draft routes", () => {
  it("keep the platform limit above their soft budgets", () => {
    expect(run.runtime).toBe("nodejs");
    expect(run.maxDuration * 1000).toBeGreaterThan(DRAFT_TOTAL_BUDGET_MS + ENVELOPE_MS);
    expect(section.maxDuration * 1000).toBeGreaterThan(SECTION_ENDPOINT_BUDGET_MS + ENVELOPE_MS);
  });

  it("hand requests to their handlers unchanged", async () => {
    const a = new Response(null, { status: 204 });
    const b = new Response(null, { status: 205 });
    mocks.run.mockResolvedValueOnce(a);
    mocks.section.mockResolvedValueOnce(b);
    const r1 = new Request("https://example.test/api/tools/content-draft/run", { method: "POST" });
    const r2 = new Request("https://example.test/api/tools/content-draft/section", { method: "POST" });
    await expect(run.POST(r1)).resolves.toBe(a);
    await expect(section.POST(r2)).resolves.toBe(b);
    expect(mocks.run).toHaveBeenCalledWith(r1);
    expect(mocks.section).toHaveBeenCalledWith(r2);
  });
});
