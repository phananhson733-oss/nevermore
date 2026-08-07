import { afterEach, describe, expect, it, vi } from "vitest";

const deleted: { readonly name: string; readonly path: string }[] = [];
const signOutCalls: unknown[] = [];
let signOutImpl: () => Promise<unknown> = async () => ({ error: null });
let clientImpl: () => Promise<unknown> = async () => ({
  auth: {
    signOut: (options?: unknown) => {
      signOutCalls.push(options);
      return signOutImpl();
    },
  },
});

// Records the path too. A cookie is only removed when name, domain AND path
// all match what wrote it, so a mock that captures the name alone stays green
// while the real browser keeps the cookie.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    delete: (target: string | { name: string; path?: string }) => {
      deleted.push(
        typeof target === "string"
          ? { name: target, path: "/" }
          : { name: target.name, path: target.path ?? "/" },
      );
    },
  }),
}));

vi.mock("../../../../lib/supabase/server", () => ({
  createServerSupabaseClient: () => clientImpl(),
}));

const { POST } = await import("./route.ts");

afterEach(() => {
  deleted.length = 0;
  signOutCalls.length = 0;
  signOutImpl = async () => ({ error: null });
  clientImpl = async () => ({
    auth: {
      signOut: (options?: unknown) => {
        signOutCalls.push(options);
        return signOutImpl();
      },
    },
  });
});

describe("POST /api/auth/sign-out", () => {
  it("ends the session through Supabase so its own cookie attributes are matched", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { signedOut: true },
    });
    expect(signOutCalls).toHaveLength(1);
  });

  /**
   * `local`, not `global`. A header control means "sign out here"; ending the
   * session on every device the account has is a different, much larger action
   * that nothing on this page asked for.
   */
  it("signs out only this browser", () => {
    return POST().then(() => {
      expect(signOutCalls[0]).toEqual({ scope: "local" });
    });
  });

  /**
   * `gg_gsc` is written with `Path=/api` (see cookieAttributes), so it is the
   * one cookie here a default-path delete cannot reach. Since the grant now
   * holds a refresh token for up to 30 days, missing it would leave a live
   * Search Console credential in a browser whose session just ended.
   */
  it("clears the Search Console grant alongside the session, at the path that wrote it", async () => {
    await POST();
    expect(deleted).toEqual([
      { name: "gg_id", path: "/" },
      { name: "gg_gsc", path: "/api" },
      { name: "gg_sites", path: "/" },
      { name: "gg_oauth_tx", path: "/" },
    ]);
  });

  /**
   * A Supabase that throws must not strand the visitor in a signed-in shell
   * with a live Search Console grant.
   */
  it("still clears the grant cookies when Supabase is unreachable", async () => {
    clientImpl = async () => {
      throw new Error("unreachable");
    };
    const response = await POST();
    expect(response.status).toBe(200);
    expect(deleted.map((cookie) => cookie.name)).toEqual([
      "gg_id",
      "gg_gsc",
      "gg_sites",
      "gg_oauth_tx",
    ]);
  });

  it("never lets a proxy cache the response", async () => {
    const response = await POST();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
  });
});
