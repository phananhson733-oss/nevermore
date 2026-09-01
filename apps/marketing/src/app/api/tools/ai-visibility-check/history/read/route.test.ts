import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.ts";
import { visibilityReportFixtureV2 } from "../../../../../../lib/geo-tools/visibility-v2.test-fixtures.ts";
import { encodeVisibilityWire } from "../../../../../../lib/geo-tools/visibility-wire.ts";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("../../../../../../lib/auth/server-auth-user.ts", () => ({ getServerAuthenticatedUser: mocks.auth }));
vi.mock("../../../../../../lib/geo-tools/visibility-history.ts", () => ({ listVisibilityHistory: vi.fn(), readVisibilityHistory: mocks.read }));
const USER = "11111111-1111-4111-8111-111111111111";
const report = encodeVisibilityWire(visibilityReportFixtureV2());
const runId = report.manifest.runId;
function post(body: unknown = { runId }, headers: Record<string, string> = {}) {
  return new Request("https://gengrowth.ai/api/tools/ai-visibility-check/history/read", { method: "POST", headers: { "content-type": "application/json", origin: "https://gengrowth.ai", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ status: "authenticated", userId: USER }); mocks.read.mockResolvedValue({ kind: "ok", value: { status: "completed", evidenceAvailability: "recorded", report } }); });
describe("POST reopen visibility report", () => {
  it("reopens only by stable run ID in the existing completed report envelope", async () => {
    const response = await POST(post());
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: { status: "completed", evidenceAvailability: "recorded", report } });
    expect(mocks.read).toHaveBeenCalledWith({ userId: USER, runId });
  });
  it("authenticates before looking up an existing report", async () => {
    mocks.auth.mockResolvedValue({ status: "unauthenticated" });
    const response = await POST(post());
    expect(response.status).toBe(401); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([{}, { runId: "invalid" }, { runId, userId: USER }, { runId, report: { status: "ok" } }, { runToken: runId }])("rejects invalid or extra request fields", async (body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([[{ origin: "https://attacker.test" }, 403], [{ "content-type": "text/plain" }, 415], [{ "content-length": "2048" }, 413]])("enforces same-origin JSON and body budgets", async (headers, status) => {
    const response = await POST(post({ runId }, headers as Record<string, string>));
    expect(response.status).toBe(status); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("uses a nonrevealing private 404 for unavailable ownership", async () => {
    mocks.read.mockResolvedValue({ kind: "missing" });
    const response = await POST(post());
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: { code: "not_found" } });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("contains thrown storage errors without exposing provider details", async () => {
    mocks.read.mockRejectedValue(new Error("PRIVATE_PROVIDER_DETAIL"));
    const response = await POST(post());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: { code: "store_unavailable" } });
  });
});
