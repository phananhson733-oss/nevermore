// @input  -- one POST request at the Tech Agent profile-search route
// @output -- proof of Tech kind wiring and bounded provider duration
// @pos    -- focused Next.js route test for /api/agents/tech/profile-search

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("../../../../../lib/agents/profile-search-handler.ts", () => ({
  handleAgentProfileSearchRequest: mocks.handle,
}));

const route = await import("./route.ts");

describe("POST /api/agents/tech/profile-search", () => {
  it("delegates with immutable Tech route identity", async () => {
    const expected = Response.json({ data: {} });
    mocks.handle.mockResolvedValue(expected);
    const incoming = new Request(
      "https://gengrowth.ai/api/agents/tech/profile-search",
      { method: "POST" },
    );

    const response = await route.POST(incoming);

    expect(response).toBe(expected);
    expect(mocks.handle).toHaveBeenCalledWith(incoming, "tech");
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(60);
  });
});
