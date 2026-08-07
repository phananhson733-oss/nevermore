import { afterEach, describe, expect, it, vi } from "vitest";

const deleted: string[] = [];
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

vi.mock("next/headers", () => ({
  cookies: async () => ({
    delete: (name: string) => {
      deleted.push(name);
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

  it("clears the Search Console grant alongside the session", async () => {
    await POST();
    expect(deleted).toEqual(["gg_id", "gg_gsc", "gg_sites", "gg_oauth_tx"]);
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
    expect(deleted).toEqual(["gg_id", "gg_gsc", "gg_sites", "gg_oauth_tx"]);
  });

  it("never lets a proxy cache the response", async () => {
    const response = await POST();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
  });
});
