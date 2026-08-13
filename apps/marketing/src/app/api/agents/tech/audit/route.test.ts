// @input  -- one POST request at the Tech Agent route boundary
// @output -- proof of Tech kind wiring and the bounded crawler duration budget
// @pos    -- focused Next.js route test for /api/agents/tech/audit

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("../../../../../lib/agents/audit-handler.ts", () => ({
  handleAgentAuditRequest: mocks.handle,
}));

const route = await import("./route.ts");

describe("POST /api/agents/tech/audit", () => {
  it("delegates as the Tech Agent with the crawler execution budget", async () => {
    const expected = Response.json({ data: {} });
    mocks.handle.mockResolvedValue(expected);
    const request = new Request("https://gengrowth.ai/api/agents/tech/audit", {
      method: "POST",
    });

    const response = await route.POST(request);

    expect(response).toBe(expected);
    expect(mocks.handle).toHaveBeenCalledWith(request, "tech");
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(300);
  });
});
