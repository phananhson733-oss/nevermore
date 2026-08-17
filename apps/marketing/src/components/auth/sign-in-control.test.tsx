// @vitest-environment jsdom
// @input  -- a signed-in header with page-checker data in Web Storage
// @output -- proof that signing out takes that data with it
// @pos    -- the sign-out endpoint clears cookies only; this covers the rest

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

const { SignInControl } = await import("./sign-in-control");

let root: Root | null = null;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  // jsdom has no navigation; the component reloads after a successful sign-out.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function renderSignedIn(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<SignInControl onSignIn={() => {}} />);
  });
  return host;
}

function signOutButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    (candidate.textContent ?? "").includes("signOut"),
  );
  if (!button) throw new Error("no sign-out control rendered");
  return button as HTMLButtonElement;
}

describe("signing out", () => {
  it("clears the page checker's local data as well as the cookies", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/auth/session")
        ? Response.json({ signedIn: true })
        : new Response(null, { status: 200 }),
    ) as typeof fetch;

    localStorage.setItem("gengrowth:onpage-history:v1", "[]");
    sessionStorage.setItem("gengrowth:onpage-draft:v1", "{}");
    localStorage.setItem("gg-theme", "dark");

    const host = await renderSignedIn();
    await act(async () => {
      signOutButton(host).click();
    });

    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).toBeNull();
    // Someone else's key is not ours to delete.
    expect(localStorage.getItem("gg-theme")).toBe("dark");
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("leaves local data alone when the sign-out itself failed", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/auth/session")
        ? Response.json({ signedIn: true })
        : new Response(null, { status: 500 }),
    ) as typeof fetch;

    localStorage.setItem("gengrowth:onpage-history:v1", "[]");

    const host = await renderSignedIn();
    await act(async () => {
      signOutButton(host).click();
    });

    // Still signed in, so the data still belongs to the person looking at it.
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBe("[]");
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});
