/** @vitest-environment jsdom */

/**
 * ShellChrome owns three pieces of state and the rules between them: the
 * mobile rail, and a single "which dialog is open" slot shared by the command
 * palette and the artifact drawer. None of that is visible in its own markup;
 * it only shows through the real Topbar, Sidebar, CommandPalette,
 * ArtifactDrawer and Dialog reacting to it. So the whole client shell runs
 * against the real provider, with the router, the unsaved-changes probe and
 * the viewport query stubbed.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import { WorkbenchProvider } from "@/lib/workbench/store/WorkbenchProvider";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import { WB_APP_ROOT_ID } from "../ui/ids.ts";

const en = getMessages("en");

const mocks = vi.hoisted(() => ({
  mobile: false,
  push: vi.fn(),
  hasUnsavedContextChanges: vi.fn<() => boolean>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/p/00000000-0000-4000-8000-000000000042/overview",
}));
vi.mock("@/app/p/[projectId]/_context-navigation-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUnsavedContextChanges: mocks.hasUnsavedContextChanges,
}));
// The media query only resolves after mount in a browser; here the viewport is
// a switch so both layouts can be driven from one file.
vi.mock("./useMediaQuery.ts", () => ({ useMediaQuery: () => mocks.mobile }));

const { ShellChrome } = await import("./ShellChrome.tsx");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const SITE = { host: "example.test", marketCode: "US", gscConnected: null } as const;
const OPTIONS: readonly ProjectShellOption[] = [
  {
    id: PROJECT_ID,
    clientName: "Example",
    projectName: "Example site",
    host: "example.test",
    label: "Example · Example site",
    selected: true,
  },
];
const SHELL = en.workbench.shell;
const PALETTE_TITLE_ID = "wb-palette-title";
const DRAWER_TITLE_ID = "wb-drawer-title";

function Harness() {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
        <ShellChrome
          projectId={PROJECT_ID}
          site={SITE}
          projectOptions={OPTIONS}
          projectControl={<span data-test-project-control="" />}
          accountControl={<span data-test-account-control="" />}
        >
          <p data-test-page="">page body</p>
        </ShellChrome>
      </WorkbenchProvider>
    </NextIntlClientProvider>
  );
}

let cleanup: (() => void) | null = null;

function render(): HTMLElement {
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

function appRoot(): HTMLElement {
  const found = document.getElementById(WB_APP_ROOT_ID);
  if (!found) throw new Error(`#${WB_APP_ROOT_ID} did not render`);
  return found;
}

/** The `aria-labelledby` of every open dialog: which one, and how many. */
function openDialogs(): readonly string[] {
  return [...document.querySelectorAll('[role="dialog"]')].map(
    (node) => node.getAttribute("aria-labelledby") ?? "",
  );
}

function buttonLabelled(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent === label,
  );
  if (!found) throw new Error(`No button labelled ${label}`);
  return found;
}

function paletteButton(scope: ParentNode): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(SHELL.search),
  );
  if (!found) throw new Error("No palette button");
  return found;
}

function drawerButton(scope: ParentNode): HTMLButtonElement {
  const found = scope.querySelector<HTMLButtonElement>("[data-wb-drawer-button]");
  if (!found) throw new Error("No drawer button");
  return found;
}

function menuButton(scope: ParentNode): HTMLButtonElement {
  const found = scope.querySelector<HTMLButtonElement>('button[aria-controls="wb-sidebar"]');
  if (!found) throw new Error("No menu button");
  return found;
}

function sidebar(scope: ParentNode): HTMLElement {
  const found = scope.querySelector<HTMLElement>("aside#wb-sidebar");
  if (!found) throw new Error("No sidebar");
  return found;
}

function clickButton(button: HTMLButtonElement): void {
  act(() => button.click());
}

function pressAtWindow(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
  });
}

function pressOn(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "");
  mocks.mobile = false;
  mocks.push.mockReset();
  mocks.hasUnsavedContextChanges.mockReset();
  mocks.hasUnsavedContextChanges.mockReturnValue(false);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

