// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";

vi.mock("../ui/button.tsx", () => ({
  Button: ({
    variant: _variant,
    ...props
  }: React.ComponentProps<"button"> & { variant?: string }) => (
    <button {...props} />
  ),
}));
vi.mock("../ui/dialog.tsx", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));
vi.mock("../ui/input.tsx", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("../ui/label.tsx", () => ({
  Label: (props: React.ComponentProps<"label">) => <label {...props} />,
}));

const { AddWebsiteDialog } = await import("./add-website-dialog.tsx");

const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const WEBSITE = {
  websiteId: WEBSITE_ID,
  origin: "https://example.com",
  host: "example.com",
  canonicalSiteKey: "example.com",
  displayName: "Example",
  isPrimary: true,
  profileState: "not_generated",
  confirmedSnapshotId: null,
  confirmedSnapshotRevision: null,
  confirmedAt: null,
  createdAt: "2026-08-27T08:00:00.000Z",
  updatedAt: "2026-08-27T08:00:00.000Z",
};
const DETAILS = {
  ...WEBSITE,
  submittedUrl: "https://example.com/",
  draft: null,
  currentConfirmedSnapshot: null,
};

function response(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function change(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddWebsiteDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onOpenChange: (open: boolean) => void;
  let onComplete: (websiteId: string, generate: boolean) => void;

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onOpenChange = vi.fn<(open: boolean) => void>();
    onComplete = vi.fn<(websiteId: string, generate: boolean) => void>();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AddWebsiteDialog
            open
            onOpenChange={onOpenChange}
            onComplete={onComplete}
          />
        </NextIntlClientProvider>,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function input(label: string): HTMLInputElement {
    const labelNode = [...document.body.querySelectorAll("label")].find(
      (node) => node.textContent === label,
    );
    const id = labelNode?.getAttribute("for");
    const node = id ? document.getElementById(id) : null;
    if (!(node instanceof HTMLInputElement)) {
      throw new Error("input not found");
    }
    return node;
  }

  function button(label: string): HTMLButtonElement {
    const node = [...document.body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!(node instanceof HTMLButtonElement)) {
      throw new Error("button not found");
    }
    return node;
  }

  it("validates a public URL before sending anything", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await act(async () => {
      change(input(en.account.websites.dialog.url), "http://localhost");
    });
    await act(async () => {
      button(en.account.websites.dialog.addOnly).click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      en.account.websites.dialog.invalidUrl,
    );
    expect(document.activeElement).toBe(input(en.account.websites.dialog.url));
  });

  it("adds without generation and trims the optional name", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(201, { data: { website: DETAILS } }));
    await act(async () => {
      change(input(en.account.websites.dialog.url), "https://example.com");
      change(
        input(en.account.websites.dialog.displayName),
        "  Example  ",
      );
    });
    await act(async () => {
      button(en.account.websites.dialog.addOnly).click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/account/websites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com",
        displayName: "Example",
      }),
    });
    expect(onComplete).toHaveBeenCalledWith(WEBSITE_ID, false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(input(en.account.websites.dialog.url).value).toBe("");
    expect(input(en.account.websites.dialog.displayName).value).toBe("");
  });

  it("opens a duplicate website and keeps the requested generation intent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(409, {
        error: {
          code: "website_exists",
          details: { website: WEBSITE },
        },
      }),
    );
    await act(async () => {
      change(input(en.account.websites.dialog.url), "example.com");
    });
    await act(async () => {
      button(en.account.websites.dialog.addAndGenerate).click();
    });

    expect(onComplete).toHaveBeenCalledWith(WEBSITE_ID, true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the entered URL available after a failed request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(503, { error: { code: "account_websites_unavailable" } }),
    );
    const url = input(en.account.websites.dialog.url);
    await act(async () => {
      change(url, "example.com");
    });
    await act(async () => {
      button(en.account.websites.dialog.addOnly).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(url.value).toBe("example.com");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(url.getAttribute("aria-invalid")).not.toBe("true");
    expect(document.body.textContent).toContain(en.account.websites.dialog.failed);
  });

  it("fails closed on a malformed created website response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(201, { data: { website: { websiteId: "not-a-uuid" } } }),
    );
    await act(async () => {
      change(input(en.account.websites.dialog.url), "example.com");
    });
    await act(async () => {
      button(en.account.websites.dialog.addOnly).click();
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(en.account.websites.dialog.failed);
  });

  it("submits Add Only when the form is submitted from the keyboard", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(201, { data: { website: DETAILS } }));
    await act(async () => {
      change(input(en.account.websites.dialog.url), "example.com");
    });
    const form = document.body.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("form missing");
    await act(async () => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(WEBSITE_ID, false);
  });
});
