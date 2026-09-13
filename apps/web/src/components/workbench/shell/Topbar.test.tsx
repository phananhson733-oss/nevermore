/** @vitest-environment jsdom */

/**
 * The topbar's own behaviour is one thing: every route out of it has to ask
 * before a dirty Context editor is discarded. "+ new site" is a plain `Link`,
 * so nothing about the markup says whether the guard is wired — only clicking
 * it does.
 */

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchProvider } from "@/lib/workbench/store/WorkbenchProvider";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import { WB_APP_ROOT_ID } from "../ui/ids.ts";

const en = getMessages("en");

const mocks = vi.hoisted(() => ({
  hasUnsavedContextChanges: vi.fn<() => boolean>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/p/[projectId]/_context-navigation-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUnsavedContextChanges: mocks.hasUnsavedContextChanges,
}));

const { Topbar } = await import("./Topbar.tsx");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = {
  url: "https://example.test",
  brand: "Example",
  market: "US",
};

function Harness() {
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
        <div id={WB_APP_ROOT_ID}>
          <Topbar
            projectControl={null}
            accountControl={null}
            onMenu={() => {}}
            onPalette={() => {}}
            onDrawer={() => {}}
            paletteButtonRef={paletteButtonRef}
            drawerButtonRef={drawerButtonRef}
            sidebarId="wb-sidebar"
            sidebarOpen={false}
          />
        </div>
      </WorkbenchProvider>
    </NextIntlClientProvider>
  );
}

let cleanup: (() => void) | null = null;

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function newSiteLink(scope: ParentNode): HTMLAnchorElement {
  const found = scope.querySelector<HTMLAnchorElement>('a[href="/new-project"]');
  if (!found) throw new Error("the topbar renders no new-site link");
  return found;
}

/** Returns whether the click was cancelled, the way a `Link` would see it. */
function click(target: HTMLElement): boolean {
  const observed: boolean[] = [];
  // React 19 delegates to the root container, which sits below <body>, so this
  // runs after the component's handler. Cancelling here as well keeps jsdom from
  // trying to follow the href (it cannot navigate) without hiding whether the
  // component itself cancelled.
  const observe = (event: Event): void => {
    observed.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.body.addEventListener("click", observe);
  try {
    act(() => {
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
  } finally {
    document.body.removeEventListener("click", observe);
  }
  const [cancelled] = observed;
  if (cancelled === undefined) throw new Error("the click never reached <body>");
  return cancelled;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.hasUnsavedContextChanges.mockReset();
  mocks.hasUnsavedContextChanges.mockReturnValue(false);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

describe("Topbar", () => {
  it("cancels the new-site navigation when the Context leave-confirm is declined", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = render();

    expect(click(newSiteLink(container))).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("lets the new-site navigation through once the confirm is accepted", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = render();

    expect(click(newSiteLink(container))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("never asks when the Context editor is clean", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = render();

    expect(click(newSiteLink(container))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps exactly one live region, empty while storage is healthy", () => {
    // The shell e2e locates it as `[data-app-shell-topbar] [role="status"]`; a
    // second status element would make that locator ambiguous, and a live region
    // added only once it has something to say is announced by nobody.
    const container = render();
    const statuses = container.querySelectorAll('[role="status"]');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe("");
  });
});
