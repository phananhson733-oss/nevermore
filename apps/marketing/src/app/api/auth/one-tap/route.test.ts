import { afterEach, describe, expect, it, vi } from "vitest";

// vitest maps `@/` to apps/web/src only, so a marketing test cannot resolve
// the alias. Import the real module relatively, and fill the alias the route
// itself imports with that same real implementation — mocking it would leave
// the nonce screening untested, which is the whole point of this file.
import * as oneTap from "../../../../lib/auth/one-tap.ts";

const { createOneTapNonce } = oneTap;

const mocks = vi.hoisted(() => ({
  signInWithIdToken: vi.fn(),
  sealed: { value: undefined as string | undefined },
  del: vi.fn(),
  open: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      mocks.sealed.value === undefined
        ? undefined
        : { value: mocks.sealed.value },
    delete: mocks.del,
  }),
}));

vi.mock("../../../../lib/auth/sealed-cookie", () => ({ open: mocks.open }));

vi.mock("../../../../lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { signInWithIdToken: mocks.signInWithIdToken },
  }),
}));

const { POST } = await import("./route.ts");

function credential(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}

function post(body: unknown): Request {
  return new Request("https://gengrowth.ai/api/auth/one-tap", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.sealed.value = undefined;
  vi.unstubAllEnvs();
});

function configured(): void {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");
}

/**
 * The One Tap enforcement point.
 *
 * one-tap.ts is exhaustively tested as a pure module, but every one of those
 * tests still passes if this route stops calling it. These assert the route
 * itself: that a stolen credential never reaches the provider, that the raw
 * nonce is what gets forwarded, and that one nonce buys exactly one sign-in.
 */
describe("POST /api/auth/one-tap", () => {
  it("refuses a token captured from another visitor without calling Supabase", async () => {
    configured();
    const victim = createOneTapNonce();
    const attacker = createOneTapNonce();
    mocks.sealed.value = "sealed";
    mocks.open.mockReturnValue(attacker.raw);

    const response = await POST(post({ credential: credential({ nonce: victim.hashed }) }));

    expect(response.status).toBe(401);
    // The pre-check exists so a stolen token never costs a provider round trip.
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("refuses a replay presented with no cookie at all", async () => {
    configured();
    const nonce = createOneTapNonce();
    mocks.open.mockReturnValue(null);

    const response = await POST(post({ credential: credential({ nonce: nonce.hashed }) }));

    expect(response.status).toBe(401);
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("forwards the RAW nonce to Supabase and burns the cookie on success", async () => {
    configured();
    const nonce = createOneTapNonce();
    mocks.sealed.value = "sealed";
    mocks.open.mockReturnValue(nonce.raw);
    mocks.signInWithIdToken.mockResolvedValue({ error: null });

    const response = await POST(post({ credential: credential({ nonce: nonce.hashed }) }));

    expect(response.status).toBe(200);
    expect(mocks.signInWithIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google", nonce: nonce.raw }),
    );
    // One nonce, one sign-in: even the legitimate browser cannot replay it.
    expect(mocks.del).toHaveBeenCalledWith("gg_onetap");
  });

  it("does not burn the nonce when the provider rejects the token", async () => {
    configured();
    const nonce = createOneTapNonce();
    mocks.sealed.value = "sealed";
    mocks.open.mockReturnValue(nonce.raw);
    mocks.signInWithIdToken.mockResolvedValue({ error: new Error("bad token") });

    const response = await POST(post({ credential: credential({ nonce: nonce.hashed }) }));

    expect(response.status).toBe(401);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it.each([
    ["not json", "not json"],
    ["missing credential", { nothing: true }],
    ["empty credential", { credential: "" }],
    ["non-string credential", { credential: 42 }],
  ])("rejects a malformed body (%s) without touching the provider", async (_label, body) => {
    configured();

    const response = await POST(post(body));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("404s when One Tap is not configured", async () => {
    // No NEXT_PUBLIC_GOOGLE_CLIENT_ID stubbed.
    const nonce = createOneTapNonce();

    const response = await POST(post({ credential: credential({ nonce: nonce.hashed }) }));

    expect(response.status).toBe(404);
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("never lets a per-visitor sign-in response be cached", async () => {
    configured();
    const nonce = createOneTapNonce();
    mocks.sealed.value = "sealed";
    mocks.open.mockReturnValue(nonce.raw);
    mocks.signInWithIdToken.mockResolvedValue({ error: null });

    const response = await POST(post({ credential: credential({ nonce: nonce.hashed }) }));

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
