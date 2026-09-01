import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.ts";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock("../../../../../lib/auth/server-auth-user.ts", () => ({ getServerAuthenticatedUser: mocks.auth }));
vi.mock("../../../../../lib/geo-tools/visibility-history.ts", () => ({ listVisibilityHistory: mocks.list, readVisibilityHistory: vi.fn() }));
const USER = "11111111-1111-4111-8111-111111111111";
function post(body: unknown = {}, origin = "https://gengrowth.ai") {
  return new Request("https://gengrowth.ai/api/tools/ai-visibility-check/history", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ status: "authenticated", userId: USER }); mocks.list.mockResolvedValue({ kind: "ok", value: { runs: [], hasMore: false } }); });
describe("POST visibility history", () => {
  it("returns an account-scoped private list including a legitimate empty history", async () => {
    const response = await POST(post());
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: { runs: [], hasMore: false } });
    expect(mocks.list).toHaveBeenCalledWith({ userId: USER });
  });
  it("authenticates before reading history", async () => {
    mocks.auth.mockResolvedValue({ status: "unauthenticated" });
    const response = await POST(post());
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: { code: "auth_required" } });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each([[{ userId: USER }, "https://gengrowth.ai", 400], [[], "https://gengrowth.ai", 400], [{}, "https://attacker.test", 403]])("rejects injected scope and cross-origin bodies before storage", async (body, origin, status) => {
    const response = await POST(post(body, origin as string));
    expect(response.status).toBe(status); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("does not present storage outage as an empty history", async () => {
    mocks.list.mockResolvedValue({ kind: "unavailable", reason: "PRIVATE_PROVIDER_DETAIL" });
    const response = await POST(post());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: { code: "store_unavailable" } });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
