import { afterEach, describe, expect, it, vi } from "vitest";

// See route.test.ts: `@/` resolves to apps/web/src under vitest, so the
// alias the route imports is filled with the real marketing module.
import * as oneTap from "../../../../../lib/auth/one-tap.ts";

const { hashNonce } = oneTap;

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  seal: vi.fn((_purpose: string, data: unknown) => `sealed:${String(data)}`),
  cookieAttributes: vi.fn(() => ({ httpOnly: true, path: "/" })),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.set }),
}));

vi.mock("../../../../../lib/auth/sealed-cookie", () => ({
  seal: mocks.seal,
  cookieAttributes: mocks.cookieAttributes,
}));

const { GET } = await import("./route.ts");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

/**
 * The nonce issuer.
 *
 * The security property is asymmetric on purpose: the browser may only ever
 * learn the HASH, while the raw value stays in an HttpOnly cookie. If the raw
 * value ever reached the response body, holding a stolen id_token would be
 * enough on its own and the replay binding would be decorative.
 */
describe("GET /api/auth/one-tap/nonce", () => {
  it("returns the hash and never the raw nonce", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");

    const response = await GET();
    const body = (await response.json()) as { nonce: string };

    expect(response.status).toBe(200);
    expect(body.nonce).toMatch(/^[0-9a-f]{64}$/);

    // Whatever raw value was sealed must not appear in the response.
    const sealedRaw = mocks.seal.mock.calls[0]![1] as string;
    expect(await new Response(JSON.stringify(body)).text()).not.toContain(
      sealedRaw,
    );
    // And the value handed to the browser must be the hash OF that raw nonce.
    expect(body.nonce).toBe(hashNonce(sealedRaw));
  });

  it("seals the raw nonce into an HttpOnly cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");

    await GET();

    expect(mocks.seal).toHaveBeenCalledWith(
      "gg_onetap",
      expect.any(String),
      expect.any(Number),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      "gg_onetap",
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("is never cached, because a shared nonce breaks the binding", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");

    const response = await GET();

    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("mints a different nonce on every call", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");

    const first = (await (await GET()).json()) as { nonce: string };
    const second = (await (await GET()).json()) as { nonce: string };

    expect(first.nonce).not.toBe(second.nonce);
  });

  it("404s and issues no cookie when One Tap is not configured", async () => {
    const response = await GET();

    expect(response.status).toBe(404);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
