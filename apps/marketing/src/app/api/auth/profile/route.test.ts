// @input  -- a mocked Supabase getUser result
// @output -- assertions that this endpoint names only the caller's own account
// @pos    -- guards the one marketing endpoint that may carry an email

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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

describe("GET /api/auth/profile", () => {
  it("names the account the caller is signed in as", async () => {
    withUser({ id: "abc", email: "ada@example.test" });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        email: "ada@example.test",
        avatarUrl: null,
        displayName: null,
      },
    });
  });

  /**
   * The menu draws an account name from this. A session with no address has to
   * arrive as null so the menu can leave that line out, rather than as "" which
   * would render an empty row where the account name belongs.
   */
  it("reports a missing address as null rather than an empty string", async () => {
    for (const email of [undefined, "", null]) {
      withUser({ id: "abc", email });

      await expect((await GET()).json()).resolves.toEqual({
        data: { email: null, avatarUrl: null, displayName: null },
      });
    }
  });

  it("returns the caller's display name when the provider supplied one", async () => {
    withUser({
      id: "abc",
      email: "ada@example.test",
      user_metadata: { full_name: "Ada Lovelace" },
    });

    await expect((await GET()).json()).resolves.toEqual({
      data: {
        email: "ada@example.test",
        avatarUrl: null,
        displayName: "Ada Lovelace",
      },
    });
  });

  it("tells a signed-out visitor nothing at all", async () => {
    withUser(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
  });

  /**
   * The whole reason /api/auth/session may not carry an address is that a
   * caching layer could hand one visitor's answer to the next.
   */
  it("is never cached, on any path", async () => {
    for (const user of [{ id: "abc", email: "ada@example.test" }, null]) {
      withUser(user);

      const cacheControl = (await GET()).headers.get("cache-control") ?? "";
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("private");
    }
  });

  it("keeps an auth outage apart from a sign-out", async () => {
    mocks.createClient.mockRejectedValue(new Error("no supabase"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
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

    expect((await GET()).status).toBe(503);
  });

  /**
   * A verified session is the only input. There is no id parameter to widen
   * this into a lookup, and the handler takes no Request at all — a regression
   * that added one would fail to compile against this call.
   */
  it("reads nothing from the request", () => {
    expect(GET.length).toBe(0);
  });
});
