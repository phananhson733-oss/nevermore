/** @vitest-environment jsdom */

/**
 * The palette's contract is interaction, not markup: what the query filters,
 * where the highlight lands, what Enter navigates to, and whether a dirty
 * Context editor can be abandoned without a confirm. None of that is reachable
 * from static markup, so the real component is driven through `createRoot` with
 * only the unsaved-changes probe stubbed.
 *
 * Navigation is a real click on a real anchor (so document-level link guards
 * such as the Studio editor's see it), never a router push. Without an app
 * router context `next/link` calls the `onClick` prop and stops, so the
 * observable outcome here is the click reaching `<body>` uncancelled, exactly
 * what `Sidebar.test.tsx` checks for the rail links.
 */

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import { WB_APP_ROOT_ID } from "../ui/ids.ts";

const en = getMessages("en");

const mocks = vi.hoisted(() => ({
  hasUnsavedContextChanges: vi.fn<() => boolean>(),
}));

vi.mock("@/app/p/[projectId]/_context-navigation-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUnsavedContextChanges: mocks.hasUnsavedContextChanges,
}));

const { CommandPalette } = await import("./CommandPalette.tsx");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const OTHER_ID = "00000000-0000-4000-8000-000000000043";
const OPTIONS: readonly ProjectShellOption[] = [
  {
    id: PROJECT_ID,
    clientName: "Example",
    projectName: "Example site",
    host: "example.test",
    label: "Example · Example site",
    selected: true,
  },
  {
    id: OTHER_ID,
    clientName: "Rival",
    projectName: "Rival site",
    host: "rival.test",
    label: "Rival · Rival site",
    selected: false,
  },
];
/** 15 nav sections + 2 projects + "new site". */
const TOTAL_ENTRIES = 18;

function Harness({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <div id={WB_APP_ROOT_ID}>
        <button type="button" id="opener" ref={openerRef}>
          open
        </button>
      </div>
      <CommandPalette
        open={open}
        onClose={onClose}
        returnFocusTo={openerRef}
        projectId={PROJECT_ID}
        projectOptions={OPTIONS}
      />
    </NextIntlClientProvider>
  );
}

const onClose = vi.fn();
let cleanup: (() => void) | null = null;

function render(open = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const view = {
    container,
    open(next: boolean) {
      act(() => root.render(<Harness open={next} onClose={onClose} />));
    },
  };
  view.open(open);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return view;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
  // jsdom implements no scroll API, so the stub below is an added property that
  // `restoreAllMocks` knows nothing about; leaving it would let a later test
  // pass against an API no browser-less environment actually has.
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

beforeEach(() => {
  onClose.mockReset();
  mocks.hasUnsavedContextChanges.mockReset();
  mocks.hasUnsavedContextChanges.mockReturnValue(false);
});

function input(scope: ParentNode): HTMLInputElement {
  const found = scope.querySelector("input");
  if (!found) throw new Error("the palette is not open");
  return found;
}

function options(scope: ParentNode): readonly HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** React tracks the DOM value itself, so the native setter has to be used. */
function typeQuery(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(el: HTMLElement, key: string, isComposing = false): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, isComposing, bubbles: true, cancelable: true }),
    );
  });
}

interface ObservedClick {
  /** The anchor the click was dispatched on, or null when nothing was clicked. */
  readonly target: HTMLAnchorElement | null;
  /** Whether the click reached `<body>` already cancelled, the way `Link` sees it. */
  readonly cancelled: boolean;
}

/**
 * Runs `interact` while watching `<body>` for the option click it may cause.
 * React 19 delegates to the root container, which sits below `<body>`, so this
 * observer runs after the component's handler. It cancels the event itself too,
 * which keeps jsdom from trying to follow the href (it cannot navigate) without
 * hiding whether the component had already cancelled it.
 */
function observeClick(interact: () => void): ObservedClick {
  const seen: ObservedClick[] = [];
  const observe = (event: Event): void => {
    const target = event.target instanceof HTMLAnchorElement ? event.target : null;
    seen.push({ target, cancelled: event.defaultPrevented });
    event.preventDefault();
  };
  document.body.addEventListener("click", observe);
  try {
    interact();
  } finally {
    document.body.removeEventListener("click", observe);
  }
  if (seen.length > 1) throw new Error(`expected at most one click, saw ${seen.length}`);
  return seen[0] ?? { target: null, cancelled: false };
}

