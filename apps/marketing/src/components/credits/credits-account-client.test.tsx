// @vitest-environment jsdom
// @input  -- the balance and ledger answers the account page can receive
// @output -- proof of the four blocks, the two refusals, and human ledger reasons
// @pos    -- the guard on the only page that shows a visitor their own credits

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { CreditsAccountClient } from "./credits-account-client.tsx";

const BALANCE = {
  data: {
    balance: { permanent: 120, daily: 0, total: 120 },
    mode: "welfare",
    dailyGrant: { grantedToday: true, amount: 20, welfareRemaining: 480 },
    referral: { code: "ab3kd9xz", rewardedCount: 3, cap: 20 },
  },
};

const FIRST_PAGE = {
  data: {
    entries: [
      {
        id: "2",
        type: "daily_grant",
        amount: 20,
        balanceAfter: 120,
        toolSlug: null,
        createdAt: "2026-08-17T02:00:00.000Z",
      },
      {
        id: "1",
        type: "signup_bonus",
        amount: 100,
        balanceAfter: 100,
        toolSlug: null,
        createdAt: "2026-08-16T09:30:00.000Z",
      },
    ],
    nextCursor: "2026-08-16T09:30:00.000Z|1",
  },
};

const SECOND_PAGE = {
  data: {
    entries: [
      {
        id: "0",
        type: "referral_reward_inviter",
        amount: 50,
        balanceAfter: 50,
        toolSlug: "quick-wins",
        createdAt: "2026-08-15T08:00:00.000Z",
      },
    ],
    nextCursor: null,
  },
};

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

function answer(status: number, body: unknown): Answer {
  return { status, body };
}

/** Serves the balance once and the ledger pages in the order they are asked for. */
function stubFetch(balance: Answer, ledger: readonly Answer[]): void {
  let page = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : String(input);
    const served = url.startsWith("/api/credits/balance")
      ? balance
      : (ledger[page++] ?? answer(503, null));
    return {
      status: served.status,
      ok: served.status >= 200 && served.status < 300,
      json: async () => served.body,
    } as Response;
  });
}

