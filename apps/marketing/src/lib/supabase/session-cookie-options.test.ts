import { describe, expect, it } from "vitest";

import {
  hardenSessionCookieOptions,
  sessionCookieDomain,
  sessionCookieOptions,
} from "./session-cookie-options.ts";

/**
 * Session cookie scope.
 *
 * Signing in happens on gengrowth.ai and the product runs on
 * app.gengrowth.ai, so this attribute is the difference between "signed in
 * everywhere" and "signed in, then immediately signed out on the app". It is
 * also the attribute where a mistake widens exposure, so unset must mean
 * host-only rather than a guessed domain.
 */

describe("sessionCookieDomain", () => {
  it("is unset by default, so the cookie stays host-only", () => {
    expect(sessionCookieDomain({})).toBeUndefined();
  });

  it.each(["", "   "])("treats the blank value %p as unset", (raw) => {
    expect(sessionCookieDomain({ SESSION_COOKIE_DOMAIN: raw })).toBeUndefined();
  });

  it("accepts the registrable domain", () => {
    expect(
      sessionCookieDomain({ SESSION_COOKIE_DOMAIN: "gengrowth.ai" }),
    ).toBe("gengrowth.ai");
  });

  it("normalises the leading dot operators tend to write", () => {
    // RFC 6265 treats `.example.com` and `example.com` identically, but keeping
    // the dot makes the value harder to compare against in logs and tests.
    expect(
      sessionCookieDomain({ SESSION_COOKIE_DOMAIN: ".gengrowth.ai" }),
    ).toBe("gengrowth.ai");
    expect(sessionCookieDomain({ SESSION_COOKIE_DOMAIN: "." })).toBeUndefined();
  });

  it("lowercases and trims", () => {
    expect(
      sessionCookieDomain({ SESSION_COOKIE_DOMAIN: "  GenGrowth.AI  " }),
    ).toBe("gengrowth.ai");
  });
});

describe("sessionCookieOptions", () => {
  it("omits the domain entirely when unconfigured", () => {
    // Present-but-undefined would be serialized by some cookie writers; the key
    // must be absent.
    expect("domain" in sessionCookieOptions({})).toBe(false);
  });

  it("hardens the session cookie", () => {
    const options = sessionCookieOptions({ NODE_ENV: "production" });

    expect(options).toMatchObject({
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  });

  it("drops Secure outside production so local http dev can sign in", () => {
    expect(sessionCookieOptions({ NODE_ENV: "development" }).secure).toBe(false);
  });
});

describe("hardenSessionCookieOptions", () => {
  it("keeps Supabase's expiry metadata", () => {
    const hardened = hardenSessionCookieOptions(
      { maxAge: 3600, path: "/ignored" },
      { NODE_ENV: "production" },
    );

    expect(hardened.maxAge).toBe(3600);
    expect(hardened.path).toBe("/");
  });

  it("refuses weaker attributes the library might supply", () => {
    const hardened = hardenSessionCookieOptions(
      { httpOnly: false, sameSite: "none", secure: false },
      { NODE_ENV: "production" },
    );

    expect(hardened.httpOnly).toBe(true);
    expect(hardened.sameSite).toBe("lax");
    expect(hardened.secure).toBe(true);
  });
});
