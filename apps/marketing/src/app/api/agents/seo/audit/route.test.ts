// @input  -- one POST request at the SEO Agent route boundary
// @output -- proof of SEO kind wiring and the bounded crawler duration budget
// @pos    -- focused Next.js route test for /api/agents/seo/audit

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("../../../../../lib/agents/audit-handler.ts", () => ({
  handleAgentAuditRequest: mocks.handle,
}));

const route = await import("./route.ts");

describe("POST /api/agents/seo/audit", () => {
  it("delegates as the SEO Agent with the crawler execution budget", async () => {
    const expected = Response.json({ data: {} });
    mocks.handle.mockResolvedValue(expected);
    const request = new Request("https://gengrowth.ai/api/agents/seo/audit", {
      method: "POST",
    });

    const response = await route.POST(request);

    expect(response).toBe(expected);
    expect(mocks.handle).toHaveBeenCalledWith(request, "seo");
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(300);
  });
});
