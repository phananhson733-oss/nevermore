import { describe, expect, it, vi } from "vitest";

const handle = vi.hoisted(() => vi.fn());
vi.mock("../../../../../lib/geo-tools/citability-ai-handler.ts", () => ({ handleCitabilityAiRequest: handle }));
import { maxDuration, POST, runtime } from "./route.ts";

describe("citability AI review route", () => {
  it("delegates the exact request once to the authenticated durable handler", async () => {
    const request = new Request("https://gengrowth.ai/api/tools/page-citability-check/ai-review", { method: "POST" });
    const response = Response.json({ review: "handler-owned" });
    handle.mockResolvedValueOnce(response);
    expect(await POST(request)).toBe(response);
    expect(handle).toHaveBeenCalledExactlyOnceWith(request);
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(180);
  });
});
