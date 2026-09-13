/** @vitest-environment jsdom */

/**
 * ShellChrome owns three pieces of state and the rules between them: the
 * mobile rail, and a single "which dialog is open" slot shared by the command
 * palette and the artifact drawer. None of that is visible in its own markup;
 * it only shows through the real Topbar, Sidebar, CommandPalette,
 * ArtifactDrawer and Dialog reacting to it. So the whole client shell runs
 * against the real provider, with the router, the unsaved-changes probe and
 * the viewport query stubbed.
 *
 * It also owns the one server read the shell makes for itself: the project's
 * sources, whose gsc slot becomes the rail site card's GSC row. That half runs
 * against the real `useProjectSources`, the real `ApiError` parsing and a real
 * QueryClient, with only `fetch` stubbed — a hand-written boolean handed to the
 * card would prove nothing about what a real problem+json response does to it.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConnection, SourceState } from "@/lib/api/hooks-sources";
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
// No `gscConnected`: the server half of the shell cannot know it, and
// `ShellChrome`'s prop type is `Omit<SidebarSite, "gscConnected">` for that
// reason. The value below the card renders comes from the sources read.
const SITE = { host: "example.test", marketCode: "US" } as const;
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

const SOURCES_PATH = `/api/mvp/projects/${PROJECT_ID}/sources`;

/** Requested URLs, so a test can show the shell really asked for sources. */
const requested: string[] = [];
/** What the stubbed `fetch` answers with. Default: a read still in flight. */
let answer: () => Promise<Response> = () => new Promise<Response>(() => {});

/**
 * The four members of `Response` the api client touches. A literal keeps the
 * test independent of whether the jsdom environment exposes a global one.
 */
