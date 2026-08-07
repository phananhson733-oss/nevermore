import { describe, expect, it, vi } from "vitest";

// 32 bytes of hex, matching the shape of the deployed key. Set at module scope
// because the sealed fixtures below are built while this file is evaluated.
process.env.TOKEN_ENCRYPTION_KEY = "cd".repeat(32);

import {
  disconnectGoogleGrant,
  isSameOriginPost,
  revocableGrantToken,
  type DisconnectCookieJar,
} from "./disconnect.ts";
import { seal } from "./sealed-cookie.ts";

const NOW_MS = 1_770_000_000_000;
const now = () => NOW_MS;

function fakeJar(initial: Readonly<Record<string, string>>) {
  const store = new Map(Object.entries(initial));
  const clears: { name: string; path: string }[] = [];
  const jar: DisconnectCookieJar = {
    read: (name) => store.get(name),
    clear: (name, path) => {
      store.delete(name);
      clears.push({ name, path });
    },
  };
  return { jar, store, clears };
}

const OFFLINE_GRANT = seal(
  "gg_gsc",
  {
    accessToken: "test-access-token",
    accessTokenExpiresAt: Math.floor(NOW_MS / 1000) + 3_000,
    refreshToken: "test-refresh-token",
    grantedAt: Math.floor(NOW_MS / 1000),
  },
  3_600,
  now,
);

describe("disconnectGoogleGrant", () => {
  it("revokes the refresh token, not the access token", async () => {
    // Revoking the refresh token kills the whole grant including the access
    // tokens derived from it. The other direction leaves the grant alive, which
    // is a disconnect that did not disconnect.
    const { jar } = fakeJar({ gg_gsc: OFFLINE_GRANT });
    const revoke = vi.fn(() => Promise.resolve(true));

    await expect(disconnectGoogleGrant({ jar, now, revoke })).resolves.toEqual({
      revokedAtGoogle: true,
    });
    expect(revoke).toHaveBeenCalledWith("test-refresh-token");
  });

  it("falls back to the access token for a grant sealed before offline access", async () => {
    const { jar } = fakeJar({
      gg_gsc: seal("gg_gsc", { accessToken: "test-access-token" }, 600, now),
    });
    const revoke = vi.fn(() => Promise.resolve(true));

    await disconnectGoogleGrant({ jar, now, revoke });

    expect(revoke).toHaveBeenCalledWith("test-access-token");
  });

  it("clears gg_gsc at /api, where a delete at / would silently miss it", async () => {
    const { jar, clears, store } = fakeJar({
      gg_gsc: OFFLINE_GRANT,
      gg_sites: "sites",
      gg_id: "id",
      gg_oauth_tx: "tx",
    });

    await disconnectGoogleGrant({
      jar,
      now,
      revoke: () => Promise.resolve(true),
    });

    expect(clears).toContainEqual({ name: "gg_gsc", path: "/api" });
    expect(clears).toContainEqual({ name: "gg_sites", path: "/" });
    expect(clears).toContainEqual({ name: "gg_id", path: "/" });
    expect(clears).toContainEqual({ name: "gg_oauth_tx", path: "/" });
    expect(store.size).toBe(0);
  });

  it("clears the cookies even when Google could not be reached", async () => {
    // Leaving a credential in someone's browser because Google was unreachable
    // is the worse of the two outcomes, so the local clear is unconditional.
    const { jar, clears } = fakeJar({ gg_gsc: OFFLINE_GRANT });

    await expect(
      disconnectGoogleGrant({ jar, now, revoke: () => Promise.resolve(false) }),
    ).resolves.toEqual({ revokedAtGoogle: false });
    expect(clears).toContainEqual({ name: "gg_gsc", path: "/api" });
  });

  it("clears the cookies even when revoking throws", async () => {
    const { jar, clears } = fakeJar({ gg_gsc: OFFLINE_GRANT });

    await expect(
      disconnectGoogleGrant({
        jar,
        now,
        revoke: () => Promise.reject(new Error("socket hang up")),
      }),
    ).resolves.toEqual({ revokedAtGoogle: false });
    expect(clears).toContainEqual({ name: "gg_gsc", path: "/api" });
  });

  it("does not report a grant it cannot open as nothing to revoke", async () => {
    // A rotated root key makes the cookie unopenable while the grant is still
    // live at Google. "Nothing was held" and "we could not reach what we held"
    // send the visitor to two different places, and only one of them is true.
    const { jar, clears } = fakeJar({ gg_gsc: "sealed-under-an-older-key" });
    const revoke = vi.fn(() => Promise.resolve(true));

    await expect(disconnectGoogleGrant({ jar, now, revoke })).resolves.toEqual({
      revokedAtGoogle: false,
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(clears).toContainEqual({ name: "gg_gsc", path: "/api" });
  });

  it("still clears the browser when the root key itself cannot be built", async () => {
    // `open` throws on an unusable root key so a bad paste cannot masquerade as
    // "this visitor has no cookie". Disconnecting is the one operation that
    // must survive it: the local clear needs no key at all.
    const { jar, clears } = fakeJar({ gg_gsc: OFFLINE_GRANT });
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    try {
      await expect(
        disconnectGoogleGrant({
          jar,
          now,
          revoke: () => Promise.resolve(true),
        }),
      ).resolves.toEqual({ revokedAtGoogle: false });
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = key;
    }
    expect(clears).toContainEqual({ name: "gg_gsc", path: "/api" });
  });

  it("reports null when there was nothing to revoke", async () => {
    // `null` is not `false`: nothing failed, there was simply no credential.
    const { jar, clears } = fakeJar({ gg_id: "id" });
    const revoke = vi.fn(() => Promise.resolve(true));

    await expect(disconnectGoogleGrant({ jar, now, revoke })).resolves.toEqual({
      revokedAtGoogle: null,
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(clears).toContainEqual({ name: "gg_id", path: "/" });
  });
});

describe("revocableGrantToken", () => {
  // Shared with the callback, which revokes the grant an arriving account
  // supersedes. Clearing the cookies there only forgets the credential: the
  // refresh token stays live at Google for months, on an account that has just
  // been replaced in this browser.
  it("prefers the refresh token, which kills the whole grant", () => {
    expect(
      revocableGrantToken({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      }),
    ).toBe("test-refresh-token");
  });

  it("falls back to the access token when Google issued no refresh token", () => {
    expect(revocableGrantToken({ accessToken: "test-access-token" })).toBe(
      "test-access-token",
    );
  });

  it("answers null when there is nothing to revoke", () => {
    expect(revocableGrantToken(null)).toBeNull();
    expect(revocableGrantToken({ accessToken: "" })).toBeNull();
    expect(
      revocableGrantToken({ accessToken: "", refreshToken: "" }),
    ).toBeNull();
  });
});

describe("isSameOriginPost", () => {
  it("accepts a request with no Origin header", () => {
    // Same-origin form posts and non-browser callers send none.
    expect(
      isSameOriginPost(
        new Request("https://gengrowth.ai/api/auth/google/logout"),
      ),
    ).toBe(true);
  });

  it("accepts this site's own origin", () => {
    expect(
      isSameOriginPost(
        new Request("https://gengrowth.ai/api/auth/google/logout", {
          headers: { origin: "https://gengrowth.ai" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects another site's origin", () => {
    // This endpoint now revokes at Google, which cannot be undone by coming
    // back. SameSite=Lax already withholds the cookie from a cross-site POST;
    // the guard costs one line and the stake changed.
    expect(
      isSameOriginPost(
        new Request("https://gengrowth.ai/api/auth/google/logout", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
  });
});
