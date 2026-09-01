// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

vi.mock("./website-profile-editor.tsx", () => ({
  WebsiteProfileEditor: ({
    autoGenerate,
    onConfirmedRevisionChange,
    onProfileAvailabilityChange,
  }: {
    readonly autoGenerate: boolean;
    readonly onConfirmedRevisionChange?: (revision: number) => void;
    readonly onProfileAvailabilityChange?: (available: boolean) => void;
  }) => {
    const [draft, setDraft] = useState("Profile draft");

    useEffect(() => {
      onConfirmedRevisionChange?.(3);
      onProfileAvailabilityChange?.(true);
    }, [onConfirmedRevisionChange, onProfileAvailabilityChange]);

    return (
      <label>
        Profile draft
        <input
          data-auto-generate={String(autoGenerate)}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
    );
  },
}));

vi.mock("./website-geo-editor.tsx", () => ({
  WebsiteGeoEditor: () => {
    const [draft, setDraft] = useState("GEO draft");
    return (
      <label>
        GEO draft
        <input
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
    );
  },
}));

const { WebsiteProfileWithGeo } = await import("./website-profile-with-geo.tsx");

let host: HTMLDivElement;
let root: Root;

function disclosure(name: "profile" | "geo"): HTMLDetailsElement {
  const node = host.querySelector(`[data-account-editor-card="${name}"]`);
  expect(node).toBeInstanceOf(HTMLDetailsElement);
  return node as HTMLDetailsElement;
}

function summary(name: "profile" | "geo"): HTMLElement {
  const node = disclosure(name).querySelector("summary");
  expect(node).toBeInstanceOf(HTMLElement);
  return node as HTMLElement;
}

function input(label: "Profile draft" | "GEO draft"): HTMLInputElement {
  const node = [...host.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.includes(label),
  )?.querySelector("input");
  expect(node).toBeInstanceOf(HTMLInputElement);
  return node as HTMLInputElement;
}

async function mount(autoGenerate = false): Promise<void> {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WebsiteProfileWithGeo
          websiteId="c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6"
          autoGenerate={autoGenerate}
        />
      </NextIntlClientProvider>,
    );
  });
}

async function rerender(autoGenerate = false): Promise<void> {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WebsiteProfileWithGeo
          websiteId="c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6"
          autoGenerate={autoGenerate}
        />
      </NextIntlClientProvider>,
    );
  });
}

async function navigateToHash(hash: string): Promise<void> {
  await act(async () => {
    window.history.replaceState({}, "", `/en/account/websites/site-1${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function clickSummary(name: "profile" | "geo"): Promise<void> {
  await act(async () => summary(name).click());
}

async function change(node: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      node,
      value,
    );
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  window.history.replaceState({}, "", "/en/account/websites/site-1");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("WebsiteProfileWithGeo disclosures", () => {
  it("renders two native, collapsed cards while keeping both editors mounted", async () => {
    await mount();

    expect(disclosure("profile").id).toBe("website-profile");
    expect(disclosure("geo").id).toBe("geo");
    expect(disclosure("profile").open).toBe(false);
    expect(disclosure("geo").open).toBe(false);
    expect(input("Profile draft").isConnected).toBe(true);
    expect(input("GEO draft").isConnected).toBe(true);
    expect(summary("profile").textContent).toContain("Product Profile");
    expect(summary("profile").textContent).toContain(
      "Product, audience, market and competitor context",
    );
    expect(summary("geo").textContent).toContain("GEO Knowledge Base");
    expect(summary("geo").textContent).toContain(
      "Brand matching, questions, evidence and frozen versions",
    );
    expect(summary("profile").querySelector("div")).toBeNull();
    expect(summary("geo").querySelector("div")).toBeNull();
    expect(summary("profile").querySelector("button")).toBeNull();
    expect(summary("geo").querySelector("button")).toBeNull();
  });

  it("uses the approved card titles and descriptions in both locales", () => {
    expect(en.account.websites.editor.profileCardTitle).toBe("Product Profile");
    expect(en.account.websites.editor.profileCardBody).toBe(
      "Product, audience, market and competitor context",
    );
    expect(en.account.websites.editor.geoCardTitle).toBe("GEO Knowledge Base");
    expect(en.account.websites.editor.geoCardBody).toBe(
      "Brand matching, questions, evidence and frozen versions",
    );
    expect(zh.account.websites.editor.profileCardTitle).toBe("产品 Profile");
    expect(zh.account.websites.editor.profileCardBody).toBe(
      "产品、核心用户画像、市场与竞品资料",
    );
    expect(zh.account.websites.editor.geoCardTitle).toBe("GEO 知识库");
    expect(zh.account.websites.editor.geoCardBody).toBe(
      "品牌匹配、提问、证据与冻结版本",
    );
  });

  it("opens only the Profile card for automatic generation", async () => {
    await mount(true);

    expect(disclosure("profile").open).toBe(true);
    expect(disclosure("geo").open).toBe(false);
    expect(input("Profile draft").dataset.autoGenerate).toBe("true");
  });

  it("opens the Profile card when the same website switches to generate mode", async () => {
    await mount(false);

    expect(disclosure("profile").open).toBe(false);

    await rerender(true);

    expect(disclosure("profile").open).toBe(true);
    expect(disclosure("geo").open).toBe(false);
    expect(input("Profile draft").dataset.autoGenerate).toBe("true");
  });

  it.each([
    ["#website-profile", "profile", "geo"],
    ["#geo", "geo", "profile"],
  ] as const)(
    "opens the %s target on initial render without opening the other card",
    async (hash, openName, closedName) => {
      window.history.replaceState({}, "", `/en/account/websites/site-1${hash}`);

      await mount();

      expect(disclosure(openName).open).toBe(true);
      expect(disclosure(closedName).open).toBe(false);
    },
  );

  it("opens hash targets after render without closing an already open card", async () => {
    await mount();

    await navigateToHash("#website-profile");
    expect(disclosure("profile").open).toBe(true);
    expect(disclosure("geo").open).toBe(false);

    await navigateToHash("#geo");
    expect(disclosure("profile").open).toBe(true);
    expect(disclosure("geo").open).toBe(true);

    await navigateToHash("#unrelated");
    expect(disclosure("profile").open).toBe(true);
    expect(disclosure("geo").open).toBe(true);
  });

  it("preserves each mounted editor and its draft through close and reopen", async () => {
    await mount();
    const originalProfile = input("Profile draft");
    const originalGeo = input("GEO draft");

    await clickSummary("profile");
    await clickSummary("geo");
    await change(originalProfile, "Edited profile");
    await change(originalGeo, "Edited GEO");
    await clickSummary("profile");
    await clickSummary("geo");
    await clickSummary("profile");
    await clickSummary("geo");

    expect(input("Profile draft")).toBe(originalProfile);
    expect(input("GEO draft")).toBe(originalGeo);
    expect(input("Profile draft").value).toBe("Edited profile");
    expect(input("GEO draft").value).toBe("Edited GEO");
  });
});
