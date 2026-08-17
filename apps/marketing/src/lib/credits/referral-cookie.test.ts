// @input  -- referral codes from a shared link and the cookie helpers
// @output -- assertions on code validation and cookie attributes
// @pos    -- guards the one cookie the credits system writes

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REFERRAL_COOKIE_NAME,
  normalizeReferralCode,
  referralCookieAttributes,
} from "./referral-cookie.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeReferralCode", () => {
  it("accepts a code the generator could have issued", () => {
    expect(normalizeReferralCode("ab3kd9xz")).toBe("ab3kd9xz");
  });

  it("lowercases, because links get retyped and shared in chat", () => {
    expect(normalizeReferralCode("AB3KD9XZ")).toBe("ab3kd9xz");
  });

  it("trims surrounding whitespace from a pasted link", () => {
    expect(normalizeReferralCode("  ab3kd9xz  ")).toBe("ab3kd9xz");
  });

  it("rejects anything the generator could not have produced", () => {
    expect(normalizeReferralCode(undefined)).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode("short")).toBeNull();
    expect(normalizeReferralCode("a".repeat(17))).toBeNull();
    expect(normalizeReferralCode("ab3kd9x-")).toBeNull();
    expect(normalizeReferralCode("ab3kd9x/")).toBeNull();
    expect(normalizeReferralCode("../../etc")).toBeNull();
  });
});

describe("referralCookieAttributes", () => {
  it("is named gg_ref and lasts thirty days", () => {
    expect(REFERRAL_COOKIE_NAME).toBe("gg_ref");
    expect(referralCookieAttributes().maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("is httpOnly and lax: nothing in the browser needs to read it", () => {
    const attributes = referralCookieAttributes();
    expect(attributes.httpOnly).toBe(true);
    expect(attributes.sameSite).toBe("lax");
    expect(attributes.path).toBe("/");
  });

  /**
   * Host-only on purpose. sealed-cookie.ts refuses to set a Domain because a
   * domain-wide cookie would hand the app's XSS blast radius to the marketing
   * site and back; a referral code is not worth reopening that. The landing
   * page and One Tap sign-in share a host, and attribution is best-effort by
   * design, so the apex/www edge is an accepted loss rather than a bug.
   */
  it("never sets a Domain", () => {
    expect(referralCookieAttributes()).not.toHaveProperty("domain");
  });

  it("is secure in production and open in local development", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(referralCookieAttributes().secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(referralCookieAttributes().secure).toBe(false);
  });
});
