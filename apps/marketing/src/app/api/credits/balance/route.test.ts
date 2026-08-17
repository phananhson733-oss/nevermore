// @input  -- GET /api/credits/balance driven through every gate it can stop at
// @output -- assertions pinning the status, the error code, the body and the cache header
// @pos    -- guards the endpoint the header badge polls

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAuthenticatedUser: vi.fn(),
  consumePublicToolQuota: vi.fn(),
  ensureAccount: vi.fn(),
  touchDaily: vi.fn(),
  referralCookie: null as string | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "gg_ref" && mocks.referralCookie !== null
        ? { name, value: mocks.referralCookie }
        : undefined,
  }),
}));

vi.mock("../../../../lib/auth/server-auth-user.ts", () => ({
  getServerAuthenticatedUser: mocks.getServerAuthenticatedUser,
}));

vi.mock("../../../../lib/credits/credits-store.ts", () => ({
  ensureAccount: mocks.ensureAccount,
  touchDaily: mocks.touchDaily,
}));

vi.mock("../../../../lib/tools/shared-rate-limit.ts", () => ({
  consumePublicToolQuota: mocks.consumePublicToolQuota,
}));

const { GET } = await import("./route.ts");

const TODAY = new Date().toISOString().slice(0, 10);

function account(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    value: {
      userId: "user-1",
      status: "active",
      dailyBalance: 0,
      permanentBalance: 120,
      totalBalance: 120,
      dailyGrantedOn: TODAY,
      dailyAccruedTotal: 120,
      referralCode: "ab3kd9xz",
      referredBy: null,
      referralRewardedCount: 0,
      firstToolRunAt: null,
      created: false,
      attributed: false,
      ...overrides,
    },
  };
}

