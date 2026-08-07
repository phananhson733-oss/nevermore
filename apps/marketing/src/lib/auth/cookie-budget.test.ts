import { beforeAll, describe, expect, it } from "vitest";

import { sealGrantProperties } from "./grant-cookie.ts";
import {
  MAX_SEALED_VALUE_BYTES,
  open,
  seal,
  sealedByteLength,
} from "./sealed-cookie.ts";

/**
 * The property list has to fit in one cookie.
 *
 * Browsers drop a cookie whose whole `name=value; attributes` line exceeds
 * about 4096 bytes, and they drop it SILENTLY — nothing reaches the server or
 * the page. So an over-budget `gg_sites` does not fail loudly; it just stops
 * existing, and a visitor who authorized successfully comes back to the
 * connect button, which is exactly the dead end the gg_gsc/gg_sites split was
 * introduced to fix. It reappeared for accounts with many properties: agencies
 * and multi-site owners, who are the people this tool is for.
 *
 * These tests pin the budget itself rather than a property count, because the
 * count that fits depends on how long the property ids are.
 */
beforeAll(() => {
  // 32 bytes of hex, matching the shape of the deployed key.
  process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
});

function properties(count: number): readonly string[] {
  return Array.from({ length: count }, (_unused, index) =>
    index % 2 === 0
      ? `sc-domain:client-site-${index}.example.com`
      : `https://www.client-site-${index}.example.com/`,
  );
}

/** The real fitting function, so these tests cannot drift away from it. */
function fit(all: readonly string[]): { value: string; shown: number } {
  return sealGrantProperties(all, 3_600);
}

describe("gg_sites cookie budget", () => {
  it("leaves room for the cookie name and attributes inside 4096 bytes", () => {
    const attributes =
      "gg_sites=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3540";
    expect(MAX_SEALED_VALUE_BYTES + attributes.length).toBeLessThan(4_096);
  });

  it("keeps a small account's list complete", () => {
    const all = properties(12);
    const { value, shown } = fit(all);

    expect(shown).toBe(all.length);
    expect(sealedByteLength(value)).toBeLessThanOrEqual(MAX_SEALED_VALUE_BYTES);
  });

  it("stays inside the budget for an account with hundreds of properties", () => {
    // Unfitted, 200 properties seal to roughly 9KB — over twice what a browser
    // will store, so the entire cookie is discarded.
    const all = properties(200);
    const unfitted = seal(
      "gg_sites",
      { properties: all, total: all.length },
      3_600,
    );
    expect(sealedByteLength(unfitted)).toBeGreaterThan(4_096);

    const { value, shown } = fit(all);
    expect(sealedByteLength(value)).toBeLessThanOrEqual(MAX_SEALED_VALUE_BYTES);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(all.length);
  });

  it("carries the true total so a trimmed list can be described as trimmed", () => {
    const all = properties(200);
    const { value, shown } = fit(all);

    const opened = open<{ properties: string[]; total: number }>(
      "gg_sites",
      value,
    );

    expect(opened).not.toBeNull();
    // The list is short, and it says so. A truncated list the page knows is
    // truncated can be described honestly; one that claims to be complete
    // cannot — the visitor would simply not find their own site in the picker
    // and have no way to know why.
    expect(opened?.properties).toHaveLength(shown);
    expect(opened?.total).toBe(all.length);
    expect(shown).toBeLessThan(all.length);
  });
});

describe("gg_gsc cookie budget", () => {
  /**
   * The grant cookie grew a refresh token, an expiry and a grant time.
   *
   * `gg_gsc` has no fitting loop — there is nothing in it to trim — so if the
   * payload ever outgrew the budget the browser would silently drop the whole
   * cookie and the visitor would appear never to have authorized. Synthetic
   * token strings on purpose: `scripts/secrets-scan.mjs` hard-fails the repo on
   * anything shaped like a real `ya29.` or `1//` token.
   */
  it("keeps an offline grant inside one cookie, even with long tokens", () => {
    const value = seal(
      "gg_gsc",
      {
        accessToken: `test-access-token-${"a".repeat(1_000)}`,
        accessTokenExpiresAt: 1_770_003_600,
        refreshToken: `test-refresh-token-${"r".repeat(250)}`,
        grantedAt: 1_770_000_000,
      },
      3_600,
    );

    expect(sealedByteLength(value)).toBeLessThanOrEqual(MAX_SEALED_VALUE_BYTES);
  });

  it("leaves room for the /api-scoped name and attributes inside 4096 bytes", () => {
    const attributes =
      "gg_gsc=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000";
    expect(MAX_SEALED_VALUE_BYTES + attributes.length).toBeLessThan(4_096);
  });
});