describe("ShellChrome layout", () => {
  it("renders the app root, the content column, and the page inside <main>", () => {
    const scope = render();
    const root = appRoot();

    expect(root.hasAttribute("data-app-shell")).toBe(true);
    const content = root.querySelector("[data-wb-content]");
    expect(content).not.toBeNull();
    expect(content?.querySelector("main#main-content [data-test-page]")?.textContent).toBe("page body");
    // The rail is a sibling of the content column, not inside it.
    expect(content?.contains(sidebar(scope))).toBe(false);
    expect(root.contains(sidebar(scope))).toBe(true);
    // Both slots reach the topbar.
    expect(root.querySelector("[data-app-shell-topbar] [data-test-project-control]")).not.toBeNull();
    expect(root.querySelector("[data-app-shell-topbar] [data-test-account-control]")).not.toBeNull();
  });

  it("tells the rail how many sites there are", () => {
    const scope = render();

    expect(sidebar(scope).textContent).toContain("1 site");
  });

  it("keeps .wb-reset off #wb-app and #main-content so legacy pages stay untouched", () => {
    // Design §5: the reset is scoped to the rail, topbar, dialogs and the new
    // view roots. On the app root or <main> it would reach every legacy page,
    // and on <main> it would also match the legacy-gutter rule's `:has()` guard
    // the wrong way round (workbench.css `#main-content:not(:has(> .wb-reset))`).
    render();
    const root = appRoot();
    const main = root.querySelector("main#main-content");

    expect(main).not.toBeNull();
    expect(root.classList.contains("wb-reset")).toBe(false);
    expect(main?.classList.contains("wb-reset")).toBe(false);
  });
});

describe("ShellChrome dialogs", () => {
  it("opens the palette from the topbar and makes the app root inert meanwhile", () => {
    const scope = render();
    expect(openDialogs()).toEqual([]);
    expect(appRoot().hasAttribute("inert")).toBe(false);

    clickButton(paletteButton(scope));

    expect(openDialogs()).toEqual([PALETTE_TITLE_ID]);
    expect(appRoot().hasAttribute("inert")).toBe(true);
    // The dialogs render outside the inert root, or they would be inert too.
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      expect(appRoot().contains(dialog)).toBe(false);
    }
  });

  it("closes the palette on Escape and lifts inert from the root", () => {
    const scope = render();
    clickButton(paletteButton(scope));
    const input = document.querySelector('[role="dialog"] input');
    if (!input) throw new Error("the palette has no input");

    pressOn(input, "Escape");

    expect(openDialogs()).toEqual([]);
    expect(appRoot().hasAttribute("inert")).toBe(false);
  });

  it("toggles the palette with Cmd/Ctrl+K from anywhere", () => {
    render();

    pressAtWindow({ key: "k", metaKey: true });
    expect(openDialogs()).toEqual([PALETTE_TITLE_ID]);

    pressAtWindow({ key: "k", metaKey: true });
    expect(openDialogs()).toEqual([]);
    expect(appRoot().hasAttribute("inert")).toBe(false);

    pressAtWindow({ key: "K", ctrlKey: true });
    expect(openDialogs()).toEqual([PALETTE_TITLE_ID]);
  });

  it("never shows the palette and the drawer at the same time", () => {
    const scope = render();
    clickButton(paletteButton(scope));
    expect(openDialogs()).toEqual([PALETTE_TITLE_ID]);

    // The topbar is inert while the palette is open, so a real pointer could
    // not reach this button; a keyboard shortcut path can, and the single-slot
    // rule has to hold for it. The click drives the same setter.
    clickButton(drawerButton(scope));

    expect(openDialogs()).toEqual([DRAWER_TITLE_ID]);
    expect(appRoot().hasAttribute("inert")).toBe(true);

    pressAtWindow({ key: "k", metaKey: true });

    expect(openDialogs()).toEqual([PALETTE_TITLE_ID]);
    expect(appRoot().hasAttribute("inert")).toBe(true);
  });

  it("opens the drawer from the topbar and closes it on Escape", () => {
    const scope = render();

    clickButton(drawerButton(scope));
    expect(openDialogs()).toEqual([DRAWER_TITLE_ID]);
    expect(appRoot().hasAttribute("inert")).toBe(true);

    pressAtWindow({ key: "Escape" });

    expect(openDialogs()).toEqual([]);
    expect(appRoot().hasAttribute("inert")).toBe(false);
  });

  it("closes the drawer from its own Close control, not only from the shortcut", () => {
    // Escape reaches the shell's `closeAll`; the drawer's Close button only
    // reaches the `onClose` the shell hands the drawer. Both must clear the slot.
    const scope = render();
    clickButton(drawerButton(scope));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("the drawer did not open");

    clickButton(buttonLabelled(dialog, SHELL.drawer.close));

    expect(openDialogs()).toEqual([]);
    expect(appRoot().hasAttribute("inert")).toBe(false);
  });

  it("returns focus to the opener once the dialog closes", () => {
    const scope = render();
    const opener = paletteButton(scope);
    act(() => opener.focus());

    clickButton(opener);
    expect(document.activeElement).not.toBe(opener);

    pressAtWindow({ key: "Escape" });

    expect(document.activeElement).toBe(opener);
  });
});

