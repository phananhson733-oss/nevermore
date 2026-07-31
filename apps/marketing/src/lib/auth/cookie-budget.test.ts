import { beforeAll, describe, expect, it } from "vitest";

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

/** The fitting loop from the callback, kept in step with it by these tests. */
function fit(all: readonly string[]): { value: string; shown: number } {
  let fitted = all;
  let value = seal(
    "gg_sites",
    { properties: fitted, total: all.length },
    3_600,
  );
  while (
    fitted.length > 0 &&
    sealedByteLength(value) > MAX_SEALED_VALUE_BYTES
  ) {
    fitted = fitted.slice(0, fitted.length - 1);
    value = seal("gg_sites", { properties: fitted, total: all.length }, 3_600);
  }
  return { value, shown: fitted.length };
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
