// @input  -- one POST request at the SEO Agent profile-search route
// @output -- proof of SEO kind wiring and bounded provider duration
// @pos    -- focused Next.js route test for /api/agents/seo/profile-search

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("../../../../../lib/agents/profile-search-handler.ts", () => ({
  handleAgentProfileSearchRequest: mocks.handle,
}));

const route = await import("./route.ts");

describe("POST /api/agents/seo/profile-search", () => {
  it("delegates with immutable SEO route identity", async () => {
    const expected = Response.json({ data: {} });
    mocks.handle.mockResolvedValue(expected);
    const incoming = new Request(
      "https://gengrowth.ai/api/agents/seo/profile-search",
      { method: "POST" },
    );

    const response = await route.POST(incoming);

    expect(response).toBe(expected);
    expect(mocks.handle).toHaveBeenCalledWith(incoming, "seo");
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(60);
  });
});
