import { NextRequest, NextResponse } from "next/server";
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

  it.each(["production", "test", "staging", "", undefined])(
    "keeps public health independent of Supabase Auth and emits a strict nonce CSP in %s mode",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);

      const response = await proxy(
        new NextRequest("https://app.signalframe.test/api/mvp/health/live"),
      );

      expect(mocks.updateSession).not.toHaveBeenCalled();
      const csp = response.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toMatch(
        /script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+' 'strict-dynamic'/,
      );
      expect(csp).not.toContain("'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
    },
  );

  it("enables the Next development-runtime CSP relaxations only in development mode", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await proxy(
      new NextRequest("https://app.signalframe.test/api/mvp/health/live"),
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toMatch(/style-src[^;]*'nonce-/);
  });

  it("preserves an unauthenticated deep-link query in the login redirect next param", async () => {
    mocks.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: null,
    });

    const response = await proxy(
      new NextRequest(
        "https://app.signalframe.test/p/project-1/report?outputLocale=zh-CN&tab=summary",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.signalframe.test/login?next=%2Fp%2Fproject-1%2Freport%3FoutputLocale%3Dzh-CN%26tab%3Dsummary",
    );
  });

  it("serves robots.txt to crawlers instead of redirecting them to login", async () => {
    // Googlebot has no session. When /robots.txt 307s to /login it never gets
    // a crawl policy at all, falls back to "everything is allowed", and walks
    // the /login HTML into every /_next/static asset it references.
    mocks.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: null,
    });

    const response = await proxy(
      new NextRequest("https://app.signalframe.test/robots.txt"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // Robots policy must survive an auth outage the same way health does.
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });
});
