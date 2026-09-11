/** @vitest-environment jsdom */

/**
 * The seam between the sign-out button and the per-project store. Signing out
 * must leave nothing of this user behind (design §6.5), and the document that
 * did the wiping never receives its own `storage` event — so the button has to
 * both sweep every `gg.workbench.*` key and announce the sweep to the provider
 * mounted beside it. Neither half is visible in markup, so the real component
 * runs through `createRoot` here with only the server action stubbed.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKBENCH_SWEPT_EVENT } from "@/lib/workbench/store/persistence";
import { SignOutButton } from "./SignOutButton.tsx";

const mocks = vi.hoisted(() => ({
  signOutAction: vi.fn<() => Promise<void>>(async () => {}),
}));

// The real module is `"use server"`, reaches Supabase and `redirect()` on call
// and the environment on import. The contract under test is only that the form
// still forwards to it after the sweep has run.
vi.mock("@/lib/auth/actions", () => ({ signOutAction: mocks.signOutAction }));

// Imported after the mock is declared, for readability; `vi.mock` is hoisted
// above every import either way.
import { signOutAction } from "@/lib/auth/actions";

const en = getMessages("en");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/** Current envelope, a retired one, and a key that is not ours at all. */
const CURRENT_KEY = "gg.workbench.v1.a";
const OLDER_KEY = "gg.workbench.v0.b";
const FOREIGN_KEY = "gg.locale";

const swept = vi.fn();
let cleanup: (() => void) | null = null;

function render(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SignOutButton action={signOutAction} label={en.nav.logout} />
      </NextIntlClientProvider>,
    );
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function submit(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (!form) throw new Error("the button never rendered its form");
  act(() => form.requestSubmit());
}

describe("SignOutButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(CURRENT_KEY, "{}");
    window.localStorage.setItem(OLDER_KEY, "{}");
    window.localStorage.setItem(FOREIGN_KEY, "en");
    window.addEventListener(WORKBENCH_SWEPT_EVENT, swept);
  });

  afterEach(() => {
    window.removeEventListener(WORKBENCH_SWEPT_EVENT, swept);
    cleanup?.();
    cleanup = null;
    swept.mockClear();
    mocks.signOutAction.mockClear();
    window.localStorage.clear();
  });

  it("sweeps every workbench key, announces the sweep, and still signs out", () => {
    const container = render();

    submit(container);

    expect(window.localStorage.getItem(CURRENT_KEY)).toBeNull();
    // Version-agnostic on purpose: an envelope written by an older build is
    // still this user's data.
    expect(window.localStorage.getItem(OLDER_KEY)).toBeNull();
    // …but the sweep is ours alone; unrelated keys stay.
    expect(window.localStorage.getItem(FOREIGN_KEY)).toBe("en");
    // Without the announcement the provider mounted in this same document
    // would keep, and immediately re-persist, the state just wiped.
    expect(swept).toHaveBeenCalledTimes(1);
    expect(mocks.signOutAction).toHaveBeenCalledTimes(1);
  });

  it("names the button for assistive tech (the monogram is decoration)", () => {
    const container = render();

    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Log out");
  });
});
