/** @vitest-environment jsdom */

/**
 * The rail's contract is what the markup alone cannot show: which link is the
 * current page, which badges exist for a given store state (and that zero is
 * never one), whether the off-canvas rail is really unreachable while closed on
 * a phone, and that a rail link asks before discarding a dirty Context editor.
 * The real component runs against the real provider with only `usePathname`
 * and the unsaved-changes probe stubbed.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKBENCH_PAGE_IDS, WORKBENCH_SEGMENTS, type WorkbenchPageId } from "@/lib/workbench/routes";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import {
  WorkbenchProvider,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import type { ProjectSeed, WorkbenchAction } from "@/lib/workbench/store/reducer";
import type { AuditReport, SavedKeyword } from "@/lib/workbench/types";
import { WORKBENCH_NAV } from "./workbench-nav.ts";

const en = getMessages("en");

const mocks = vi.hoisted(() => ({
  pathname: "/",
  hasUnsavedContextChanges: vi.fn<() => boolean>(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/app/p/[projectId]/_context-navigation-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUnsavedContextChanges: mocks.hasUnsavedContextChanges,
}));

const { Sidebar } = await import("./Sidebar.tsx");
type SidebarProps = Parameters<typeof Sidebar>[0];

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const SITE = { host: "example.test", marketCode: "US", gscConnected: null } as const;
const SIDEBAR_ID = "wb-sidebar";
const NAV_ITEMS = WORKBENCH_NAV.flatMap((group) => group.items);
const REPORT: AuditReport = {
  at: "2026-09-11 10:00",
  score: 56,
  findings: [],
  crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "2.4", schema: 0, llmReadable: 50 },
  pageRows: [],
};
const SAVED: readonly SavedKeyword[] = [
  { q: "geo audit", addedAt: "2026-09-11 09:00", source: "matrix" },
  { q: "seo audit", addedAt: "2026-09-11 09:01", source: "manual" },
];

const store: { current: WorkbenchContextValue | null } = { current: null };

function Probe() {
  store.current = useWorkbench();
  return null;
}

function Harness(props: Partial<Omit<SidebarProps, "id" | "projectId" | "site">>) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
        <Probe />
        <Sidebar
          id={SIDEBAR_ID}
          projectId={PROJECT_ID}
          site={SITE}
          siteCount={props.siteCount ?? 2}
          open={props.open ?? false}
          mobile={props.mobile ?? false}
        />
      </WorkbenchProvider>
    </NextIntlClientProvider>
  );
}

let cleanup: (() => void) | null = null;

function render(props: Parameters<typeof Harness>[0] = {}, pathname = `/p/${PROJECT_ID}/overview`) {
  mocks.pathname = pathname;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const view = {
    container,
    rerender(next: Parameters<typeof Harness>[0]) {
      act(() => root.render(<Harness {...next} />));
    },
  };
  act(() => root.render(<Harness {...props} />));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return view;
}

function dispatch(action: WorkbenchAction): void {
  const send = store.current?.dispatch;
  if (!send) throw new Error("the provider never rendered");
  act(() => send(action));
}

function navLinks(scope: ParentNode): readonly HTMLAnchorElement[] {
  return [...scope.querySelectorAll<HTMLAnchorElement>("a[data-wb-nav]")];
}

function navLink(scope: ParentNode, id: WorkbenchPageId): HTMLAnchorElement {
  const found = scope.querySelector<HTMLAnchorElement>(`a[data-wb-nav="${id}"]`);
  if (!found) throw new Error(`no rail link for ${id}`);
  return found;
}

function badges(scope: ParentNode): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...scope.querySelectorAll<HTMLElement>("[data-wb-badge]")].map((node) => [
      node.getAttribute("data-wb-badge"),
      node.textContent,
    ]),
  );
}

function rail(scope: ParentNode): HTMLElement {
  const found = scope.querySelector<HTMLElement>(`aside#${SIDEBAR_ID}`);
  if (!found) throw new Error("the rail did not render");
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
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
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
  window.history.replaceState(null, "");
  store.current = null;
  mocks.hasUnsavedContextChanges.mockReset();
  mocks.hasUnsavedContextChanges.mockReturnValue(false);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

describe("Sidebar navigation", () => {
  it("renders every workbench page once, grouped, in route-table order", () => {
    const view = render();
    const links = navLinks(view.container);

    expect(links).toHaveLength(WORKBENCH_PAGE_IDS.length);
    expect(links.map((a) => a.getAttribute("data-wb-nav"))).toEqual(NAV_ITEMS.map((item) => item.id));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      NAV_ITEMS.map((item) => `/p/${PROJECT_ID}/${WORKBENCH_SEGMENTS[item.id]}`),
    );
    expect(links.map((a) => a.textContent)).toEqual(NAV_ITEMS.map((item) => en.workbench.nav.items[item.id]));

    const groups = [...view.container.querySelectorAll("nav h4")].map((node) => node.textContent);
    expect(groups).toEqual(WORKBENCH_NAV.map((group) => en.workbench.nav.groups[group.id]));
    expect(view.container.querySelector("nav")?.getAttribute("aria-label")).toBe(en.workbench.nav.label);
  });

  it("marks only the current page's link with aria-current", () => {
    const view = render({}, `/p/${PROJECT_ID}/keyword-library`);

    const current = navLinks(view.container).filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.getAttribute("data-wb-nav"))).toEqual(["keywordLibrary"]);
  });

  it("marks nothing when the route is not a workbench page", () => {
    const view = render({}, `/p/${PROJECT_ID}/growth-map`);

    expect(navLinks(view.container).some((a) => a.hasAttribute("aria-current"))).toBe(false);
  });

  it("shows the site count and the brand tagline through the rail token", () => {
    const view = render({ siteCount: 2 });
    expect(view.container.textContent).toContain("2 sites");
    expect(view.container.textContent).toContain(en.workbench.shell.shortcutHint);

    view.rerender({ siteCount: 1 });
    expect(view.container.textContent).toContain("1 site");

    const tagline = [...view.container.querySelectorAll("[data-wb-brand] div")].find(
      (node) => node.textContent === en.workbench.shell.tagline,
    );
    // workbench-tokens.test.ts guards the token's contrast; this pins that the
    // tagline actually uses it rather than a bare Tailwind grey.
    expect(tagline?.className).toMatch(/\btext-wb-rail-muted\b/);
  });
});

describe("Sidebar badges", () => {
  it("shows no badge while the store holds nothing", () => {
    const view = render();

    expect(store.current?.ready).toBe(true);
    expect(badges(view.container)).toEqual({});
    expect(view.container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("counts saved keywords on the keyword library link", () => {
    const view = render();

    dispatch({ type: "setSaved", saved: SAVED });

    expect(badges(view.container)).toEqual({ keywordLibrary: "2" });
    expect(navLink(view.container, "keywordLibrary").textContent).toContain("2");
  });

  it("shows the audit score on the audit link and the audit date in the site card", () => {
    const view = render();

    dispatch({ type: "auditComplete", report: REPORT });

    expect(badges(view.container)).toEqual({ audit: "56" });
    expect(view.container.querySelector("[data-wb-site-card]")?.textContent).toContain("09-11 10:00");
  });

  it("drops a badge again when its count returns to zero", () => {
    const view = render();
    dispatch({ type: "setSaved", saved: SAVED });
    expect(badges(view.container)).toEqual({ keywordLibrary: "2" });

    dispatch({ type: "setSaved", saved: [] });

    expect(badges(view.container)).toEqual({});
  });
});

describe("Sidebar off-canvas", () => {
  it("is inert while closed on a phone and reachable once opened", () => {
    const view = render({ mobile: true, open: false });
    expect(rail(view.container).hasAttribute("inert")).toBe(true);
    expect(rail(view.container).classList.contains("-translate-x-full")).toBe(true);

    view.rerender({ mobile: true, open: true });

    expect(rail(view.container).hasAttribute("inert")).toBe(false);
    // The bare class, not the `md:` variant that is always present.
    expect(rail(view.container).classList.contains("translate-x-0")).toBe(true);
    expect(rail(view.container).classList.contains("-translate-x-full")).toBe(false);
  });

  it("is never inert on a desktop viewport, where it is always on screen", () => {
    const view = render({ mobile: false, open: false });

    expect(rail(view.container).hasAttribute("inert")).toBe(false);
  });
});

describe("Sidebar Context leave-confirm", () => {
  it("cancels the rail navigation when the operator declines to leave", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render({}, `/p/${PROJECT_ID}/profile`);

    expect(click(navLink(view.container, "week"))).toBe(true);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(en.context.leaveWarning);
  });

  it("lets the rail navigation through once the operator accepts", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render({}, `/p/${PROJECT_ID}/profile`);

    expect(click(navLink(view.container, "week"))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("never asks for the current page's own link or a clean editor", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render({}, `/p/${PROJECT_ID}/profile`);

    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    expect(click(navLink(view.container, "profile"))).toBe(false);

    mocks.hasUnsavedContextChanges.mockReturnValue(false);
    expect(click(navLink(view.container, "week"))).toBe(false);

    expect(confirm).not.toHaveBeenCalled();
  });
});
