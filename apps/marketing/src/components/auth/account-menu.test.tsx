// @vitest-environment jsdom
// @input  -- an injected account state and the en catalog
// @output -- proof of the avatar, the panel's contents, and the two refusals
// @pos    -- guards the signed-in half of the header's right-hand slot

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import type { AccountState } from "../../lib/auth/use-account.ts";
import { AccountMenu, AccountSummaryMobile } from "./account-menu.tsx";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account/websites",
  useRouter: () => ({ push: vi.fn() }),
}));

const PRIMARY_WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SIGNED_IN: AccountState = {
  status: "signed-in",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  avatarUrl: null,
  balance: { total: 140, welfareRemaining: 560 },
  websites: {
    status: "ready",
    primary: {
      websiteId: PRIMARY_WEBSITE_ID,
      origin: "https://example.com",
      host: "example.com",
      canonicalSiteKey: "example.com",
      displayName: "Example",
      isPrimary: true,
      profileState: "confirmed",
      confirmedSnapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
      confirmedSnapshotRevision: 1,
      confirmedAt: "2026-08-28T00:00:00.000Z",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    },
  },
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
    expect(avatar().getAttribute("aria-label")).toBe("Ada Lovelace");
  });

  it("names the account and its balance once opened", async () => {
    await mount(SIGNED_IN);
    await open();

    const text = host.textContent ?? "";
    expect(text).toContain("ada@example.test");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("140");
    expect(text).not.toContain("560 left to earn while testing");
    expect(text).toContain(en.account.menu.upgrade);
    expect(text).toContain(en.account.menu.credits);
    expect(text).toContain("Example");
    expect(text).toContain(en.account.menu.settings);
    expect(text).toContain(en.account.menu.agents);
    expect(text).toContain(en.account.menu.referral);
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
    expect(text).toContain(en.account.menu.upgrade);
    expect(text).toContain(en.account.menu.credits);
  });

  it("keeps the approved destinations in order and omits placeholders", async () => {
    await mount(SIGNED_IN);
    await open();

    const text = host.textContent ?? "";
    const ordered = [
      "Ada Lovelace",
      "ada@example.test",
      "Example",
      en.account.menu.settings,
      en.account.menu.agents,
      "中文",
      en.account.menu.referral,
      en.common.signOut,
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(text.indexOf(ordered[index - 1] ?? "")).toBeLessThan(
        text.indexOf(ordered[index] ?? ""),
      );
    }
    expect(text).not.toMatch(/Integrations|Docs|Team/u);
    expect(
      host.querySelector(
        'a[href="/account/websites/' +
          PRIMARY_WEBSITE_ID +
          '"]',
      ),
    ).not.toBeNull();
  });

  it("routes Upgrade to pricing before Credits and closes after activation", async () => {
    await mount(SIGNED_IN);
    await open();

    const menuItems = [
      ...host.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    const upgrade = host.querySelector<HTMLAnchorElement>('a[href="/pricing"]');
    const credits = host.querySelector<HTMLAnchorElement>(
      'a[href="/account/credits"]',
    );
    const balancePill = upgrade?.previousElementSibling;

    expect(upgrade?.textContent).toContain(en.account.menu.upgrade);
    expect(upgrade?.getAttribute("role")).toBe("menuitem");
    expect(upgrade?.getAttribute("tabindex")).toBe("-1");
    expect(balancePill?.textContent).toContain("140");
    expect(balancePill?.classList.contains("rounded-full")).toBe(true);
    expect(credits?.textContent).toContain(en.account.menu.credits);
    expect(menuItems.indexOf(upgrade as HTMLElement)).toBeGreaterThanOrEqual(0);
    expect(menuItems.indexOf(credits as HTMLElement)).toBeGreaterThanOrEqual(0);
    expect(menuItems.indexOf(upgrade as HTMLElement)).toBeLessThan(
      menuItems.indexOf(credits as HTMLElement),
    );

    upgrade?.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await act(async () => upgrade?.click());
    expect(avatar().getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("ada@example.test");
  });

  it("offers Add website only after an empty website list is known", async () => {
    await mount({
      ...SIGNED_IN,
      websites: { status: "ready", primary: null },
    });
    await open();
    expect(host.textContent).toContain(en.account.menu.addWebsite);

    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({
      ...SIGNED_IN,
      websites: { status: "unavailable" },
    });
    await open();
    expect(host.textContent).not.toContain(en.account.menu.addWebsite);
    expect(host.textContent).toContain(en.account.menu.settings);
    expect(host.textContent).toContain(en.common.signOut);
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

  it("stays open when a hovered avatar is clicked", async () => {
    await mount(SIGNED_IN);

    await act(async () => {
      avatar().parentElement?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
      avatar().click();
    });

    expect(avatar().getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("ada@example.test");
  });

  it("stays open when a pointer click first focuses the avatar", async () => {
    await mount(SIGNED_IN);

    await act(async () => {
      avatar().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      avatar().focus();
      avatar().click();
    });

    expect(avatar().getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("ada@example.test");
  });

  it("closes on Escape", async () => {
    await mount(SIGNED_IN);
    await open();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(host.textContent).not.toContain("ada@example.test");
    expect(document.activeElement).toBe(avatar());
  });

  it("supports trigger keys and roving ArrowUp/ArrowDown focus", async () => {
    await mount(SIGNED_IN);

    await act(async () => {
      avatar().focus();
      avatar().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.length).toBeGreaterThan(5);
    expect(document.activeElement).toBe(items[0]);

    await act(async () => {
      items[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(items[1]);

    await act(async () => {
      items[1]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(items[0]);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      avatar().dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(host.textContent).toContain("ada@example.test");
  });

  it.each(["Enter", " "] as const)(
    "opens from the avatar with %s",
    async (key) => {
      await mount(SIGNED_IN);
      await act(async () => {
        avatar().focus();
        avatar().dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });

      expect(avatar().getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    },
  );

  it("restores avatar focus after keyboard-activating the theme item", async () => {
    await mount(SIGNED_IN);
    await act(async () => {
      avatar().focus();
      avatar().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const theme = host.querySelector<HTMLElement>('[role="menuitem"]');
    expect(document.activeElement).toBe(theme);

    await act(async () => {
      theme?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(avatar().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(avatar());
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

  async function mount(
    account: AccountState,
    onNavigate: () => void = () => {},
    locale: "en" | "zh" = "en",
  ): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale={locale}
          messages={locale === "zh" ? zh : en}
        >
          <AccountSummaryMobile account={account} onNavigate={onNavigate} />
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
    expect(text).toContain(en.account.menu.upgrade);
    expect(text).toContain("Example");
    expect(text).toContain(en.account.menu.settings);
    expect(text).toContain(en.account.menu.agents);
    expect(text).toContain(en.account.menu.referral);
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

  it("keeps mobile destinations in desktop order and closes on navigation", async () => {
    const onNavigate = vi.fn();
    await mount(SIGNED_IN, onNavigate);

    const links = [...host.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/pricing",
      "/account/credits",
      "/account/websites/" + PRIMARY_WEBSITE_ID,
      "/account/websites",
      "/agents",
      "/account/credits#referral",
    ]);
    const text = host.textContent ?? "";
    const ordered = [
      "Ada Lovelace",
      "ada@example.test",
      "Example",
      en.account.menu.settings,
      en.account.menu.agents,
      en.account.menu.language,
      en.account.menu.referral,
      en.common.signOut,
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(text.indexOf(ordered[index - 1] ?? "")).toBeLessThan(
        text.indexOf(ordered[index] ?? ""),
      );
    }

    links[0]?.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await act(async () => links[0]?.click());
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("routes the Chinese Upgrade action to localized pricing", async () => {
    await mount(SIGNED_IN, () => {}, "zh");

    const upgrade = host.querySelector<HTMLAnchorElement>(
      'a[href="/zh/pricing"]',
    );
    expect(zh.account.menu.upgrade).toBe("Upgrade");
    expect(upgrade?.textContent).toContain("Upgrade");
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
