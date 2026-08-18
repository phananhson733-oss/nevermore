// @vitest-environment jsdom
// @input  -- an injected account state and the en catalog
// @output -- proof of the avatar, the panel's contents, and the two refusals
// @pos    -- guards the signed-in half of the header's right-hand slot

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import type { AccountState } from "../../lib/auth/use-account.ts";
import { AccountMenu, AccountSummaryMobile } from "./account-menu.tsx";

const SIGNED_IN: AccountState = {
  status: "signed-in",
  email: "ada@example.test",
  avatarUrl: null,
  balance: { total: 140, welfareRemaining: 560 },
};

const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocABC123=s96-c";

describe("AccountMenu", () => {
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

  async function mount(account: AccountState): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AccountMenu account={account} />
        </NextIntlClientProvider>,
      );
    });
  }

  function avatar(): HTMLButtonElement {
    const button = host.querySelector("button");
    if (button === null) throw new Error("no avatar rendered");
    return button as HTMLButtonElement;
  }

  async function open(): Promise<void> {
    await act(async () => {
      avatar().click();
    });
  }

  /**
   * "unknown" is the first moment after hydration. Drawing an avatar there
   * would flash a control for an account we do not yet know exists, which is
   * the mirror of the sign-in flash the header has always avoided.
   */
  it.each([
    ["signed out", { status: "signed-out" } as const],
    ["the answer has not arrived", { status: "unknown" } as const],
  ])("renders nothing at all when %s", async (_label, account) => {
    await mount(account);

    expect(host.textContent).toBe("");
    expect(host.querySelector("button")).toBeNull();
  });

  it("shows the account's initial once a session is known", async () => {
    await mount(SIGNED_IN);

    expect(avatar().textContent).toBe("A");
    // Closed until asked for: the panel is not in the document.
    expect(host.textContent).not.toContain("ada@example.test");
    expect(avatar().getAttribute("aria-expanded")).toBe("false");
  });

  /**
   * Google ships these URLs already ending in `=s96-c`. Appending rather than
   * replacing yields `=s96-c=s72-c-rw`, which Google answers 400 — a broken
   * image for every signed-in visitor instead of a merely oversized one.
   */
  it("replaces Google's size options instead of appending to them", async () => {
    await mount({ ...SIGNED_IN, avatarUrl: PHOTO });

    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "https://lh3.googleusercontent.com/a/ACg8ocABC123=s72-c-rw",
    );
    // Not two option groups.
    expect(img?.getAttribute("src")?.match(/=/g)).toHaveLength(1);
  });

  it("adds the size options to a URL that carries none", async () => {
    await mount({
      ...SIGNED_IN,
      avatarUrl: "https://lh3.googleusercontent.com/a/plain",
    });

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "https://lh3.googleusercontent.com/a/plain=s72-c-rw",
    );
  });

  /** Hotlinked from a third-party origin; Google does not need our referer. */
  it("sends no referer with the photo", async () => {
    await mount({ ...SIGNED_IN, avatarUrl: PHOTO });

    expect(host.querySelector("img")?.getAttribute("referrerpolicy")).toBe(
      "no-referrer",
    );
  });

  /**
   * One production account signed in without Google and has no photo at all,
   * so the monogram is the ordinary path rather than only the error path.
   */
  it("draws the monogram when the account has no photo", async () => {
    await mount(SIGNED_IN);

    expect(host.querySelector("img")).toBeNull();
    expect(avatar().textContent).toBe("A");
  });

  it("falls back to the monogram when the photo fails to load", async () => {
    await mount({ ...SIGNED_IN, avatarUrl: PHOTO });
    expect(host.querySelector("img")).not.toBeNull();

    await act(async () => {
      host.querySelector("img")?.dispatchEvent(new Event("error"));
    });

    expect(host.querySelector("img")).toBeNull();
    expect(avatar().textContent).toBe("A");
  });

  /** The button already carries the account as its accessible name. */
  it("leaves the photo out of the accessibility tree", async () => {
    await mount({ ...SIGNED_IN, avatarUrl: PHOTO });

    expect(host.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(avatar().getAttribute("aria-label")).toBe("ada@example.test");
  });

  it("names the account and its balance once opened", async () => {
    await mount(SIGNED_IN);
    await open();

    const text = host.textContent ?? "";
    expect(text).toContain("ada@example.test");
    expect(text).toContain("140");
    expect(text).toContain("560 left to earn while testing");
    expect(text).toContain(en.account.menu.ledger);
    expect(text).toContain(en.common.signOut);
    expect(avatar().getAttribute("aria-expanded")).toBe("true");
  });

  /**
   * /api/credits/balance is 404 while the credits switch is off. The menu is
   * how a signed-in visitor signs out, so it cannot be hostage to that flag.
   */
  it("still names the account and offers sign-out with credits switched off", async () => {
    await mount({ ...SIGNED_IN, balance: null });
    await open();

    const text = host.textContent ?? "";
    expect(text).toContain("ada@example.test");
    expect(text).toContain(en.common.signOut);
    expect(text).not.toContain("140");
    expect(text).not.toContain(en.account.menu.balance);
  });

  it("opens on hover, for the pointer users the design is aimed at", async () => {
    await mount(SIGNED_IN);

    await act(async () => {
      avatar().parentElement?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });

    expect(host.textContent).toContain("ada@example.test");
  });

  it("closes on Escape", async () => {
    await mount(SIGNED_IN);
    await open();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(host.textContent).not.toContain("ada@example.test");
  });

  it("closes when the pointer goes somewhere else on the page", async () => {
    await mount(SIGNED_IN);
    await open();

    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(host.textContent).not.toContain("ada@example.test");
  });

  /** A session with no address still has an account to leave. */
  it("falls back to a placeholder glyph when the session carries no address", async () => {
    await mount({ ...SIGNED_IN, email: null });
    await open();

    expect(avatar().textContent).toBe("•");
    expect(host.textContent).toContain(en.common.signOut);
  });

  it("ends the session when sign-out is chosen", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });

    await mount(SIGNED_IN);
    await open();

    const signOutButton = [...host.querySelectorAll("button")].find((node) =>
      (node.textContent ?? "").includes(en.common.signOut),
    );
    await act(async () => {
      signOutButton?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
    });
  });
});