describe("ShellChrome while another modal owns the page", () => {
  // The legacy Product Profile editor and action override mark every
  // `document.body` child inert (`#wb-app` included) and sit at z-index 1200.
  // `inert` on the root with no workbench panel open is that signature; the
  // shell must not mount a z-50 dialog beneath their scrim and take their focus.
  function letAnotherModalOwnThePage(): void {
    act(() => appRoot().setAttribute("inert", ""));
  }

  function releaseThePage(): void {
    act(() => appRoot().removeAttribute("inert"));
  }

  it("refuses Cmd/Ctrl+K until the page is released, then opens again", () => {
    render();
    letAnotherModalOwnThePage();

    pressAtWindow({ key: "k", metaKey: true });
    expect(openDialogs()).toEqual([]);
    pressAtWindow({ key: "K", ctrlKey: true });
    expect(openDialogs()).toEqual([]);

    releaseThePage();
    pressAtWindow({ key: "k", metaKey: true });

    expect(openDialogs()).toEqual([PALETTE_TITLE_ID]);
  });

  it("refuses the topbar openers as well", () => {
    // A real pointer cannot reach an inert topbar, but nothing stops a script
    // or a stale event from calling the same setter; the rule must hold there.
    const scope = render();
    letAnotherModalOwnThePage();

    clickButton(paletteButton(scope));
    expect(openDialogs()).toEqual([]);
    clickButton(drawerButton(scope));
    expect(openDialogs()).toEqual([]);

    releaseThePage();
    clickButton(drawerButton(scope));

    expect(openDialogs()).toEqual([DRAWER_TITLE_ID]);
  });

  it("still toggles its own palette closed: that inert is the shell's, not theirs", () => {
    render();
    pressAtWindow({ key: "k", metaKey: true });
    expect(openDialogs()).toEqual([PALETTE_TITLE_ID]);
    expect(appRoot().hasAttribute("inert")).toBe(true);

    pressAtWindow({ key: "k", metaKey: true });

    expect(openDialogs()).toEqual([]);
    expect(appRoot().hasAttribute("inert")).toBe(false);
  });
});

describe("ShellChrome mobile rail", () => {
  it("keeps the rail inert until the menu button opens it", () => {
    mocks.mobile = true;
    const scope = render();
    expect(sidebar(scope).hasAttribute("inert")).toBe(true);
    expect(menuButton(scope).getAttribute("aria-expanded")).toBe("false");
    expect(menuButton(scope).getAttribute("aria-label")).toBe(SHELL.openMenu);

    clickButton(menuButton(scope));

    expect(sidebar(scope).hasAttribute("inert")).toBe(false);
    expect(menuButton(scope).getAttribute("aria-expanded")).toBe("true");
    expect(menuButton(scope).getAttribute("aria-label")).toBe(SHELL.closeMenu);
  });

  it("closes the rail from the backdrop, which only exists while it is open", () => {
    mocks.mobile = true;
    const scope = render();
    expect(() => buttonLabelled(appRoot(), SHELL.closeMenu)).toThrow();

    clickButton(menuButton(scope));
    const backdrop = buttonLabelled(appRoot(), SHELL.closeMenu);
    expect(backdrop).not.toBe(menuButton(scope));
    clickButton(backdrop);

    expect(sidebar(scope).hasAttribute("inert")).toBe(true);
    expect(appRoot().querySelectorAll(`button[aria-label="${SHELL.closeMenu}"]`)).toHaveLength(0);
  });

  it("closes the rail on Escape as well", () => {
    mocks.mobile = true;
    const scope = render();
    clickButton(menuButton(scope));
    expect(sidebar(scope).hasAttribute("inert")).toBe(false);

    pressAtWindow({ key: "Escape" });

    expect(sidebar(scope).hasAttribute("inert")).toBe(true);
  });

  it("toggles the rail closed again from the same menu button", () => {
    mocks.mobile = true;
    const scope = render();

    clickButton(menuButton(scope));
    clickButton(menuButton(scope));

    expect(sidebar(scope).hasAttribute("inert")).toBe(true);
  });

  it("never makes the rail inert on a desktop viewport", () => {
    mocks.mobile = false;
    const scope = render();

    expect(sidebar(scope).hasAttribute("inert")).toBe(false);
  });
});