describe("CreditsAccountClient", () => {
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

  async function mount(locale: "en" | "zh" = "en"): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale={locale}
          messages={locale === "en" ? en : zh}
        >
          <CreditsAccountClient />
        </NextIntlClientProvider>,
      );
    });
  }

  it("shows the balance, the check-in, the invite link and the history", async () => {
    stubFetch(answer(200, BALANCE), [answer(200, FIRST_PAGE)]);
    await mount();

    const text = host.textContent ?? "";
    expect(text).toContain(en.credits.account.balanceLabel);
    expect(text).toContain("120");
    expect(text).toContain(en.credits.account.welfareNotice);
    expect(text).toContain(en.credits.account.dailyTitle);
    expect(text).toContain("+20 added today");
    expect(text).toContain("480 of 600 testing credits left to earn");
    expect(text).toContain(en.credits.account.referralTitle);
    expect(text).toContain("https://gengrowth.ai/r/ab3kd9xz");
    expect(text).toContain("3 of 20 invites rewarded");
    expect(text).toContain(en.credits.account.ledgerTitle);
    expect(text).toContain("2026-08-17");
  });

  it("says tomorrow rather than today when nothing was granted yet", async () => {
    stubFetch(
      answer(200, {
        data: {
          ...BALANCE.data,
          dailyGrant: { grantedToday: false, amount: 20, welfareRemaining: 500 },
        },
      }),
      [answer(200, FIRST_PAGE)],
    );
    await mount();

    expect(host.textContent).toContain("Sign in tomorrow for +20 more");
    expect(host.textContent).not.toContain("+20 added today");
  });

  /**
   * An entry type is a database enum. Rendering one would show a reader
   * `referral_reward_invitee` where the reason for a credit belongs.
   */
  it("renders every ledger reason as words, never as the stored enum", async () => {
    stubFetch(answer(200, BALANCE), [answer(200, FIRST_PAGE)]);
    await mount();

    const text = host.textContent ?? "";
    expect(text).toContain(en.credits.account.entry.daily_grant);
    expect(text).toContain(en.credits.account.entry.signup_bonus);
    expect(text).toContain("+100");
    expect(text).toContain("Balance 120");
    expect(text).not.toContain("signup_bonus");
    expect(text).not.toContain("daily_grant");
  });

  it("falls back to a neutral reason for a type this build does not know", async () => {
    stubFetch(answer(200, BALANCE), [
      answer(200, {
        data: {
          entries: [
            {
              id: "9",
              type: "chargeback_clawback",
              amount: -10,
              balanceAfter: 110,
              toolSlug: null,
              createdAt: "2026-08-17T03:00:00.000Z",
            },
          ],
          nextCursor: null,
        },
      }),
    ]);
    await mount();

    expect(host.textContent).toContain(en.credits.account.entryFallback);
    expect(host.textContent).not.toContain("chargeback_clawback");
    expect(host.textContent).toContain("-10");
  });

  it("appends the next page and drops the button at the end of the history", async () => {
    stubFetch(answer(200, BALANCE), [
      answer(200, FIRST_PAGE),
      answer(200, SECOND_PAGE),
    ]);
    await mount();

    const more = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === en.credits.account.ledgerMore,
    );
    expect(more).toBeDefined();

    await act(async () => {
      more?.click();
    });

    expect(host.textContent).toContain(
      en.credits.account.entry.referral_reward_inviter,
    );
    // The first page is still there: paging appends history, it does not
    // replace it.
    expect(host.textContent).toContain(en.credits.account.entry.signup_bonus);
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === en.credits.account.ledgerMore,
      ),
    ).toBe(false);
  });

  it("asks for the next page with the cursor the ledger handed back", async () => {
    stubFetch(answer(200, BALANCE), [
      answer(200, FIRST_PAGE),
      answer(200, SECOND_PAGE),
    ]);
    await mount();

    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === en.credits.account.ledgerMore)
        ?.click();
    });

    const urls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map((call) => String(call[0]));
    expect(urls).toContain(
      "/api/credits/ledger?cursor=2026-08-16T09%3A30%3A00.000Z%7C1",
    );
  });

  it("shows an empty history rather than a broken one", async () => {
    stubFetch(answer(200, BALANCE), [
      answer(200, { data: { entries: [], nextCursor: null } }),
    ]);
    await mount();

    expect(host.textContent).toContain(en.credits.account.ledgerEmpty);
  });

  it("says the history is unavailable when only the ledger fails", async () => {
    stubFetch(answer(200, BALANCE), [answer(503, null)]);
    await mount();

    // The balance still arrived, so the page keeps showing it rather than
    // hiding a number the visitor came for.
    expect(host.textContent).toContain("120");
    expect(host.textContent).toContain(en.credits.account.unavailable);
    expect(host.textContent).not.toContain(en.credits.account.ledgerEmpty);
  });

  it("asks a signed-out visitor to sign in", async () => {
    stubFetch(answer(401, { error: { code: "auth_required" } }), [
      answer(401, { error: { code: "auth_required" } }),
    ]);
    await mount();

    expect(host.textContent).toBe(en.credits.account.signedOut);
  });

  it.each([
    ["the store is not there yet", 503],
    ["the feature switch is off", 404],
    ["the visitor is polling too fast", 429],
  ])("reports credits as unavailable when %s", async (_case, status) => {
    stubFetch(answer(status, { error: { code: "credits_unavailable" } }), [
      answer(status, null),
    ]);
    await mount();

    expect(host.textContent).toBe(en.credits.account.unavailable);
  });

  it("reports credits as unavailable when the endpoint cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await mount();

    expect(host.textContent).toBe(en.credits.account.unavailable);
  });

  it("copies the invite link and says so", async () => {
    stubFetch(answer(200, BALANCE), [answer(200, FIRST_PAGE)]);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await mount();

    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === en.credits.account.referralCopy)
        ?.click();
    });

    expect(writeText).toHaveBeenCalledWith("https://gengrowth.ai/r/ab3kd9xz");
    expect(host.textContent).toContain(en.credits.account.referralCopied);
  });

  it("renders the Chinese copy for a zh reader", async () => {
    stubFetch(answer(200, BALANCE), [answer(200, FIRST_PAGE)]);
    await mount("zh");

    const text = host.textContent ?? "";
    expect(text).toContain(zh.credits.account.welfareNotice);
    expect(text).toContain(zh.credits.account.entry.signup_bonus);
    expect(text).not.toContain(en.credits.account.welfareNotice);
  });
});