describe("AccountSummaryMobile", () => {
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

  async function mount(account: AccountState): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AccountSummaryMobile account={account} onNavigate={() => {}} />
        </NextIntlClientProvider>,
      );
    });
  }

  /**
   * The header badge that used to carry the balance on every screen is gone,
   * and a hover panel means nothing on a touchscreen. Without this row a phone
   * has no way to see the balance at all.
   */
  it("shows the balance without needing a hover", async () => {
    await mount(SIGNED_IN);

    const text = host.textContent ?? "";
    expect(text).toContain("ada@example.test");
    expect(text).toContain("140");
  });

  it("renders nothing for a signed-out reader", async () => {
    await mount({ status: "signed-out" });

    expect(host.textContent).toBe("");
  });

  /**
   * Sign-out reads after the account has been named, not before. The other way
   * round the sheet offered to sign you out before saying whose session it was.
   */
  it("offers sign-out below the account it names", async () => {
    await mount(SIGNED_IN);

    const text = host.textContent ?? "";
    expect(text).toContain(en.common.signOut);
    expect(text.indexOf("ada@example.test")).toBeLessThan(
      text.indexOf(en.common.signOut),
    );
  });

  it("ends the session when sign-out is chosen", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });

    await mount(SIGNED_IN);
    const button = [...host.querySelectorAll("button")].find((node) =>
      (node.textContent ?? "").includes(en.common.signOut),
    );
    await act(async () => {
      button?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
    });
  });
});
