import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), readWebsite: vi.fn(), loadKnowledgeBase: vi.fn(),
  handle: vi.fn(async () => Response.json({ data: "owned-view" })),
}));
vi.mock("../../../../../../lib/account-websites/route-http.ts", () => ({ authenticateAccountRequest: mocks.authenticate }));
vi.mock("../../../../../../lib/account-websites/store.ts", () => ({ readAccountWebsite: mocks.readWebsite }));
vi.mock("../../../../../../lib/geo-tools/kb-handler-deps.ts", () => ({ DEFAULT_GEO_KB_HANDLER_DEPENDENCIES: { loadKnowledgeBase: mocks.loadKnowledgeBase } }));
vi.mock("../../../../../../lib/account-websites/geo-route.ts", () => ({ handleWebsiteGeoLoad: mocks.handle }));
const route = await import("./route.ts");

describe("website GEO route adapter", () => {
  it("exposes only POST and forwards awaited identity to the private ownership boundary", async () => {
    expect("GET" in route).toBe(false);
    const request = new Request("https://gengrowth.ai/api/account/websites/owned/geo", { method: "POST" });
    const response = await route.POST(request, { params: Promise.resolve({ websiteId: "owned" }) });
    expect(mocks.handle).toHaveBeenCalledWith(request, "owned", {
      authenticate: mocks.authenticate, readWebsite: mocks.readWebsite, loadKnowledgeBase: mocks.loadKnowledgeBase,
    });
    expect(await response.json()).toEqual({ data: "owned-view" });
  });
});
