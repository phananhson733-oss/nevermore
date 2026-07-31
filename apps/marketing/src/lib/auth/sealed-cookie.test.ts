import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cookieAttributes,
  open,
  seal,
  SealedCookieError,
} from "./sealed-cookie.ts";

const SECRET = Buffer.alloc(32, 7).toString("base64");
const OTHER_SECRET = Buffer.alloc(32, 9).toString("base64");

describe("sealed cookies", () => {
  beforeEach(() => {
    process.env.MARKETING_COOKIE_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.MARKETING_COOKIE_SECRET;
  });

  it("round-trips a payload", () => {
    const value = seal("gg_id", { sub: "1234567890" }, 3_600);

    expect(open<{ sub: string }>("gg_id", value)).toEqual({ sub: "1234567890" });
  });

  it("does not let a value sealed for one purpose open as another", () => {
    const value = seal("gg_oauth_tx", { verifier: "v" }, 600);

    // Someone who holds both cookies still cannot present a transaction cookie
    // as a Search Console grant.
    expect(open("gg_gsc", value)).toBeNull();
  });

  it("rejects a tampered value", () => {
    const value = seal("gg_id", { sub: "1234567890" }, 3_600);
    const bytes = Buffer.from(value, "base64url");
    bytes[bytes.length - 20] ^= 0xff;

    expect(open("gg_id", bytes.toString("base64url"))).toBeNull();
  });

  it("treats an expired value as absent", () => {
    let clock = 1_000_000_000_000;
    const value = seal("gg_id", { sub: "1" }, 60, () => clock);

    expect(open("gg_id", value, () => clock)).not.toBeNull();
    clock += 61_000;
    expect(open("gg_id", value, () => clock)).toBeNull();
  });

  it("treats a value sealed under a rotated secret as absent", () => {
    const value = seal("gg_id", { sub: "1" }, 3_600);
    process.env.MARKETING_COOKIE_SECRET = OTHER_SECRET;

    expect(open("gg_id", value)).toBeNull();
  });

  it("returns null for a missing or malformed value rather than throwing", () => {
    expect(open("gg_id", undefined)).toBeNull();
    expect(open("gg_id", "")).toBeNull();
    expect(open("gg_id", "not-base64url!!")).toBeNull();
    expect(open("gg_id", Buffer.alloc(8).toString("base64url"))).toBeNull();
  });

  it("refuses to seal without a configured secret", () => {
    delete process.env.MARKETING_COOKIE_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    expect(() => seal("gg_id", {}, 60)).toThrow(SealedCookieError);
  });

  it("falls back to the key this project already carries", () => {
    delete process.env.MARKETING_COOKIE_SECRET;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("hex");

    const value = seal("gg_id", { sub: "1" }, 60);
    expect(open("gg_id", value)).toEqual({ sub: "1" });

    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("refuses a secret that is too short to be worth having", () => {
    process.env.MARKETING_COOKIE_SECRET = Buffer.alloc(16, 1).toString("base64");

    expect(() => seal("gg_id", {}, 60)).toThrow(SealedCookieError);
  });

  it("keeps the access-token cookie off page requests", () => {
    // Scoped to /api so the token cannot reach a server component, and
    // therefore cannot be serialized into an RSC payload.
    expect(cookieAttributes("gg_gsc", 3_600).path).toBe("/api");
    expect(cookieAttributes("gg_id", 3_600).path).toBe("/");
  });

  it("marks every cookie HttpOnly and SameSite=Lax", () => {
    for (const purpose of ["gg_oauth_tx", "gg_id", "gg_gsc"] as const) {
      const attributes = cookieAttributes(purpose, 600);
      expect(attributes.httpOnly).toBe(true);
      expect(attributes.sameSite).toBe("lax");
    }
  });
});
