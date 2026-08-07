import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

vi.mock("@/env", () => ({
  getEnv: () => ({ APP_ORIGIN: "https://app.gengrowth.ai" }),
}));

const { GET } = await import("./route.ts");

afterEach(() => {
  vi.clearAllMocks();
});

function request(query: string): NextRequest {
  return new NextRequest(`https://app.gengrowth.ai/auth/callback${query}`);
}

function location(response: Response): URL {
  return new URL(response.headers.get("location")!);
}

/**
 * The OAuth return leg.
 *
 * Everything here arrives in a query string on a URL anyone can send to anyone,
 * so the two things worth pinning are that a code is actually exchanged before
 * a session is claimed, and that `next` can never leave our origin.
 */
describe("GET /auth/callback", () => {
  it("exchanges the code and lands on the requested path", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(request("?code=abc&next=%2Fp%2F42%2Foverview"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.status).toBe(307);
    expect(location(response).toString()).toBe(
      "https://app.gengrowth.ai/p/42/overview",
    );
  });

  it("defaults to the root when no path was requested", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(request("?code=abc"));

    expect(location(response).pathname).toBe("/");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example",
    "/\tevil",
  ])("refuses to forward to the off-origin target %p", async (next) => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      request(`?code=abc&next=${encodeURIComponent(next)}`),
    );

    // Whatever it resolves to, it must stay on our origin.
    expect(location(response).origin).toBe("https://app.gengrowth.ai");
    expect(location(response).pathname).toBe("/");
  });

  it("returns to login without exchanging when the code is absent", async () => {
    const response = await GET(request("?next=%2Foverview"));

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(location(response).pathname).toBe("/login");
    expect(location(response).searchParams.get("error")).toBe("oauth");
    // The intended destination survives the round trip, so retrying lands right.
    expect(location(response).searchParams.get("next")).toBe("/overview");
  });

  it("treats a provider refusal as a cancellation, not a failure", async () => {
    const response = await GET(request("?error=access_denied"));

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(location(response).searchParams.get("error")).toBe("oauth_denied");
  });

  it("returns to login when the exchange itself fails", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: new Error("bad code"),
    });

    const response = await GET(request("?code=stale"));

    expect(location(response).pathname).toBe("/login");
    expect(location(response).searchParams.get("error")).toBe("oauth");
  });

  it("does not echo the authorization code back into the redirect", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: new Error("bad code"),
    });

    const response = await GET(request("?code=secret-code-value"));

    expect(response.headers.get("location")).not.toContain("secret-code-value");
  });
});
