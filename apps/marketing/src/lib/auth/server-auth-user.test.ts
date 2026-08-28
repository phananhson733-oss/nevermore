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
      googleSubject: null,
      avatarUrl: null,
      displayName: null,
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
      googleSubject: null,
      avatarUrl: null,
      displayName: null,
    });
  });

  it("returns the Google subject only from one consistent verified identity", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          identities: [
            {
              provider: "google",
              id: "108124453711223344556",
              identity_data: { sub: "108124453711223344556" },
            },
          ],
          // Mutable metadata must never be the source of this binding.
          user_metadata: { sub: "attacker-controlled" },
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      googleSubject: "108124453711223344556",
    });
  });

  it.each([
    ["absent identities", undefined],
    ["an empty identity list", []],
    [
      "a non-Google identity",
      [
        {
          provider: "email",
          id: "email-subject",
          identity_data: { sub: "email-subject" },
        },
      ],
    ],
  ])("returns no Google subject for %s", async (_label, identities) => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          identities,
          user_metadata: { sub: "must-not-be-used" },
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      googleSubject: null,
    });
  });

  it("fails closed when Google identity id and identity_data.sub conflict", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          identities: [
            {
              provider: "google",
              id: "google-a",
              identity_data: { sub: "google-b" },
            },
          ],
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      googleSubject: null,
    });
  });

  it("fails closed for duplicate differing Google identities", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          identities: [
            {
              provider: "google",
              id: "google-a",
              identity_data: { sub: "google-a" },
            },
            {
              provider: "google",
              id: "google-b",
              identity_data: { sub: "google-b" },
            },
          ],
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      googleSubject: null,
    });
  });

  it.each([null, { provider: 42 }])(
    "fails closed when the identity set contains malformed entry %j",
    async (malformed) => {
      mocks.getUser.mockResolvedValue({
        data: {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            identities: [
              {
                provider: "google",
                id: "google-a",
                identity_data: { sub: "google-a" },
              },
              malformed,
            ],
          },
        },
        error: null,
      });

      await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
        googleSubject: null,
      });
    },
  );

  it.each([
    [
      "a missing provider id",
      { provider: "google", identity_data: { sub: "google-a" } },
    ],
    [
      "a missing identity_data subject",
      { provider: "google", id: "google-a", identity_data: {} },
    ],
    [
      "a non-string subject",
      { provider: "google", id: "google-a", identity_data: { sub: 42 } },
    ],
    [
      "a blank subject",
      { provider: "google", id: " ", identity_data: { sub: " " } },
    ],
    [
      "an overlong subject",
      {
        provider: "google",
        id: "g".repeat(256),
        identity_data: { sub: "g".repeat(256) },
      },
    ],
  ])("fails closed for %s", async (_label, identity) => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          identities: [identity],
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      googleSubject: null,
    });
  });

  it("returns a bounded Google display name when available", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          user_metadata: { full_name: "  Ada Lovelace  " },
        },
      },
      error: null,
    });

    await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
      displayName: "Ada Lovelace",
    });
  });

  it.each(["", " ".repeat(4), "a".repeat(161), 42])(
    "refuses an unusable display name",
    async (full_name) => {
      mocks.getUser.mockResolvedValue({
        data: {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            user_metadata: { full_name },
          },
        },
        error: null,
      });

      await expect(getServerAuthenticatedUser()).resolves.toMatchObject({
        displayName: null,
      });
    },
  );

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
