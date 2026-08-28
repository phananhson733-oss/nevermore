import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertCookieSecretConfigured,
  cookieAttributes,
  cookieSecretFailure,
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

    expect(open<{ sub: string }>("gg_id", value)).toEqual({
      sub: "1234567890",
    });
  });

  it("does not let a value sealed for one purpose open as another", () => {
    const value = seal("gg_oauth_tx", { verifier: "v" }, 600);

    // Someone who holds both cookies still cannot present a transaction cookie
    // as a Search Console grant.
    expect(open("gg_gsc", value)).toBeNull();
  });

  it("isolates every keyword Workflow ciphertext purpose", () => {
    const input = seal("gg_kw_workflow_input", { context: "sealed" }, 600);
    const grant = seal("gg_kw_workflow_grant", { accessToken: "secret" }, 600);
    const run = seal("gg_kw_workflow_run", { runId: "run-1" }, 600);

    expect(open("gg_kw_workflow_input", input)).toEqual({ context: "sealed" });
    expect(open("gg_kw_workflow_grant", grant)).toEqual({
      accessToken: "secret",
    });
    expect(open("gg_kw_workflow_run", run)).toEqual({ runId: "run-1" });
    expect(open("gg_kw_workflow_grant", input)).toBeNull();
    expect(open("gg_kw_workflow_run", grant)).toBeNull();
    expect(open("gg_kw_workflow_input", run)).toBeNull();
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
    process.env.MARKETING_COOKIE_SECRET = Buffer.alloc(16, 1).toString(
      "base64",
    );

    expect(() => seal("gg_id", {}, 60)).toThrow(SealedCookieError);
  });

  it("refuses the hex key pasted into the base64 slot, by name", () => {
    // `TOKEN_ENCRYPTION_KEY` is 64 hex characters, which base64-decodes to 48
    // bytes and clears the length check. The operator would see nothing wrong
    // and every cookie ever issued would stop opening.
    process.env.MARKETING_COOKIE_SECRET = "ab".repeat(32);

    expect(() => seal("gg_id", {}, 60)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("refuses a base64 secret with stray characters instead of decoding around them", () => {
    // Node's base64 decoder skips anything outside the alphabet, so a pasted
    // quote or newline yields a shorter, different key — silently.
    process.env.MARKETING_COOKIE_SECRET = `"${SECRET}"`;

    expect(() => seal("gg_id", {}, 60)).toThrow(/MARKETING_COOKIE_SECRET/);
  });

  it("refuses a TOKEN_ENCRYPTION_KEY that is not hex", () => {
    delete process.env.MARKETING_COOKIE_SECRET;
    process.env.TOKEN_ENCRYPTION_KEY = SECRET;

    expect(() => seal("gg_id", {}, 60)).toThrow(/TOKEN_ENCRYPTION_KEY/);

    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("reports the same diagnosis before a single cookie has been sealed", () => {
    // The check exists so the failure arrives at the authorization entry point
    // with the variable named, instead of arriving as "every visitor is signed
    // out" weeks later.
    process.env.MARKETING_COOKIE_SECRET = "ab".repeat(32);

    expect(() => assertCookieSecretConfigured()).toThrow(SealedCookieError);
    expect(() => assertCookieSecretConfigured()).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
  });

  it("passes the eager check on a correctly configured deployment", () => {
    expect(() => assertCookieSecretConfigured()).not.toThrow();
  });

  it("does not read a misconfigured key as a visitor who has no cookie", () => {
    // `open` swallows every failure so an unverifiable cookie reads as an
    // absent one. A root key that cannot be built is not a cookie problem at
    // all, and returning null for it is how a bad paste signs out every
    // visitor in silence.
    const value = seal("gg_id", { sub: "1" }, 3_600);
    delete process.env.MARKETING_COOKIE_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    expect(() => open("gg_id", value)).toThrow(SealedCookieError);
  });

  it("hands the same diagnosis to a reader as a value rather than a throw", () => {
    // Throwing is right at the entry of the authorization flow, where an
    // operator is the only one who can act on it. It is wrong on a page render:
    // the pages that would 500 are the connected tools, and they carry the
    // disconnect control — so the visitors most in need of it are the ones the
    // throw would lock out. Readers ask for the reason, log it, and show what
    // someone holding no cookie sees.
    process.env.MARKETING_COOKIE_SECRET = "ab".repeat(32);

    expect(cookieSecretFailure()).toMatch(/TOKEN_ENCRYPTION_KEY/);
  });

  it("answers null when the root key builds", () => {
    expect(cookieSecretFailure()).toBeNull();
  });

  it("keeps the access-token cookie off page requests", () => {
    // Scoped to /api so the token cannot reach a server component, and
    // therefore cannot be serialized into an RSC payload.
    expect(cookieAttributes("gg_gsc", 3_600).path).toBe("/api");
    expect(cookieAttributes("gg_id", 3_600).path).toBe("/");
  });

  it("keeps the granted property list readable by the page", () => {
    // The page renders the property picker, so it has to be able to read the
    // list. Putting the list behind /api alongside the token meant a visitor
    // who had just authorized successfully still saw the connect button,
    // because their own grant was invisible to the page showing it.
    expect(cookieAttributes("gg_sites", 3_600).path).toBe("/");
  });

  it("marks every cookie HttpOnly and SameSite=Lax", () => {
    for (const purpose of [
      "gg_oauth_tx",
      "gg_id",
      "gg_gsc",
      "gg_sites",
    ] as const) {
      const attributes = cookieAttributes(purpose, 600);
      expect(attributes.httpOnly).toBe(true);
      expect(attributes.sameSite).toBe("lax");
    }
  });
});
