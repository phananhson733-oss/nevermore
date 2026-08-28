// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/account/websites",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

const { AccountSettingsShell } = await import("./account-settings-shell.tsx");

const MESSAGES = {
  account: {
    settings: {
      eyebrow: "Account",
      title: "Settings",
      back: "Back to GenGrowth",
      navigation: "Settings navigation",
      websites: "Websites",
      credits: "Credits",
      agents: "Agents",
    },
  },
};

describe("AccountSettingsShell", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    navigation.pathname = "/account/websites";
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <AccountSettingsShell locale="en">
            <p>Private settings body</p>
          </AccountSettingsShell>
        </NextIntlClientProvider>,
      );
    });
  }

  it("exposes only Websites, Credits, and Agents", async () => {
    await render();

    const links = [...host.querySelectorAll("nav a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Websites",
      "Credits",
      "Agents",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/account/websites",
      "/account/credits",
      "/agents",
    ]);
    expect(host.textContent).not.toMatch(
      /Integrations|Docs|Team|Devices|Upgrade/u,
    );
  });

  it("marks the active settings destination without marking Agents", async () => {
    await render();

    const links = [...host.querySelectorAll("nav a")];
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
    expect(links[1]?.hasAttribute("aria-current")).toBe(false);
    expect(links[2]?.hasAttribute("aria-current")).toBe(false);
    expect(host.textContent).toContain("Private settings body");
  });
});
