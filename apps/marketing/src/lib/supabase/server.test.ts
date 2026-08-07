import { afterEach, describe, expect, it, vi } from "vitest";

interface CookieToSet {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

interface CapturedClient {
  readonly cookieOptions?: Record<string, unknown>;
  readonly cookies: {
    readonly getAll: () => unknown;
    readonly setAll: (cookies: readonly CookieToSet[]) => void;
  };
}

const mocks = vi.hoisted(() => {
  const clients: CapturedClient[] = [];
  return {
    clients,
    set: vi.fn(),
    createServerClient: vi.fn(
      (_url: string, _key: string, options: CapturedClient) => {
        clients.push(options);
        return {};
      },
    ),
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: mocks.set }),
}));

const { createServerSupabaseClient } = await import("./server.ts");

afterEach(() => {
  mocks.clients.length = 0;
  mocks.set.mockClear();
  vi.unstubAllEnvs();
});

/**
 * The cookie policy as it reaches the client, not as the helper returns it.
 *
 * session-cookie-options.ts is unit tested as a pure function, but every one of
 * those tests still passes if this module stops passing the result to Supabase.
 * The equivalent web-app test caught exactly that class of regression, and this
 * is the marketing half of the same guarantee: sign-in starts HERE, so if the
 * domain never reaches the emitted cookie, a visitor signs in on gengrowth.ai
 * and arrives at app.gengrowth.ai logged out.
 */
describe("marketing Supabase server client", () => {
  it("scopes the session to the registrable domain", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_DOMAIN", "gengrowth.ai");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");

    await createServerSupabaseClient();

    expect(mocks.clients[0]!.cookieOptions).toMatchObject({
      domain: "gengrowth.ai",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("hardens every chunk it writes, overriding weaker library attributes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_DOMAIN", "gengrowth.ai");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");

    await createServerSupabaseClient();
    mocks.clients[0]!.cookies.setAll([
      {
        name: "sb-auth.0",
        value: "chunk-0",
        options: {
          httpOnly: false,
          secure: false,
          sameSite: "none",
          path: "/unsafe",
          maxAge: 120,
        },
      },
    ]);

    expect(mocks.set).toHaveBeenCalledWith(
      "sb-auth.0",
      "chunk-0",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        domain: "gengrowth.ai",
        // Supabase's own expiry metadata survives.
        maxAge: 120,
      }),
    );
  });

  it("stays host-only when no domain is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");

    await createServerSupabaseClient();

    expect("domain" in mocks.clients[0]!.cookieOptions!).toBe(false);
  });
});
