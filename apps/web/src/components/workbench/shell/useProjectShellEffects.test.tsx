/** @vitest-environment jsdom */

/**
 * Two behaviours moved here verbatim from the retired `_nav.tsx` (design §4.3),
 * neither of which had a behavioural test there: the history position stamped
 * onto every project-shell entry, and the Context unsaved-changes confirm the
 * rail links go through. The position logic is a state machine over
 * `history.state` and the previous pathname, so it is driven through a host
 * component with only `usePathname` stubbed; jsdom's real `history` carries the
 * state between renders exactly as a browser would.
 */

import { act, StrictMode, type MouseEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectHistoryPosition,
  withProjectHistoryPosition,
} from "@/app/p/[projectId]/_project-history-position";

const en = getMessages("en");

const mocks = vi.hoisted(() => ({
  pathname: "/p/x/overview",
  hasUnsavedContextChanges: vi.fn<() => boolean>(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/app/p/[projectId]/_context-navigation-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUnsavedContextChanges: mocks.hasUnsavedContextChanges,
}));

const { useProjectShellEffects } = await import("./useProjectShellEffects.ts");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const OVERVIEW = "/p/x/overview";
const WEEK = "/p/x/week";
const LEAVE_WARNING = en.context.leaveWarning;

type ConfirmNavigation = ReturnType<typeof useProjectShellEffects>["confirmNavigation"];
const hook: { confirmNavigation: ConfirmNavigation | null } = { confirmNavigation: null };

function Host() {
  hook.confirmNavigation = useProjectShellEffects().confirmNavigation;
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

/** (Re)renders the host at `mocks.pathname`; the same tree both times, so only the pathname moves. */
function renderAt(pathname: string, { strict = false } = {}): void {
  mocks.pathname = pathname;
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const provided = (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <Host />
    </NextIntlClientProvider>
  );
  const tree = strict ? <StrictMode>{provided}</StrictMode> : provided;
  act(() => root?.render(tree));
}

function position(): number | null {
  return projectHistoryPosition(window.history.state);
}

/** A primary, unmodified click the way a `Link` handler would see it. */
function linkClick(
  overrides: Partial<Pick<MouseEvent<HTMLAnchorElement>, "button" | "metaKey">> = {},
): MouseEvent<HTMLAnchorElement> & { readonly preventDefault: ReturnType<typeof vi.fn> } {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    button: 0,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent<HTMLAnchorElement> & {
    readonly preventDefault: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  window.history.replaceState(null, "");
  hook.confirmNavigation = null;
  mocks.hasUnsavedContextChanges.mockReset();
  mocks.hasUnsavedContextChanges.mockReturnValue(false);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useProjectShellEffects history position", () => {
  it("stamps position 0 onto a fresh entry without discarding Next's own state", () => {
    window.history.replaceState({ __NA: true, tree: ["opaque"] }, "");
    const replaceState = vi.spyOn(window.history, "replaceState");

    renderAt(OVERVIEW);

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual(withProjectHistoryPosition({ __NA: true, tree: ["opaque"] }, 0));
  });

  it("adopts a position already on the entry instead of re-stamping it", () => {
    // A reload, or a Back into an entry the shell stamped earlier.
    window.history.replaceState(withProjectHistoryPosition({}, 4), "");
    const replaceState = vi.spyOn(window.history, "replaceState");

    renderAt(OVERVIEW);

    expect(replaceState).not.toHaveBeenCalled();
    expect(position()).toBe(4);
  });

  it("stamps once under StrictMode's doubled mount effect", () => {
    // Dev StrictMode runs mount effects twice. The second run finds the entry
    // it just stamped and must recognise it as "still here", not as a push
    // that inherited the stamp; without the pathname guard every entry would
    // start at 1 in development and 0 in production.
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderAt(OVERVIEW, { strict: true });

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(position()).toBe(0);
  });

  it("treats a stamp inherited by a push as a new entry and advances it", () => {
    renderAt(OVERVIEW);
    expect(position()).toBe(0);

    // Next's push can carry the custom state over: the new entry arrives
    // already reading 0. Same position on a new pathname means inherited,
    // not a traversal, so the entry gets 1.
    renderAt(WEEK);

    expect(position()).toBe(1);
  });

  it("adopts the destination's stamp on a Back/Forward traversal", () => {
    renderAt(OVERVIEW);
    renderAt(WEEK);
    expect(position()).toBe(1);

    // The browser restores the older entry's state before the pathname
    // changes; a different stamp on a different pathname is a traversal.
    window.history.replaceState(withProjectHistoryPosition({}, 0), "");
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderAt(OVERVIEW);

    expect(replaceState).not.toHaveBeenCalled();
    expect(position()).toBe(0);

    // ...and a fresh push after the traversal continues from the adopted value.
    renderAt(WEEK);
    expect(position()).toBe(1);
  });
});

describe("useProjectShellEffects confirmNavigation", () => {
  it("cancels a primary click away from a dirty Context editor when the operator declines", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt(OVERVIEW);
    const event = linkClick();

    hook.confirmNavigation?.(event, false);

    expect(confirm).toHaveBeenCalledExactlyOnceWith(LEAVE_WARNING);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("lets the click through once the operator accepts", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAt(OVERVIEW);
    const event = linkClick();

    hook.confirmNavigation?.(event, false);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("never asks for the current page, a modified click, or a clean editor", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt(OVERVIEW);

    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const current = linkClick();
    hook.confirmNavigation?.(current, true);
    const modified = linkClick({ metaKey: true });
    hook.confirmNavigation?.(modified, false);
    const middle = linkClick({ button: 1 });
    hook.confirmNavigation?.(middle, false);

    mocks.hasUnsavedContextChanges.mockReturnValue(false);
    const clean = linkClick();
    hook.confirmNavigation?.(clean, false);

    expect(confirm).not.toHaveBeenCalled();
    for (const event of [current, modified, middle, clean]) {
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
});
