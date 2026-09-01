import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), handle: vi.fn(async () => Response.json({ data: {} })) }));
vi.mock("../../../../../../lib/geo-tools/kb-v2-runtime.ts", () => ({ loadGeoKbEditorV2: mocks.load }));
vi.mock("../../../../../../lib/account-websites/geo-route.ts", () => ({ handleWebsiteGeoLoad: mocks.handle }));

import { POST } from "./route.ts";

describe("canonical website GEO runtime", () => {
  it("wires the owned Profile route to the complete V2 loader", async () => {
    const req = new Request("https://gengrowth.ai/api/account/websites/site/geo", { method: "POST", body: "{}" });
    await POST(req, { params: Promise.resolve({ websiteId: "site" }) });
    expect(mocks.handle).toHaveBeenCalledWith(req, "site", expect.objectContaining({ loadKnowledgeBase: mocks.load }));
  });
});
