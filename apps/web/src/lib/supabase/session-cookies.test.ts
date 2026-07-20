import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface CookieToSet {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

interface CapturedServerClientOptions {
  readonly cookieOptions?: Record<string, unknown>;
  readonly cookies: {
    readonly getAll: () => unknown;
    readonly setAll: (cookies: readonly CookieToSet[]) => void;
  };
}

const mocks = vi.hoisted(() => {
  const clients: CapturedServerClientOptions[] = [];
  const cookieSet = vi.fn();
  const createServerClient = vi.fn(
    (_url: string, _key: string, options: CapturedServerClientOptions) => {
      clients.push(options);
      return {
        auth: {
          getUser: async () => {
            options.cookies.setAll([
              {
                name: "sb-project-auth-token.0",
                value: "chunk-0",
                options: {
                  httpOnly: false,
                  secure: false,
                  sameSite: "none",
                  path: "/unsafe",
                  maxAge: 60,
                },
              },
              {
                name: "sb-project-auth-token.1",
                value: "chunk-1",
                options: {
                  httpOnly: false,
                  secure: false,
                  sameSite: "strict",
                  path: "/other",
                  maxAge: 60,
                },
              },
            ]);
            return { data: { user: null } };
          },
        },
      };
    },
  );
  return { clients, cookieSet, createServerClient };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: mocks.cookieSet,
  }),
}));

vi.mock("@/env", () => ({
  getSupabaseClientEnv: () => ({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
  }),
}));

const { createSupabaseServerClient } = await import("./server.ts");
const { updateSession } = await import("./refresh.ts");

const weakCookies: readonly CookieToSet[] = [
  {
    name: "sb-project-auth-token.0",
    value: "server-chunk-0",
    options: {
      httpOnly: false,
      secure: false,
      sameSite: "none",
      path: "/unsafe",
      maxAge: 120,
    },
  },
  {
    name: "sb-project-auth-token.1",
    value: "server-chunk-1",
    options: {
      httpOnly: false,
      secure: false,
      sameSite: "strict",
      path: "/other",
      maxAge: 120,
    },
  },
];

afterEach(() => {
  mocks.clients.length = 0;
  mocks.cookieSet.mockClear();
  mocks.createServerClient.mockClear();
  vi.unstubAllEnvs();
});

function expectFixedCookieOptions(
  options: Record<string, unknown> | undefined,
  secure: boolean,
): void {
  expect(options).toMatchObject({
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });
}

describe("Supabase session cookie policy", () => {
  it("forces every server and refresh cookie chunk to HttpOnly/Secure/Lax/root in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await createSupabaseServerClient();
    const serverOptions = mocks.clients[0]!;
    expect(serverOptions.cookies.getAll()).toEqual([]);
    serverOptions.cookies.setAll(weakCookies);

    expectFixedCookieOptions(serverOptions.cookieOptions, true);
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
    for (const call of mocks.cookieSet.mock.calls) {
      expectFixedCookieOptions(call[2] as Record<string, unknown>, true);
      expect(call[2]).toMatchObject({ maxAge: 120 });
    }

    const { response } = await updateSession(
      new NextRequest("https://app.example/api/mvp/projects"),
    );
    const refreshOptions = mocks.clients[1]!;
    expect(refreshOptions.cookieOptions).toEqual(serverOptions.cookieOptions);
    expect(refreshOptions.cookies.getAll()).toHaveLength(2);

    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    for (const header of setCookies) {
      expect(header).toContain("HttpOnly");
      expect(header).toContain("Secure");
      expect(header).toContain("SameSite=lax");
      expect(header).toContain("Path=/");
      expect(header).not.toContain("Path=/unsafe");
      expect(header).not.toContain("Path=/other");
    }
  });

  it("uses the same HttpOnly/Lax/root policy without forcing Secure in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    await createSupabaseServerClient();
    const serverOptions = mocks.clients[0]!;
    expect(serverOptions.cookies.getAll()).toEqual([]);
    serverOptions.cookies.setAll(weakCookies);

    expectFixedCookieOptions(serverOptions.cookieOptions, false);
    for (const call of mocks.cookieSet.mock.calls) {
      expectFixedCookieOptions(call[2] as Record<string, unknown>, false);
    }

    const { response } = await updateSession(
      new NextRequest("http://localhost:3000/api/mvp/projects"),
    );
    const refreshOptions = mocks.clients[1]!;
    expect(refreshOptions.cookieOptions).toEqual(serverOptions.cookieOptions);
    expect(refreshOptions.cookies.getAll()).toHaveLength(2);

    for (const header of response.headers.getSetCookie()) {
      expect(header).toContain("HttpOnly");
      expect(header).not.toContain("Secure");
      expect(header).toContain("SameSite=lax");
      expect(header).toContain("Path=/");
    }
  });
});
