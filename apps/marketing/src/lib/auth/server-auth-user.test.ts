// @input  -- a mocked Supabase server client
// @output -- assertions that the verified uuid never collapses an outage into a sign-out
// @pos    -- guards the identity boundary per-user server records key on

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("../supabase/server.ts", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
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
      email: null,
      avatarUrl: null,
    });
  });

  it("returns the verified address alongside the id", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "ada@example.test",
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "authenticated",
      userId: "11111111-1111-4111-8111-111111111111",
      email: "ada@example.test",
      avatarUrl: null,
    });
  });

  /**
   * The URL arrives in an OAuth claim but is stored in a mutable metadata
   * column and ends up as something the visitor's browser fetches. Pinning the
   * host means a poisoned row points at an image nobody serves, rather than at
   * an endpoint of the poisoner's choosing.
   */
  it("returns the Google photo when the host is Google's", async () => {
    for (const host of [
      "lh3.googleusercontent.com",
      "lh6.googleusercontent.com",
    ]) {
      const url = `https://${host}/a/ACg8ocABC=s96-c`;
      mocks.getUser.mockResolvedValue({
        data: {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            user_metadata: { avatar_url: url },
          },
        },
        error: null,
      });

      await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
        avatarUrl: url,
      });
    }
  });

  it("falls back to the picture claim when avatar_url is absent", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          user_metadata: {
            picture: "https://lh3.googleusercontent.com/a/PIC=s96-c",
          },
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      avatarUrl: "https://lh3.googleusercontent.com/a/PIC=s96-c",
    });
  });

  it.each([
    ["plain http", "http://lh3.googleusercontent.com/a/X"],
    ["another host", "https://evil.example/a/X"],
    ["a lookalike host", "https://evilgoogleusercontent.com/a/X"],
    ["a host with Google as a prefix", "https://googleusercontent.com.evil/a/X"],
    ["javascript", "javascript:alert(1)"],
    ["a data URI", "data:image/png;base64,AAAA"],
    ["not a URL at all", "/relative/path.png"],
    ["a non-string", 42],
  ])("refuses %s", async (_label, avatar_url) => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          user_metadata: { avatar_url },
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      avatarUrl: null,
    });
  });

  /** The production account that signed in without Google has neither field. */
  it("reports no photo when the metadata carries none", async () => {
    for (const user_metadata of [{}, undefined, null]) {
      mocks.getUser.mockResolvedValue({
        data: {
          user: { id: "11111111-1111-4111-8111-111111111111", user_metadata },
        },
        error: null,
      });

      await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
        avatarUrl: null,
      });
    }
  });

  /**
   * The account menu draws a name from this. An empty string would render an
   * empty row where the account name belongs, so it has to arrive as the same
   * "we do not know" the absent case gives.
   */
  it("normalises a blank address to null", async () => {
    for (const email of ["", undefined, null]) {
      mocks.getUser.mockResolvedValue({
        data: { user: { id: "11111111-1111-4111-8111-111111111111", email } },
        error: null,
      });

      await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
        email: null,
      });
    }
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
