// @input  -- a mocked Supabase server client
// @output -- assertions that the verified uuid never collapses an outage into a sign-out
// @pos    -- guards the identity boundary per-user server records key on

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("../supabase/server.ts", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

const { getServerAuthenticatedUser } = await import("./server-auth-user.ts");

describe("getServerAuthenticatedUser", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
  });

  it("returns the verified uuid", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "authenticated",
      userId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("reports unauthenticated for a verified absence of a session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "unauthenticated",
    });
  });

  it("reports unauthenticated only for the missing-session error", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthSessionMissingError",
        status: 400,
        message: "Auth session missing!",
      },
    });

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "unauthenticated",
    });
  });

  /**
   * The distinction that matters: a 503 from the auth service is not a
   * signed-out visitor. Collapsing it would silently stop granting credits and
   * look like nobody visited.
   */
  it("reports unavailable for any other error", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthRetryableFetchError",
        status: 503,
        message: "Auth service unavailable",
      },
    });

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "unavailable",
    });
  });

  /**
   * A name match alone is not the error auth-js raises for an absent session,
   * and a caller that keys records on the id must not accept a near-match.
   */
  it("reports unavailable for a missing-session name carrying another status", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", status: 500 },
    });

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("reports unavailable when the client throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("boom"));

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("never returns an id alongside an error, even when one is present", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: { name: "AuthSessionMissingError", status: 400 },
    });

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "unavailable",
    });
  });
});
