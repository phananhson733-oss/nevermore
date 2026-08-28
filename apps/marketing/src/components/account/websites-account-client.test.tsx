// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("../ui/button.tsx", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    asChild,
    children,
    ...props
  }: React.ComponentProps<"button"> & {
    variant?: string;
    size?: string;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button {...props}>{children}</button>),
}));
vi.mock("../ui/card.tsx", () => ({
  Card: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
}));
vi.mock("./add-website-dialog.tsx", () => ({
  AddWebsiteDialog: ({
    open,
    onComplete,
  }: {
    open: boolean;
    onComplete: (websiteId: string, generate: boolean) => void;
  }) =>
    open ? (
      <div data-testid="add-dialog">
        <button
          type="button"
          onClick={() =>
            onComplete("c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6", false)
          }
        >
          Complete add only
        </button>
        <button
          type="button"
          onClick={() =>
            onComplete("c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6", true)
          }
        >
          Complete add and generate
        </button>
      </div>
    ) : null,
}));

const { WebsitesAccountClient } = await import("./websites-account-client.tsx");

const NOW = "2026-08-27T08:00:00.000Z";
const IDS = [
  "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
  "b4f53f12-8090-4c5f-8ddb-7d9587758d7a",
  "2d44e7fb-ef13-43e4-8325-8520ae3a86f3",
  "88993cc5-c641-4d12-ae61-4b9980450d4b",
] as const;

function website(
  index: number,
  state: "not_generated" | "draft" | "confirmed" | "unconfirmed_changes",
) {
  const confirmed =
    state === "confirmed" || state === "unconfirmed_changes";
  return {
    websiteId: IDS[index],
    origin: "https://" + (index === 0 ? "example.com" : "site" + index + ".com"),
    host: index === 0 ? "example.com" : "site" + index + ".com",
    canonicalSiteKey: index === 0 ? "example.com" : "site" + index + ".com",
    displayName: index === 0 ? "Example" : "Site " + index,
    isPrimary: index === 0,
    profileState: state,
    confirmedSnapshotId: confirmed
      ? "a53f4ddb-7cd6-42da-af53-88cc68b4198" + index
      : null,
    confirmedSnapshotRevision: confirmed ? index : null,
    confirmedAt: confirmed ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

describe("WebsitesAccountClient", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    navigation.push.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <WebsitesAccountClient />
        </NextIntlClientProvider>,
      );
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function button(label: string): HTMLButtonElement {
    const node = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!(node instanceof HTMLButtonElement)) throw new Error("button missing");
    return node;
  }

  it("shows a truthful loading state before the list answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    await mount();

    expect(host.textContent).toContain(en.account.websites.loading);
  });

  it.each([
    [401, en.account.websites.signedOut],
    [503, en.account.websites.unavailable],
  ])("separates HTTP %i from an empty account", async (status, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(status, { error: { code: "test" } }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(message);
    expect(host.textContent).not.toContain(en.account.websites.emptyTitle);
  });

  it("renders an empty account with an Add Website action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { websites: [] } }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(en.account.websites.emptyTitle);
    expect(host.textContent).toContain(en.account.websites.emptyBody);
    expect(host.textContent).toContain(en.account.websites.add);
  });

  it("can retry an unavailable list without reloading the page", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        answer(503, {
          error: { code: "account_websites_unavailable" },
        }),
      )
      .mockResolvedValueOnce(answer(200, { data: { websites: [] } }));
    await mount();
    await settle();

    await act(async () => button(en.account.websites.retry).click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(en.account.websites.emptyTitle);
  });

  it("renders every profile state, one primary, version, and edit actions", async () => {
    const websites = [
      website(0, "not_generated"),
      website(1, "draft"),
      website(2, "confirmed"),
      website(3, "unconfirmed_changes"),
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { websites } }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(en.account.websites.primary);
    for (const state of [
      "not_generated",
      "draft",
      "confirmed",
      "unconfirmed_changes",
    ] as const) {
      expect(host.textContent).toContain(en.account.websites.status[state]);
    }
    expect(host.textContent).toContain("Confirmed v2");
    expect(host.querySelectorAll('a[href*="/account/websites/"]')).toHaveLength(4);
    const secondCard = host.querySelector(
      '[data-website-id="' + IDS[1] + '"]',
    );
    expect(
      secondCard?.querySelector("button")?.getAttribute("aria-label"),
    ).toBe("Make Site 1 primary");
    expect(
      secondCard?.querySelector("a")?.getAttribute("aria-label"),
    ).toBe("Edit Site 1");
  });

  it("sets a non-primary website and updates the visible primary", async () => {
    const websites = [
      website(0, "not_generated"),
      website(1, "not_generated"),
    ];
    const promoted = { ...websites[1], isPrimary: true };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { websites } }))
      .mockResolvedValueOnce(
        answer(200, {
          data: {
            website: {
              ...promoted,
              submittedUrl: `${promoted.origin}/`,
              draft: null,
              currentConfirmedSnapshot: null,
            },
          },
        }),
      );
    await mount();
    await settle();

    const card = [...host.querySelectorAll("[data-website-id]")].find(
      (node) => node.getAttribute("data-website-id") === IDS[1],
    );
    const promote = [...(card?.querySelectorAll("button") ?? [])].find(
      (node) => node.textContent?.trim() === en.account.websites.setPrimary,
    );
    await act(async () => {
      promote?.click();
    });
    await settle();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/account/websites/" + IDS[1],
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "set_primary" }),
      },
    );
    expect(
      card?.textContent?.includes(en.account.websites.primary),
    ).toBe(true);
  });

  it("routes Add Only and Add + Generate to the saved website", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { websites: [] } }),
    );
    await mount();
    await settle();

    await act(async () => button(en.account.websites.add).click());
    await act(async () => button("Complete add only").click());
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/account/websites/" + IDS[0],
    );

    await act(async () => button(en.account.websites.add).click());
    await act(async () => button("Complete add and generate").click());
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/account/websites/" + IDS[0] + "?generate=1",
    );
  });
});
