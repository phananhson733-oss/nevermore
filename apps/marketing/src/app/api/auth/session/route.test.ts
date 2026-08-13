import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("../../../../lib/supabase/server.ts", () => ({
  createServerSupabaseClient: mocks.createClient,
}));

const { GET } = await import("./route.ts");

afterEach(() => {
  vi.clearAllMocks();
});

function withUser(user: unknown) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  });
}

/**
 * The header's session probe.
 *
 * Reachable from any marketing page without authentication, so the thing worth
 * pinning is what it does NOT say: a verified response is a bare boolean, an
 * unavailable response is a stable code, and no session identifier appears.
 */
describe("GET /api/auth/session", () => {
  it("reports a signed-in visitor", async () => {
    withUser({ id: "abc", email: "ada@example.test" });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: true });
  });

  it("reports a signed-out visitor", async () => {
    withUser(null);

    await expect((await GET()).json()).resolves.toEqual({ signedIn: false });
  });

  it("never leaks an identifier from the session", async () => {
    withUser({
      id: "11111111-2222-3333-4444-555555555555",
      email: "ada@example.test",
      user_metadata: { full_name: "Ada Lovelace" },
    });

    const body = await (await GET()).text();

    expect(body).toBe('{"signedIn":true}');
    for (const secret of [
      "ada@example.test",
      "Ada Lovelace",
      "11111111-2222-3333-4444-555555555555",
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  it("is never cached, because the answer is per visitor", async () => {
    withUser(null);

    const cacheControl = (await GET()).headers.get("cache-control") ?? "";

    // A shared cache here would show one visitor's state to another.
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
  });

  it("keeps the normal missing-session error on the signed-out path", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: {
            name: "AuthSessionMissingError",
            status: 400,
            message: "Auth session missing!",
          },
        }),
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: false });
  });

  it("reports authentication unavailable when Supabase is unreachable", async () => {
    mocks.createClient.mockRejectedValue(new Error("no supabase"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("does not misreport a returned auth service error as signed out", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            status: 503,
            message: "Auth service unavailable",
          },
        }),
      },
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
  });
});
