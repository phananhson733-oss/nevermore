// @vitest-environment jsdom
// @input  -- the profile and balance answers the header can receive
// @output -- assertions on the tri-state, and on credits being optional
// @pos    -- guards the one probe the whole header reads

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAccount, type AccountState } from "./use-account.ts";

const BALANCE_BODY = {
  data: {
    balance: { permanent: 140, daily: 0, total: 140 },
    mode: "welfare",
    dailyGrant: {
      grantedToday: true,
      amount: 20,
      welfareRemaining: 560,
      welfareCap: 600,
    },
    referral: { code: "ab3kd9xz", rewardedCount: 0, cap: 20 },
  },
};

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

function answer(status: number, body: unknown): Answer {
  return { status, body };
}

function stubFetch(profile: Answer | null, balance: Answer): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    const url = String(input);
    if (url.startsWith("/api/auth/profile")) {
      if (profile === null) throw new Error("unreachable");
      return {
        status: profile.status,
        ok: profile.status >= 200 && profile.status < 300,
        json: async () => profile.body,
      } as Response;
    }
    return {
      status: balance.status,
      ok: balance.status >= 200 && balance.status < 300,
      json: async () => balance.body,
    } as Response;
  }) as typeof fetch);
}

let host: HTMLDivElement;
let root: Root;
let seen: AccountState = { status: "unknown" };

function Probe(): null {
  seen = useAccount();
  return null;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  seen = { status: "unknown" };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<Probe />);
  });
}

describe("useAccount", () => {
  it("reports the account and its balance for a signed-in visitor", async () => {
    stubFetch(
      answer(200, { data: { email: "ada@example.test" } }),
      answer(200, BALANCE_BODY),
    );
    await mount();

    expect(seen).toEqual({
      status: "signed-in",
      email: "ada@example.test",
      avatarUrl: null,
      balance: { total: 140, welfareRemaining: 560 },
    });
  });

  /**
   * The credits switch being off must not cost the visitor their account menu:
   * signing out lives in there.
   */
  it("still reports the account when credits answer 404", async () => {
    stubFetch(
      answer(200, { data: { email: "ada@example.test" } }),
      answer(404, { error: { code: "credits_disabled" } }),
    );
    await mount();

    expect(seen).toEqual({
      status: "signed-in",
      email: "ada@example.test",
      avatarUrl: null,
      balance: null,
    });
  });

  it.each([
    ["a 401", answer(401, { error: { code: "auth_required" } })],
    ["a 503", answer(503, { error: { code: "auth_unavailable" } })],
    ["an unreachable endpoint", null],
  ])("reports signed out on %s", async (_label, profile) => {
    stubFetch(profile, answer(200, BALANCE_BODY));
    await mount();

    expect(seen).toEqual({ status: "signed-out" });
  });

  /**
   * A balance body missing its total yields null rather than zero: zero is a
   * real balance, and claiming one the account may not have is worse than
   * showing nothing.
   */
  it("refuses a balance it cannot read rather than calling it zero", async () => {
    stubFetch(
      answer(200, { data: { email: "ada@example.test" } }),
      answer(200, { data: { balance: { permanent: 1 } } }),
    );
    await mount();

    expect(seen).toMatchObject({ status: "signed-in", balance: null });
  });

  it("treats a blank address as no address", async () => {
    stubFetch(answer(200, { data: { email: "" } }), answer(200, BALANCE_BODY));
    await mount();

    expect(seen).toMatchObject({ status: "signed-in", email: null });
  });

  /** Two endpoints, deliberately: identity must not depend on the flag. */
  it("asks identity before, and separately from, the balance", async () => {
    stubFetch(
      answer(200, { data: { email: "ada@example.test" } }),
      answer(200, BALANCE_BODY),
    );
    await mount();

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(String(calls[0]?.[0])).toBe("/api/auth/profile");
    expect(String(calls[1]?.[0])).toBe("/api/credits/balance");
  });
});