describe("CommandPalette", () => {
  it("lists every destination and narrows to the matching ones", () => {
    const view = render();
    expect(options(view.container)).toHaveLength(TOTAL_ENTRIES);

    typeQuery(input(view.container), "keyword library");

    expect(options(view.container).map((node) => node.textContent)).toEqual([
      "Keyword librarySections",
    ]);
  });

  it("shows the empty state outside the listbox when nothing matches", () => {
    const view = render();

    typeQuery(input(view.container), "nothing matches this");

    expect(options(view.container)).toHaveLength(0);
    const listbox = view.container.querySelector('[role="listbox"]');
    expect(listbox?.textContent).toBe("");
    expect(view.container.textContent).toContain("No matches");
    expect(
      view.container.querySelector('[role="status"]')?.textContent,
    ).toBe("Search and jump: 0");
  });

  it("renders every option as an anchor inside the listbox", () => {
    // Anchors, not buttons: the Studio editor guard fences `a[href]` clicks
    // from a document-level capture listener, and a button-driven router push
    // would have bypassed it (dirty edits silently discarded on a palette jump).
    const view = render();

    for (const option of options(view.container)) {
      expect(option).toBeInstanceOf(HTMLAnchorElement);
      expect(option.closest('[role="listbox"]')).not.toBeNull();
    }
    expect(options(view.container)[1]?.getAttribute("href")).toBe(`/p/${PROJECT_ID}/week`);
  });

  it("clicks the highlighted entry's anchor on Enter and closes", () => {
    const view = render();
    press(input(view.container), "ArrowDown");
    const highlighted = options(view.container)[1];
    expect(highlighted?.getAttribute("aria-selected")).toBe("true");

    const click = observeClick(() => press(input(view.container), "Enter"));

    expect(click.target).toBe(highlighted);
    expect(click.target?.getAttribute("href")).toBe(`/p/${PROJECT_ID}/week`);
    expect(click.cancelled).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets a pointer click on an option through and closes", () => {
    const view = render();
    const target = options(view.container)[2];
    if (!target) throw new Error("the palette has no third option");

    const click = observeClick(() => act(() => target.click()));

    expect(click.target).toBe(target);
    expect(click.cancelled).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open and does not close when a document-level guard has already cancelled the click", () => {
    // The Studio guard cancels in the capture phase at `document`, before any
    // React handler runs; the palette must then neither close nor navigate.
    const view = render();
    const target = options(view.container)[0];
    if (!target) throw new Error("the palette has no options");
    const cancelUpstream = (event: Event): void => event.preventDefault();
    document.addEventListener("click", cancelUpstream, true);
    try {
      const click = observeClick(() => act(() => target.click()));
      expect(click.cancelled).toBe(true);
    } finally {
      document.removeEventListener("click", cancelUpstream, true);
    }

    expect(onClose).not.toHaveBeenCalled();
    expect(options(view.container)).toHaveLength(TOTAL_ENTRIES);
  });

  it("does nothing on Enter when no entry matches", () => {
    const view = render();
    typeQuery(input(view.container), "nothing matches this");

    const click = observeClick(() => press(input(view.container), "Enter"));

    expect(click.target).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves the highlight back to the first entry as the query changes", () => {
    const view = render();
    press(input(view.container), "ArrowDown");
    press(input(view.container), "ArrowDown");

    typeQuery(input(view.container), "keyword");

    const shown = options(view.container);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("opens on an empty query again after it was closed", () => {
    const view = render();
    typeQuery(input(view.container), "keyword library");
    expect(options(view.container)).toHaveLength(1);

    view.open(false);
    view.open(true);

    expect(input(view.container).value).toBe("");
    expect(options(view.container)).toHaveLength(TOTAL_ENTRIES);
  });

  it("keeps the palette open when the Context leave-confirm is declined", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render();

    const click = observeClick(() => press(input(view.container), "Enter"));

    expect(confirm).toHaveBeenCalledTimes(1);
    // Cancelled by the palette itself: `Link` never navigates a cancelled click.
    expect(click.target).toBe(options(view.container)[0]);
    expect(click.cancelled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(options(view.container)).toHaveLength(TOTAL_ENTRIES);
  });

  it("navigates once the Context leave-confirm is accepted", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render();

    const click = observeClick(() => press(input(view.container), "Enter"));

    expect(click.target?.getAttribute("href")).toBe(`/p/${PROJECT_ID}/overview`);
    expect(click.cancelled).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("scrolls the newly highlighted entry into view", () => {
    // The listbox is `max-h-80` over 18 entries and focus stays in the input, so
    // nothing scrolls on its own: without this the highlight leaves the viewport
    // after a few ArrowDowns and `aria-activedescendant` points off-screen.
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    const view = render();
    scrollIntoView.mockClear();

    press(input(view.container), "ArrowDown");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    // `block: "nearest"` on the wrong element would still satisfy the call
    // assertion, so pin which option was scrolled.
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(options(view.container)[1]);
  });

  it("leaves keys pressed mid-IME-composition to the IME", () => {
    const view = render();
    const field = input(view.container);

    // While a CJK candidate list is open, Escape cancels it, Enter commits
    // it and the arrows move within it; none of them are for the palette.
    press(field, "ArrowDown", true);
    const click = observeClick(() => press(field, "Enter", true));
    press(field, "Escape", true);

    expect(click.target).toBeNull();

    expect(options(view.container)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options(view.container)[1]?.getAttribute("aria-selected")).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("exposes the input as a combobox and keeps options out of the Tab order", () => {
    const view = render();
    const field = input(view.container);

    expect(field.getAttribute("role")).toBe("combobox");
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(field.getAttribute("aria-autocomplete")).toBe("list");
    expect(field.getAttribute("aria-controls")).toBe("wb-palette-list");
    for (const option of options(view.container)) {
      expect(option.tabIndex).toBe(-1);
    }
  });
});
