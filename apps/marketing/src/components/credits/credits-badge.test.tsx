// @vitest-environment jsdom
// @input  -- every answer /api/credits/balance can give the header
// @output -- proof the badge shows a balance and stays silent about anything else
// @pos    -- the guard on the one credits surface anonymous readers can reach

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { CreditsBadge } from "./credits-badge.tsx";

const BALANCE = {
  data: {
    balance: { permanent: 120, daily: 0, total: 120 },
    mode: "welfare",
    dailyGrant: { grantedToday: true, amount: 20, welfareRemaining: 480 },
    referral: { code: "ab3kd9xz", rewardedCount: 0, cap: 20 },
  },
};

describe("CreditsBadge", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function mount(
    answer: { readonly ok: boolean; readonly body?: unknown },
    locale: "en" | "zh" = "en",
  ): Promise<void> {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: answer.ok,
      json: async () => answer.body ?? {},
    } as Response);
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale={locale}
          messages={locale === "en" ? en : zh}
        >
          <CreditsBadge />
        </NextIntlClientProvider>,
      );
    });
  }

  it("renders nothing while the balance is still unknown", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <CreditsBadge />
        </NextIntlClientProvider>,
      );
    });

    expect(host.innerHTML).toBe("");
  });

  it("shows the total and links to the account page", async () => {
    await mount({ ok: true, body: BALANCE });

    expect(host.textContent).toContain(en.credits.badge.label);
    expect(host.textContent).toContain("120");
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "/account/credits",
    );
  });

  it("keeps the zh prefix on the account link", async () => {
    await mount({ ok: true, body: BALANCE }, "zh");

    expect(host.textContent).toContain(zh.credits.badge.label);
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "/zh/account/credits",
    );
  });

  it("says today is already checked in only when it is", async () => {
    await mount({ ok: true, body: BALANCE });
    expect(host.textContent).toContain(en.credits.badge.checkedIn);

    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({
      ok: true,
      body: {
        data: {
          ...BALANCE.data,
          dailyGrant: { ...BALANCE.data.dailyGrant, grantedToday: false },
        },
      },
    });
    expect(host.textContent).not.toContain(en.credits.badge.checkedIn);
  });

  /**
   * The three ways this endpoint says no are all ordinary: 404 while the switch
   * is off, 401 for a reader who never signed in, 503 before the owner applies
   * the migration. None of them is news the header should break to deliver.
   */
  it.each([
    [
      "the feature switch is off",
      { ok: false, body: { error: { code: "credits_disabled" } } },
    ],
    [
      "nobody is signed in",
      { ok: false, body: { error: { code: "auth_required" } } },
    ],
    [
      "the store is unavailable",
      { ok: false, body: { error: { code: "credits_unavailable" } } },
    ],
  ])("renders nothing when %s", async (_case, answer) => {
    await mount(answer);

    expect(host.innerHTML).toBe("");
    expect(host.textContent).not.toContain(en.credits.badge.unavailable);
  });

  it("renders nothing when the balance endpoint is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <CreditsBadge />
        </NextIntlClientProvider>,
      );
    });

    expect(host.innerHTML).toBe("");
  });

  // A body without a total is not a balance of zero. Drawing one would tell a
  // reader with credits that they have none.
  it("renders nothing when the answer carries no total", async () => {
    await mount({ ok: true, body: { data: { balance: {} } } });

    expect(host.innerHTML).toBe("");
  });

  it("abandons the request when the header unmounts", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValue(new Promise(() => {}));

    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <CreditsBadge />
        </NextIntlClientProvider>,
      );
    });
    const signal = (fetchSpy.mock.calls[0]?.[1] as RequestInit)
      .signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => root.unmount());
    root = createRoot(host);

    expect(signal.aborted).toBe(true);
  });
});
