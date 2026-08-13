// @input  -- one POST request at the SEO profile-diagnosis boundary
// @output -- proof of immutable SEO identity and bounded server duration
// @pos    -- focused route test for /api/agents/seo/profile-refresh

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("../../../../../lib/agents/profile-refresh-handler.ts", () => ({
  handleAgentProfileRefreshRequest: mocks.handle,
}));

const route = await import("./route.ts");

describe("POST /api/agents/seo/profile-refresh", () => {
  it("delegates with immutable SEO identity and the synchronous profile budget", async () => {
    const expected = Response.json({ data: {} });
    mocks.handle.mockResolvedValue(expected);
    const incoming = new Request(
      "https://gengrowth.ai/api/agents/seo/profile-refresh",
      { method: "POST" },
    );

    const response = await route.POST(incoming);

    expect(response).toBe(expected);
    expect(mocks.handle).toHaveBeenCalledWith(incoming, "seo");
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(120);
  });
});
