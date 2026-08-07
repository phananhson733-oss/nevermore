import { afterEach, describe, expect, it, vi } from "vitest";

import type { RefreshResult } from "./google-oauth.ts";
import {
  GRANT_ABSOLUTE_MAX_SECONDS,
  GRANT_TTL_SECONDS,
  IDENTITY_TTL_SECONDS,
  identitySubFrom,
  REFRESH_SKEW_SECONDS,
  resolveGrant,
  sealGrantProperties,
  sealGrantWithinBudget,
  type GrantCookieJar,
  type StoredGrant,
} from "./grant-cookie.ts";
import {
  MAX_SEALED_VALUE_BYTES,
  open,
  seal,
  sealedByteLength,
  type CookieAttributes,
} from "./sealed-cookie.ts";

// 32 bytes of hex, matching the shape of the deployed key. Set at module scope
// because the sealed fixtures below are built while this file is evaluated.
process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);

const NOW_MS = 1_770_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const now = () => NOW_MS;

interface Written {
  readonly name: string;
  readonly value: string;
  readonly attributes: CookieAttributes;
}

function fakeJar(initial: Readonly<Record<string, string>>) {
  const store = new Map(Object.entries(initial));
  const writes: Written[] = [];
  const clears: { name: string; path: string }[] = [];
  const jar: GrantCookieJar = {
    read: (name) => store.get(name),
    write: (name, value, attributes) => {
      store.set(name, value);
      writes.push({ name, value, attributes });
    },
    clear: (name, path) => {
      store.delete(name);
      clears.push({ name, path });
    },
  };
  return { jar, store, writes, clears };
}

function sealedGrant(grant: StoredGrant): string {
  return seal("gg_gsc", grant, GRANT_TTL_SECONDS, now);
}

function sealedSites(properties: readonly string[], total = properties.length) {
  return seal("gg_sites", { properties, total }, GRANT_TTL_SECONDS, now);
}

function sealedIdentity(sub: string): string {
  return seal(
    "gg_id",
    { sub, email: `${sub}@example.com` },
    GRANT_TTL_SECONDS,
    now,
  );
}

const SUB_A = "108000000000000000001";
const SUB_B = "108000000000000000002";

const CONNECTED = {
  gg_gsc: sealedGrant({
    accessToken: "test-access-token",
    accessTokenExpiresAt: NOW_SECONDS + 3_000,
    refreshToken: "test-refresh-token",
    grantedAt: NOW_SECONDS - 86_400,
    sub: SUB_A,
  }),
  gg_sites: sealedSites(["sc-domain:example.com"]),
  gg_id: sealedIdentity(SUB_A),
} as const;

/** Near enough to expiry that the skew window has already opened. */
const EXPIRING = {
  gg_gsc: sealedGrant({
    accessToken: "test-access-token",
    accessTokenExpiresAt: NOW_SECONDS + REFRESH_SKEW_SECONDS - 1,
    refreshToken: "test-refresh-token",
    grantedAt: NOW_SECONDS - 86_400,
    sub: SUB_A,
  }),
  gg_sites: sealedSites(["sc-domain:example.com"]),
  gg_id: sealedIdentity(SUB_A),
} as const;

function refreshTo(result: RefreshResult) {
  return vi.fn<(refreshToken: string) => Promise<RefreshResult>>(() =>
    Promise.resolve(result),
  );
}

const REFRESHED: RefreshResult = {
  kind: "refreshed",
  accessToken: "test-access-token-2",
  expiresInSeconds: 3_600,
  grantedScopes: [],
};

