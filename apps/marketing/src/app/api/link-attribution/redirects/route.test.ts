import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../../lib/link-attribution/short-links", () => ({ registerShortLink: mocks.register }));
import { OPTIONS, POST } from "./route";

function request(body: unknown = { code: "q1abcdef123456", destination_url: "https://gengrowth.ai/" }, key = "test-key", origin = "null") {
  return new Request("https://gengrowth.ai/api/link-attribution/redirects", {
    method: "POST", headers: { "content-type": "application/json", "x-link-attribution-tool-key": key, origin }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("MARKETING_SHORT_LINKS_ENABLED", "true");
  vi.stubEnv("GENGROWTH_LINK_TOOL_KEY", "test-key");
  mocks.register.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("GenGrowth short-link registration", () => {
  it("returns 201 for creation and 200 for reuse", async () => {
    for (const reused of [false, true]) {
      mocks.register.mockResolvedValue({ ok: true, code: "q1abcdef123456", destinationUrl: "https://gengrowth.ai/", reused });
      const response = await POST(request());
      expect(response.status).toBe(reused ? 200 : 201);
      expect((await response.json()).data.short_url).toBe("https://gengrowth.ai/q1abcdef123456");
      expect(response.headers.get("access-control-allow-origin")).toBe("null");
    }
  });
  it("rejects invalid credentials and foreign origins before accessing storage", async () => {
    expect((await POST(request({}, "bad"))).status).toBe(403);
    expect((await POST(request({}, "test-key", "https://evil.example"))).status).toBe(403);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("fails closed when disabled, unconfigured or storage fails", async () => {
    vi.stubEnv("MARKETING_SHORT_LINKS_ENABLED", "false");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("MARKETING_SHORT_LINKS_ENABLED", "true");
    vi.stubEnv("GENGROWTH_LINK_TOOL_KEY", "");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("GENGROWTH_LINK_TOOL_KEY", "test-key");
    mocks.register.mockRejectedValue(new Error("unavailable"));
    expect((await POST(request())).status).toBe(503);
  });
  it("preserves code conflicts and rejects malformed JSON", async () => {
    mocks.register.mockResolvedValue({ ok: false, status: 409, code: "CODE_CONFLICT", message: "Conflict" });
    expect((await POST(request())).status).toBe(409);
    const malformed = new Request("https://gengrowth.ai/api/link-attribution/redirects", { method: "POST", headers: { "content-type": "application/json", "x-link-attribution-tool-key": "test-key", origin: "null" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
  });
  it("answers browser preflight without touching storage", () => {
    expect(OPTIONS(request()).status).toBe(204);
    expect(OPTIONS(request({}, "test-key", "https://evil.example")).status).toBe(403);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it.each(["abc", "pricing", "q1too-short", null])("rejects an unroutable code %s before storage", async (code) => {
    expect((await POST(request({ code, destination_url: "https://gengrowth.ai/" }))).status).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
