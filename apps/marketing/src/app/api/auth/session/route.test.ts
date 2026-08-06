import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createClient,
}));

const { GET } = await import("./route.ts");

afterEach(() => {
  vi.clearAllMocks();
});

function withUser(user: unknown) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  });
}

/**
 * The header's session probe.
 *
 * Reachable from any marketing page without authentication, so the thing worth
 * pinning is what it does NOT say: the response is a bare boolean, and no
 * identifier from the session may appear in it.
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

  it("answers signed-out when Supabase is unreachable", async () => {
    mocks.createClient.mockRejectedValue(new Error("no supabase"));

    const response = await GET();

    // Degrading to the sign-in link is honest and harmless; a 500 in the header
    // would break every marketing page instead.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: false });
  });
});
