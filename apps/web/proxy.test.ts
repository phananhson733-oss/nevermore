import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSession: vi.fn(),
}));

vi.mock("@/lib/auth/dev", () => ({
  isDevAuthEnabled: () => false,
}));
vi.mock("@/lib/supabase/refresh", () => ({
  updateSession: mocks.updateSession,
}));

const { proxy } = await import("./src/proxy.ts");

describe("web proxy security boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.updateSession.mockReset();
  });

  it("keeps public health independent of Supabase Auth and emits a strict nonce CSP", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(
      new NextRequest("https://app.signalframe.test/api/mvp/health/live"),
    );

    expect(mocks.updateSession).not.toHaveBeenCalled();
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+' 'strict-dynamic'/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