function touch(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    value: {
      mode: "welfare",
      granted: 20,
      dailyBalance: 0,
      permanentBalance: 120,
      totalBalance: 120,
      dailyAccruedTotal: 120,
      dailyAmount: 20,
      welfareAccrualCap: 600,
      welfareRemaining: 480,
      dailyGrantedOn: TODAY,
      referralInviterCap: 20,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.stubEnv("MARKETING_CREDITS_ENABLED", "true");
  mocks.referralCookie = null;
  mocks.getServerAuthenticatedUser.mockResolvedValue({
    status: "authenticated",
    userId: "user-1",
  });
  mocks.consumePublicToolQuota.mockResolvedValue({ kind: "allowed", hits: 1 });
  mocks.ensureAccount.mockResolvedValue(account());
  mocks.touchDaily.mockResolvedValue(touch());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/credits/balance", () => {
  it("is not there at all while the feature is switched off", async () => {
    vi.stubEnv("MARKETING_CREDITS_ENABLED", "");

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "credits_disabled" },
    });
    // The flag has to be decided before anything else runs, or a disabled
    // feature still creates accounts.
    expect(mocks.getServerAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("answers 401 for a visitor who is not signed in", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unauthenticated",
    });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
  });

  /**
   * An auth service that cannot answer is not a signed-out visitor. Reporting
   * 401 would tell the badge to render a sign-in prompt to someone who is
   * already signed in, and nothing may be written against an unverified id.
   */
  it("answers 503 when auth itself cannot answer", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unavailable",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
  });

  it("meters the badge per user, not per address", async () => {
    await GET();

    expect(mocks.consumePublicToolQuota).toHaveBeenCalledWith(
      "credits-balance:user:user-1",
      30,
      3_600,
    );
  });

  it("answers 429 with Retry-After once the per-user budget is spent", async () => {
    mocks.consumePublicToolQuota.mockResolvedValue({
      kind: "limited",
      retryAfterSeconds: 42,
    });

    const response = await GET();

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: "rate_limited" },
    });
    expect(response.headers.get("retry-after")).toBe("42");
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
  });

  /**
   * Deliberately not fail-closed, unlike the crawl gate: a limiter outage here
   * would make the balance disappear from the header for every signed-in
   * visitor, and there is no external spend behind this endpoint to protect.
   */
  it("still serves the balance when the limiter store is down", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.consumePublicToolQuota.mockResolvedValue({
      kind: "unavailable",
      reason: "quota store failed",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(logged).toHaveBeenCalledWith(
      "[credits-balance] rate limiter unavailable:",
      "quota store failed",
    );
  });

  it("answers 503 when the credits tables are not there yet", async () => {
    mocks.ensureAccount.mockResolvedValue({
      kind: "unavailable",
      reason: "store_missing",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "credits_unavailable" },
    });
    expect(mocks.touchDaily).not.toHaveBeenCalled();
  });

  /**
   * ensureAccount has just created the row, so a daily touch that reports no
   * account is the store contradicting itself — not a state to render.
   */
  it("answers 503 when the daily touch cannot find the account it just created", async () => {
    mocks.touchDaily.mockResolvedValue({ kind: "missing" });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "credits_unavailable" },
    });
  });

  it("answers 503 when the daily touch fails", async () => {
    mocks.touchDaily.mockResolvedValue({
      kind: "unavailable",
      reason: "connection refused",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "credits_unavailable" },
    });
  });

  it("returns the balance, the mode, today's grant and the referral state", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        balance: { permanent: 120, daily: 0, total: 120 },
        mode: "welfare",
        dailyGrant: { grantedToday: true, amount: 20, welfareRemaining: 480 },
        referral: { code: "ab3kd9xz", rewardedCount: 0, cap: 20 },
      },
    });
  });

  /**
   * A capped account is granted nothing and has still been granted today.
   * Reading `granted` alone would keep telling it to come back for a grant it
   * can never receive.
   */
  it("counts a capped account as granted today", async () => {
    mocks.touchDaily.mockResolvedValue(
      touch({ granted: 0, welfareRemaining: 0, dailyGrantedOn: TODAY }),
    );

    const response = await GET();
    const body = await response.json();

    expect(body.data.dailyGrant.grantedToday).toBe(true);
  });

  it("reports a stale grant date as not granted today", async () => {
    mocks.touchDaily.mockResolvedValue(
      touch({ granted: 0, dailyGrantedOn: "2026-01-01" }),
    );

    const response = await GET();
    const body = await response.json();

    expect(body.data.dailyGrant.grantedToday).toBe(false);
  });

  it("reports a frozen account that has never been granted as not granted today", async () => {
    mocks.touchDaily.mockResolvedValue(
      touch({ granted: 0, dailyGrantedOn: null }),
    );

    const response = await GET();
    const body = await response.json();

    expect(body.data.dailyGrant.grantedToday).toBe(false);
  });

  it("hands the remembered referral code to the account upsert", async () => {
    mocks.referralCookie = "ab3kd9xz";

    await GET();

    expect(mocks.ensureAccount).toHaveBeenCalledWith("user-1", "ab3kd9xz");
  });

  /**
   * The cookie is HttpOnly but the header is still whatever the client sends,
   * so what reaches the RPC is validated here rather than trusted.
   */
  it("ignores a gg_ref cookie that could never have been issued", async () => {
    mocks.referralCookie = "../../etc/passwd";

    await GET();

    expect(mocks.ensureAccount).toHaveBeenCalledWith("user-1", null);
  });

  it("clears the referral cookie once the attribution has stuck", async () => {
    mocks.referralCookie = "ab3kd9xz";
    mocks.ensureAccount.mockResolvedValue(
      account({ referredBy: "inviter-1", attributed: true }),
    );

    const response = await GET();
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("gg_ref=");
    expect(setCookie).toContain("Max-Age=0");
    // The path has to match the one that wrote it or the delete is a no-op and
    // the cookie rides along on every request for another thirty days.
    expect(setCookie).toContain("Path=/");
  });

  /**
   * Attribution is one-shot in SQL: an account that already had a referrer
   * keeps it. Clearing the cookie on that response would throw away a code the
   * visitor might still legitimately use on a second account they own.
   */
  it("keeps the cookie when the code did not become this account's referrer", async () => {
    mocks.referralCookie = "ab3kd9xz";
    // The account already belongs to someone else's invite. referredBy is
    // non-null here on purpose: reading it instead of `attributed` is exactly
    // the bug, and a fixture with referredBy: null could never catch it.
    mocks.ensureAccount.mockResolvedValue(
      account({ referredBy: "an-earlier-inviter", attributed: false }),
    );

    const response = await GET();

    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets no cookie at all when the visitor arrived without one", async () => {
    mocks.ensureAccount.mockResolvedValue(
      account({ referredBy: "inviter-1", attributed: true }),
    );

    const response = await GET();

    expect(response.headers.get("set-cookie")).toBeNull();
  });

  /**
   * This GET writes — it grants the day lazily — and every field in it belongs
   * to one signed-in visitor. A shared cache anywhere on the path would serve
   * one person's balance to another.
   */
  it("keeps every answer, including the failures, off every cache", async () => {
    const responses = [await GET()];

    mocks.ensureAccount.mockResolvedValue({
      kind: "unavailable",
      reason: "store_missing",
    });
    responses.push(await GET());

    mocks.consumePublicToolQuota.mockResolvedValue({
      kind: "limited",
      retryAfterSeconds: 42,
    });
    responses.push(await GET());

    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unauthenticated",
    });
    responses.push(await GET());

    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unavailable",
    });
    responses.push(await GET());

    vi.stubEnv("MARKETING_CREDITS_ENABLED", "");
    responses.push(await GET());

    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store, private");
    }
  });
});