describe("resolveGrant", () => {
  it("reports no grant when the cookie is absent", async () => {
    const { jar, writes, clears } = fakeJar({});
    const refresh = refreshTo(REFRESHED);

    await expect(resolveGrant({ jar, now, refresh })).resolves.toEqual({
      kind: "none",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(clears).toHaveLength(0);
  });

  it("spends no network call while the access token is comfortably alive", async () => {
    const { jar, writes } = fakeJar(CONNECTED);
    const refresh = refreshTo(REFRESHED);

    await expect(resolveGrant({ jar, now, refresh })).resolves.toEqual({
      kind: "grant",
      accessToken: "test-access-token",
      properties: ["sc-domain:example.com"],
      propertyTotal: 1,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("refreshes inside the skew window rather than at the moment of expiry", async () => {
    // The route budgets tens of seconds of Search Console paging, so a token
    // with a minute left dies mid-run — after the per-IP quota has been spent.
    const { jar } = fakeJar(EXPIRING);
    const refresh = refreshTo(REFRESHED);

    const resolution = await resolveGrant({ jar, now, refresh });

    expect(refresh).toHaveBeenCalledWith("test-refresh-token");
    expect(resolution).toMatchObject({
      kind: "grant",
      accessToken: "test-access-token-2",
    });
  });

  it("re-seals the grant with the new expiry, the same refresh token and the same grant time", async () => {
    const { jar, writes } = fakeJar(EXPIRING);

    await resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) });

    const written = writes.find((entry) => entry.name === "gg_gsc");
    expect(written).toBeDefined();
    expect(open<StoredGrant>("gg_gsc", written?.value, now)).toEqual({
      accessToken: "test-access-token-2",
      accessTokenExpiresAt: NOW_SECONDS + 3_600,
      // Google does not rotate refresh tokens on a refresh, and `grantedAt` is
      // what the absolute cap is measured against — re-stamping it would make
      // the cap unreachable by design.
      refreshToken: "test-refresh-token",
      grantedAt: NOW_SECONDS - 86_400,
      // Carried forward, or the renewed cookie would be unbindable and the
      // next request would refuse the grant this one just renewed.
      sub: SUB_A,
    });
    expect(written?.attributes).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/api",
      maxAge: GRANT_TTL_SECONDS,
    });
  });

  it("re-stamps the property cookie too, or the page forgets the visitor is connected", async () => {
    // The page decides "connected" from `gg_sites` alone. Give `gg_gsc` a long
    // life and leave `gg_sites` on the old access-token clock and the visitor
    // still meets the connect button — with every test still green.
    const { jar, writes } = fakeJar(EXPIRING);

    await resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) });

    const written = writes.find((entry) => entry.name === "gg_sites");
    expect(written?.attributes.maxAge).toBe(GRANT_TTL_SECONDS);
    expect(written?.attributes.path).toBe("/");
    expect(
      open<{ properties: string[]; total: number }>(
        "gg_sites",
        written?.value,
        now,
      ),
    ).toEqual({ properties: ["sc-domain:example.com"], total: 1 });
  });

  it("re-lists the properties on refresh so a month-old snapshot does not go stale", async () => {
    const { jar, writes } = fakeJar(EXPIRING);
    const listProperties = vi.fn(() =>
      Promise.resolve(["sc-domain:example.com", "https://new.example.com/"]),
    );

    const resolution = await resolveGrant({
      jar,
      now,
      refresh: refreshTo(REFRESHED),
      listProperties,
    });

    expect(listProperties).toHaveBeenCalledWith("test-access-token-2");
    expect(resolution).toMatchObject({
      properties: ["sc-domain:example.com", "https://new.example.com/"],
      propertyTotal: 2,
    });
    const written = writes.find((entry) => entry.name === "gg_sites");
    expect(
      open<{ properties: string[] }>("gg_sites", written?.value, now)
        ?.properties,
    ).toEqual(["sc-domain:example.com", "https://new.example.com/"]);
  });

  it("keeps the previous property list when the re-list fails", async () => {
    const { jar } = fakeJar(EXPIRING);

    await expect(
      resolveGrant({
        jar,
        now,
        refresh: refreshTo(REFRESHED),
        listProperties: () => Promise.reject(new Error("provider")),
      }),
    ).resolves.toMatchObject({
      kind: "grant",
      properties: ["sc-domain:example.com"],
    });
  });

  it("clears both grant cookies at their own paths when Google says the grant is gone", async () => {
    const { jar, clears, store } = fakeJar(EXPIRING);

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo({ kind: "invalid_grant" }) }),
    ).resolves.toEqual({ kind: "revoked" });

    // `gg_gsc` lives at /api. A Set-Cookie at / does not match it, so a clear
    // without the explicit path leaves the refresh token in the browser.
    expect(clears).toEqual([
      { name: "gg_gsc", path: "/api" },
      { name: "gg_sites", path: "/" },
    ]);
    // `gg_id` survives on purpose: it holds a subject and an email, no
    // credential, and clearing it would sign the visitor out of nothing.
    expect(store.has("gg_gsc")).toBe(false);
    expect(store.has("gg_sites")).toBe(false);
  });

  it("keeps the grant when the refresh failed for any other reason", async () => {
    const { jar, clears, store } = fakeJar(EXPIRING);

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo({ kind: "transient" }) }),
    ).resolves.toEqual({ kind: "unavailable" });

    // A Google blip must not cost a visitor their consent screen.
    expect(clears).toHaveLength(0);
    expect(store.get("gg_gsc")).toBe(EXPIRING.gg_gsc);
    expect(store.get("gg_sites")).toBe(EXPIRING.gg_sites);
  });

  it("keeps the grant when refreshing throws outright", async () => {
    // `readGoogleOAuthConfig()` throws when the site is not configured, and it
    // is read on the refresh path. An unconfigured deployment must not delete
    // every visitor's grant, and must not 500 the route either.
    const { jar, clears } = fakeJar(EXPIRING);

    await expect(
      resolveGrant({
        jar,
        now,
        refresh: () => Promise.reject(new Error("not configured")),
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(clears).toHaveLength(0);
  });

  it("keeps the grant when refreshing throws before it returns a promise", async () => {
    // `readGoogleOAuthConfig()` is read synchronously while building the
    // refresh call, so this throw never becomes a rejected promise. A `.catch()`
    // on the result would not see it.
    const { jar, clears } = fakeJar(EXPIRING);

    await expect(
      resolveGrant({
        jar,
        now,
        refresh: () => {
          throw new Error("Google OAuth is not configured for this site.");
        },
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(clears).toHaveLength(0);
  });

  it("never refreshes and never clears a grant Google issued no refresh token for", async () => {
    // Google withholds the refresh token whenever the user was not actually
    // re-prompted. The envelope expiry is then the grant's whole lifetime;
    // there is nothing to renew with, so it behaves as it did before offline
    // access existed.
    const { jar, clears, writes } = fakeJar({
      gg_gsc: seal(
        "gg_gsc",
        { accessToken: "test-access-token", sub: SUB_A },
        600,
        now,
      ),
      gg_sites: sealedSites(["sc-domain:example.com"]),
      gg_id: sealedIdentity(SUB_A),
    });
    const refresh = refreshTo(REFRESHED);

    await expect(resolveGrant({ jar, now, refresh })).resolves.toEqual({
      kind: "grant",
      accessToken: "test-access-token",
      properties: ["sc-domain:example.com"],
      propertyTotal: 1,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(clears).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("stops sliding at the absolute cap so a stolen cookie cannot live forever", async () => {
    const { jar, clears } = fakeJar({
      gg_gsc: sealedGrant({
        accessToken: "test-access-token",
        accessTokenExpiresAt: NOW_SECONDS + 3_000,
        refreshToken: "test-refresh-token",
        grantedAt: NOW_SECONDS - GRANT_ABSOLUTE_MAX_SECONDS - 1,
        sub: SUB_A,
      }),
      gg_sites: sealedSites(["sc-domain:example.com"]),
      // Bindable, so the cap is what this test is measuring.
      gg_id: sealedIdentity(SUB_A),
    });
    const refresh = refreshTo(REFRESHED);

    await expect(resolveGrant({ jar, now, refresh })).resolves.toEqual({
      kind: "revoked",
    });
    // The cap is checked before the token clock: an unexpired access token is
    // not a reason to keep a grant that is past its outer limit.
    expect(refresh).not.toHaveBeenCalled();
    expect(clears).toHaveLength(2);
  });

  it("still answers with the fresh token when the cookie cannot be written", async () => {
    // Next throws if a cookie is written during a server-component render.
    // An unwritable cookie must not fail a read the visitor asked for.
    const { jar } = fakeJar(EXPIRING);
    const throwing: GrantCookieJar = {
      read: jar.read,
      write: () => {
        throw new Error("Cookies can only be modified in a Route Handler");
      },
      clear: jar.clear,
    };

    await expect(
      resolveGrant({ jar: throwing, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toMatchObject({
      kind: "grant",
      accessToken: "test-access-token-2",
    });
  });

  it("treats an empty access token as no grant at all", async () => {
    const { jar } = fakeJar({
      gg_gsc: sealedGrant({
        accessToken: "   ",
        accessTokenExpiresAt: NOW_SECONDS + 3_000,
        refreshToken: "test-refresh-token",
        grantedAt: NOW_SECONDS,
      }),
    });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("reports an authorized account that owns no property as connected", async () => {
    // An empty list is a real state, and is not the same as having no grant.
    const { jar } = fakeJar({
      gg_gsc: CONNECTED.gg_gsc,
      gg_sites: sealedSites([]),
      gg_id: CONNECTED.gg_id,
    });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toMatchObject({ kind: "grant", properties: [] });
  });
});

describe("resolveGrant account binding", () => {
  it("refuses and clears a grant that belongs to a different Google account", async () => {
    // A connects, then B signs in on the same browser. Without this the
    // identity cookie says B while A's refresh token — live for up to 90 days —
    // is still the credential every Search Console read is made with.
    const { jar, clears, store } = fakeJar({
      ...CONNECTED,
      gg_id: sealedIdentity(SUB_B),
    });
    const refresh = refreshTo(REFRESHED);

    await expect(resolveGrant({ jar, now, refresh })).resolves.toEqual({
      kind: "revoked",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(clears).toEqual([
      { name: "gg_gsc", path: "/api" },
      { name: "gg_sites", path: "/" },
    ]);
    expect(store.has("gg_gsc")).toBe(false);
  });

  it("uses a grant whose subject matches the identity cookie", async () => {
    const { jar, clears } = fakeJar(CONNECTED);

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toMatchObject({ kind: "grant" });
    expect(clears).toHaveLength(0);
  });

  it("refuses a grant it cannot bind to the account that is signed in", async () => {
    // A grant sealed without a subject cannot be shown to belong to whoever
    // the identity cookie now names. "Cannot prove" and "does belong" are not
    // the same answer, and only one of them is safe to act on.
    const { jar, clears } = fakeJar({
      gg_gsc: sealedGrant({
        accessToken: "test-access-token",
        accessTokenExpiresAt: NOW_SECONDS + 3_000,
        refreshToken: "test-refresh-token",
        grantedAt: NOW_SECONDS - 86_400,
      }),
      gg_sites: sealedSites(["sc-domain:example.com"]),
      gg_id: sealedIdentity(SUB_A),
    });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "revoked" });
    expect(clears).toHaveLength(2);
  });

  it("refuses a grant whose identity cookie is gone", async () => {
    // The lifetimes are coupled precisely so this case can be acted on: the
    // identity cookie is written for the grant's absolute cap, from the same
    // instant `grantedAt` is stamped, and no refresh carries a grant past that
    // cap. So an identity cannot expire out from under a usable grant, and its
    // absence is an anomaly rather than "nothing to compare against".
    //
    // Skipping the check here was what made the binding fire only after a
    // second account completed a full OAuth round trip — the one case the
    // callback already handles — while a shared browser holding a 30-day
    // sliding grant and no identity sailed through.
    const { jar, clears } = fakeJar({
      gg_gsc: CONNECTED.gg_gsc,
      gg_sites: CONNECTED.gg_sites,
    });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "revoked" });
    expect(clears).toEqual([
      { name: "gg_gsc", path: "/api" },
      { name: "gg_sites", path: "/" },
    ]);
  });

  it("refuses a grant that names no account, with no identity cookie either", async () => {
    // Nothing here can be attributed to anyone: not the grant, not the
    // browser. A credential that cannot be shown to belong to the visitor in
    // front of it is not one to read Search Console with, whatever sealed it.
    const { jar, clears } = fakeJar({
      gg_gsc: seal("gg_gsc", { accessToken: "test-access-token" }, 600, now),
      gg_sites: sealedSites(["sc-domain:example.com"]),
    });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "revoked" });
    expect(clears).toHaveLength(2);
  });

  it("keeps the identity cookie alive at least as long as any grant can be", () => {
    // The binding above is only load-bearing while there is an identity to
    // bind against. An identity that expired first would meet a grant still
    // sliding forward and drop it from every connected browser on day 31.
    expect(IDENTITY_TTL_SECONDS).toBeGreaterThanOrEqual(
      GRANT_ABSOLUTE_MAX_SECONDS,
    );
  });

  it("checks the account before the absolute cap, and both before any refresh", async () => {
    const { jar } = fakeJar({
      gg_gsc: sealedGrant({
        accessToken: "test-access-token",
        accessTokenExpiresAt: NOW_SECONDS + REFRESH_SKEW_SECONDS - 1,
        refreshToken: "test-refresh-token",
        grantedAt: NOW_SECONDS - 86_400,
        sub: SUB_A,
      }),
      gg_id: sealedIdentity(SUB_B),
    });
    const refresh = refreshTo(REFRESHED);

    await resolveGrant({ jar, now, refresh });

    // Spending a token-endpoint call on a grant we are about to throw away is
    // the traffic this whole ordering exists to avoid.
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("identitySubFrom", () => {
  it("reads the subject out of a sealed identity cookie", () => {
    expect(identitySubFrom(sealedIdentity(SUB_A), now)).toBe(SUB_A);
  });

  it("answers null for an absent, expired or unreadable cookie", () => {
    expect(identitySubFrom(undefined, now)).toBeNull();
    expect(identitySubFrom("not-a-cookie", now)).toBeNull();
    expect(
      identitySubFrom(seal("gg_id", { email: "a@b" }, 600, now), now),
    ).toBeNull();
  });
});

describe("resolveGrant with an unopenable cookie", () => {
  it("clears a grant cookie it cannot open, instead of leaving it for 30 days", async () => {
    // A rotated root key makes every sealed value unopenable. Leaving the
    // cookie in place orphans the visitor: the page shows "connect", disconnect
    // reports nothing to revoke, and the grant stays live at Google for the
    // whole 90 days with no way for us to reach it.
    const { jar, clears, store } = fakeJar({
      gg_gsc: "sealed-under-a-key-we-no-longer-have",
      gg_sites: "also-unopenable",
    });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "none" });
    expect(clears).toEqual([
      { name: "gg_gsc", path: "/api" },
      { name: "gg_sites", path: "/" },
    ]);
    expect(store.size).toBe(0);
  });

  it("clears nothing when there was no grant cookie at all", async () => {
    const { jar, clears } = fakeJar({ gg_sites: CONNECTED.gg_sites });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "none" });
    expect(clears).toHaveLength(0);
  });
});

describe("resolveGrant on a deployment whose cookie key cannot be built", () => {
  const CONFIGURED_KEY = process.env.TOKEN_ENCRYPTION_KEY;

  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = CONFIGURED_KEY;
    vi.restoreAllMocks();
  });

  it("reads as no grant instead of throwing the route that asked", async () => {
    const { jar, clears } = fakeJar(CONNECTED);
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.TOKEN_ENCRYPTION_KEY;

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "none" });
    // Nothing is cleared, unlike a value we cannot open: these cookies are
    // still openable by a deployment holding the right key, and deleting them
    // would turn a fixable environment variable into a refresh token stranded
    // at Google with no path from here to it.
    expect(clears).toHaveLength(0);
  });

  it("names the misconfiguration in the log rather than passing for an absent cookie", async () => {
    // The visitor sees what someone with no cookie sees; the operator must not.
    const { jar } = fakeJar(CONNECTED);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.TOKEN_ENCRYPTION_KEY;

    await resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.join(" ")).toMatch(/TOKEN_ENCRYPTION_KEY/);
  });
});

describe("gg_gsc size guard", () => {
  it("reports the grant as unstorable rather than sealing past the budget", () => {
    const oversized: StoredGrant = {
      accessToken: `test-access-token-${"a".repeat(4_000)}`,
      accessTokenExpiresAt: NOW_SECONDS + 3_600,
      refreshToken: "test-refresh-token",
      grantedAt: NOW_SECONDS,
      sub: SUB_A,
    };

    expect(sealGrantWithinBudget(oversized, GRANT_TTL_SECONDS, now)).toBeNull();
  });

  it("seals a normal grant unchanged", () => {
    const value = sealGrantWithinBudget(
      {
        accessToken: "test-access-token",
        accessTokenExpiresAt: NOW_SECONDS + 3_600,
        refreshToken: "test-refresh-token",
        grantedAt: NOW_SECONDS,
        sub: SUB_A,
      },
      GRANT_TTL_SECONDS,
      now,
    );

    expect(value).not.toBeNull();
    expect(sealedByteLength(value ?? "")).toBeLessThanOrEqual(
      MAX_SEALED_VALUE_BYTES,
    );
    expect(open<StoredGrant>("gg_gsc", value ?? "", now)?.sub).toBe(SUB_A);
  });

  it("drops a renewed grant that would not fit, instead of writing one the browser discards", async () => {
    // `gg_gsc` has no trimming loop — there is nothing in it to shorten. An
    // over-budget Set-Cookie is discarded by the browser without a word, so
    // the visitor would look like someone who never authorized while the
    // grant stayed live at Google.
    const { jar, writes, clears } = fakeJar({
      gg_gsc: sealedGrant({
        accessToken: "test-access-token",
        accessTokenExpiresAt: NOW_SECONDS + REFRESH_SKEW_SECONDS - 1,
        refreshToken: `test-refresh-token-${"r".repeat(4_000)}`,
        grantedAt: NOW_SECONDS - 86_400,
        sub: SUB_A,
      }),
      gg_sites: CONNECTED.gg_sites,
      gg_id: sealedIdentity(SUB_A),
    });

    await expect(
      resolveGrant({ jar, now, refresh: refreshTo(REFRESHED) }),
    ).resolves.toEqual({ kind: "revoked" });
    expect(writes.filter((entry) => entry.name === "gg_gsc")).toHaveLength(0);
    expect(clears).toEqual([
      { name: "gg_gsc", path: "/api" },
      { name: "gg_sites", path: "/" },
    ]);
  });
});

describe("sealGrantProperties", () => {
  it("reports the full count even when the list had to be trimmed", () => {
    const all = Array.from(
      { length: 200 },
      (_unused, index) => `sc-domain:client-site-${index}.example.com`,
    );

    const { value, shown } = sealGrantProperties(all, GRANT_TTL_SECONDS, now);
    const opened = open<{ properties: string[]; total: number }>(
      "gg_sites",
      value,
      now,
    );

    expect(shown).toBeLessThan(all.length);
    expect(opened?.properties).toHaveLength(shown);
    expect(opened?.total).toBe(all.length);
  });
});
