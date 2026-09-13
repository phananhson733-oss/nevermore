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
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { storageKey, WORKBENCH_SWEPT_EVENT } from "@/lib/workbench/store/persistence";
import { WorkbenchProvider, type WorkbenchContextValue } from "@/lib/workbench/store/WorkbenchProvider";
import { initialProjectState, type ProjectSeed } from "@/lib/workbench/store/reducer";
import { PERSISTED_VERSION } from "@/lib/workbench/store/schema";
import { WB_APP_ROOT_ID } from "../ui/ids.ts";

const en = getMessages("en");
const zhCN = getMessages("zh-CN");

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

/** The store as the topbar sees it, so a test can dispatch into the real provider. */
const store: { current: WorkbenchContextValue | null } = { current: null };

function StoreProbe() {
  store.current = useWorkbench();
  return null;
}

function Harness({ locale }: { readonly locale: "en" | "zh-CN" }) {
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zhCN} timeZone="UTC">
      <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
        <StoreProbe />
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

function render(locale: "en" | "zh-CN" = "en") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Harness locale={locale} />));
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

function newerBuildBytes(): string {
  return JSON.stringify({ v: PERSISTED_VERSION, state: { ...initialProjectState(SEED), futureField: 1 } });
}

/** The visible short label shown below `lg`, where the live region is not painted. */
function compactNotice(scope: ParentNode): HTMLElement | null {
  return scope.querySelector<HTMLElement>("[data-wb-storage-compact]");
}

/**
 * The compact label is painted only below `lg`, hidden from assistive tech (the
 * live region already announces the sentence), and never a second status.
 */
function expectCompactNotice(container: HTMLElement, text: string): void {
  const compact = compactNotice(container);
  if (!compact) throw new Error("no compact storage notice rendered");
  expect(compact.textContent).toBe(text);
  expect(compact.getAttribute("aria-hidden")).toBe("true");
  expect(compact.classList.contains("lg:hidden")).toBe(true);
  expect(compact.closest('[role="status"]')).toBeNull();
  expect(compact.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
}

function statusText(container: HTMLElement): string | null | undefined {
  return container.querySelector('[role="status"]')?.textContent;
}

beforeEach(() => {
  window.localStorage.clear();
  store.current = null;
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
    expect(compactNotice(container)).toBeNull();
  });

  it("says results will not be saved, in that one live region, when storage holds a newer build's data", () => {
    window.localStorage.setItem(storageKey(PROJECT_ID), newerBuildBytes());
    const container = render();
    const statuses = container.querySelectorAll('[role="status"]');

    // The literal sentence, not "something rendered": next-intl renders a
    // missing key as its path instead of throwing.
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe(
      "This browser holds data saved by a newer version. Results from this session will not be saved",
    );
  });

  it("stays silent after a sweep", () => {
    const container = render();
    act(() => window.dispatchEvent(new Event(WORKBENCH_SWEPT_EVENT)));
    const statuses = container.querySelectorAll('[role="status"]');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe("");
    expect(compactNotice(container)).toBeNull();
  });

  describe("visible notice below lg, where the sentence is screen-reader only", () => {
    it("shows it in read-only mode, in both languages", () => {
      window.localStorage.setItem(storageKey(PROJECT_ID), newerBuildBytes());
      const container = render();
      expect(store.current?.storageMode).toBe("readonly");
      expectCompactNotice(container, "Not saved");
      cleanup?.();

      window.localStorage.setItem(storageKey(PROJECT_ID), newerBuildBytes());
      expectCompactNotice(render("zh-CN"), "未保存");
    });

    it("shows it when storage is unavailable (volatile)", () => {
      const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
      Object.defineProperty(window, "localStorage", {
        get() { throw new Error("denied"); },
        configurable: true,
      });
      try {
        const container = render();
        expect(store.current?.storageMode).toBe("volatile");
        expect(statusText(container)).toBe("Results will not be saved in this browser");
        expectCompactNotice(container, "Not saved");
      } finally {
        if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
        else Reflect.deleteProperty(window, "localStorage");
      }
    });

    it("shows it once a write hits the storage quota", () => {
      const container = render();
      expect(compactNotice(container)).toBeNull();
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });

      act(() => store.current?.dispatch({ type: "setSeeds", seeds: "does not fit" }));

      expect(store.current?.storageMode).toBe("quota");
      expect(statusText(container)).toBe("Browser storage is full; new results are not being saved");
      expectCompactNotice(container, "Not saved");
    });
  });
});
