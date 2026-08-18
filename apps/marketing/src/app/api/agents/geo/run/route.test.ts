// @input  -- one POST request at the GEO Agent run route boundary
// @output -- proof of handler wiring and the sampled-run duration budget
// @pos    -- focused Next.js route test for /api/agents/geo/run

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("../../../../../lib/agents/geo-run-handler.ts", () => ({
  handleGeoRunRequest: mocks.handle,
}));

const route = await import("./route.ts");

describe("POST /api/agents/geo/run", () => {
  it("delegates to the GEO run handler with the sampling duration budget", async () => {
    const expected = Response.json({ data: {} });
    mocks.handle.mockResolvedValue(expected);
    const request = new Request("https://gengrowth.ai/api/agents/geo/run", {
      method: "POST",
    });

    const response = await route.POST(request);

    expect(response).toBe(expected);
    expect(mocks.handle).toHaveBeenCalledWith(request);
    expect(route.runtime).toBe("nodejs");
    // Asserted here because `next build` does not fail on a missing export,
    // and 24 paid provider calls cannot finish inside the default limit.
    expect(route.maxDuration).toBe(300);
  });
});