function response(status: number, contentType: string, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function sourcesOk(sources: readonly SourceConnection[]): Response {
  return response(200, "application/json", JSON.stringify({ data: sources }));
}

/** A real problem+json body, so a real `ApiError` with a real `code` is thrown. */
function sourcesProblem(status: number, code: string): Response {
  return response(
    status,
    "application/problem+json",
    JSON.stringify({
      type: "about:blank",
      title: "Request failed",
      status,
      code,
      detail: "Request failed.",
      requestId: "req-test",
    }),
  );
}

function gscSource(state: SourceState, id: string | null): SourceConnection {
  return {
    id,
    projectId: PROJECT_ID,
    provider: "gsc",
    connectionType: "oauth",
    state,
    externalRef: null,
    scopes: [],
    connectedAt: null,
    latestSnapshot: null,
    latestMetricSummary: null,
    activeRun: null,
    limitation: "",
    featureEnabled: true,
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
}

function Harness({ client }: { readonly client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
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
    </QueryClientProvider>
  );
}

let cleanup: (() => void) | null = null;
/** The QueryClient of the most recent render, for `settle` to poll. */
let rendered: QueryClient | null = null;

function render(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // `retry: false` only so a 5xx settles inside the test; the shipped client
  // keeps `shouldRetryApiQuery`, which already treats 4xx as terminal.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rendered = client;
  act(() => root.render(<Harness client={client} />));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    rendered = null;
  };
  return container;
}

/** One macrotask, with every React update it releases flushed inside `act`. */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Wait for the sources read to reach a terminal state and for the render it
 * causes to land. Polling the cache rather than counting ticks: the number of
 * turns between a resolved fetch and a committed render is a scheduling
 * detail, and a fixed count makes the test flaky instead of wrong.
 *
 * The literal key is also the pin that the shell subscribes to the same
 * `["sources", projectId]` the sources page uses, which is what lets the two
 * share one request.
 */
async function settle(): Promise<void> {
  const client = rendered;
  if (!client) throw new Error("nothing is rendered");
  for (let turn = 0; turn < 100; turn += 1) {
    await tick();
    const state = client.getQueryState(["sources", PROJECT_ID]);
    if (state && state.fetchStatus === "idle" && state.status !== "pending") {
      await tick();
      return;
    }
  }
  throw new Error("the sources read never settled");
}

/** The site card's GSC value cell (row order: market, GSC, audit). */
function gscCell(scope: ParentNode): HTMLElement {
  const cell = [...scope.querySelectorAll("[data-wb-site-card] dd")][1];
  if (!(cell instanceof HTMLElement)) throw new Error("No GSC row");
  return cell;
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
  requested.length = 0;
  // Never-settling by default: every test that is not about the site card
  // stays on the in-flight branch and performs no post-mount state update.
  answer = () => new Promise<Response>(() => {});
  vi.stubGlobal("fetch", (input: unknown) => {
    requested.push(String(input));
    return answer();
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
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

describe("ShellChrome site card GSC row", () => {
  it("asks for this project's sources and shows a connected slot as connected", async () => {
    answer = () => Promise.resolve(sourcesOk([gscSource("connected", "src-1")]));
    const scope = render();

    await settle();

    expect(requested).toContain(SOURCES_PATH);
    expect(gscCell(scope).textContent).toBe(SHELL.siteCard.connected);
    expect(gscCell(scope).getAttribute("title")).toBeNull();
  });

  it("shows an explicitly disconnected slot as not connected", async () => {
    answer = () => Promise.resolve(sourcesOk([gscSource("disconnected", null)]));
    const scope = render();

    await settle();

    expect(gscCell(scope).textContent).toBe(SHELL.siteCard.notConnected);
  });

  it("keeps a permission_denied slot connected: the rail is not the place to say 'reconnect'", async () => {
    answer = () => Promise.resolve(sourcesOk([gscSource("permission_denied", "src-1")]));
    const scope = render();

    await settle();

    expect(gscCell(scope).textContent).toBe(SHELL.siteCard.connected);
  });

  it("renders a 422 CONTEXT_INCOMPLETE as unknown, never as not connected", async () => {
    // Q4, and the whole reason this test drives a real problem+json body: a
    // failed read is not a fact about the customer's Search Console. A branch
    // written on the status code instead of `ApiError.code` would fold every
    // other 422 into the same sentence; here neither one may become `false`.
    answer = () => Promise.resolve(sourcesProblem(422, "CONTEXT_INCOMPLETE"));
    const scope = render();

    await settle();

    expect(gscCell(scope).textContent).toBe(SHELL.siteCard.none);
    expect(gscCell(scope).textContent).not.toBe(SHELL.siteCard.notConnected);
    expect(gscCell(scope).getAttribute("title")).toBe(SHELL.siteCard.unknownHint);
  });

  it("renders a 500 as unknown as well", async () => {
    answer = () => Promise.resolve(sourcesProblem(500, "INTERNAL_ERROR"));
    const scope = render();

    await settle();

    expect(gscCell(scope).textContent).toBe(SHELL.siteCard.none);
    expect(gscCell(scope).getAttribute("title")).toBe(SHELL.siteCard.unknownHint);
  });

  it("renders a response with no gsc slot as unknown", async () => {
    const ga4: SourceConnection = { ...gscSource("connected", "src-2"), provider: "ga4" };
    answer = () => Promise.resolve(sourcesOk([ga4]));
    const scope = render();

    await settle();

    expect(gscCell(scope).textContent).toBe(SHELL.siteCard.none);
    expect(gscCell(scope).getAttribute("title")).toBe(SHELL.siteCard.unknownHint);
  });

  it("shows unknown, with the hint, while the first read is still in flight", () => {
    const scope = render();

    expect(gscCell(scope).textContent).toBe(SHELL.siteCard.none);
    expect(gscCell(scope).getAttribute("title")).toBe(SHELL.siteCard.unknownHint);
  });

  it("leaves the market and audit rows without the GSC hint", async () => {
    // The hint explains one row. On a row whose "—" means "no market recorded"
    // or "no audit yet" it would be a different, false explanation.
    answer = () => Promise.resolve(sourcesProblem(500, "INTERNAL_ERROR"));
    const scope = render();

    await settle();

    const cells = [...scope.querySelectorAll("[data-wb-site-card] dd")];
    expect(cells[0]?.getAttribute("title")).toBeNull();
    expect(cells[2]?.getAttribute("title")).toBeNull();
  });
});
