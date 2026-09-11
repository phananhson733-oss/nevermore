/** @vitest-environment jsdom */

/**
 * The palette's contract is interaction, not markup: what the query filters,
 * where the highlight lands, what Enter navigates to, and whether a dirty
 * Context editor can be abandoned without a confirm. None of that is reachable
 * from static markup, so the real component is driven through `createRoot` with
 * only the router and the unsaved-changes probe stubbed.
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
  push: vi.fn(),
  hasUnsavedContextChanges: vi.fn<() => boolean>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
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
  mocks.push.mockReset();
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

  it("navigates to the highlighted entry on Enter and closes", () => {
    const view = render();
    press(input(view.container), "ArrowDown");

    expect(options(view.container)[1]?.getAttribute("aria-selected")).toBe("true");

    press(input(view.container), "Enter");

    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/p/${PROJECT_ID}/week`);
    expect(onClose).toHaveBeenCalledTimes(1);
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

    press(input(view.container), "Enter");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(options(view.container)).toHaveLength(TOTAL_ENTRIES);
  });

  it("navigates once the Context leave-confirm is accepted", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render();

    press(input(view.container), "Enter");

    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      `/p/${PROJECT_ID}/overview`,
    );
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
    press(field, "Enter", true);
    press(field, "Escape", true);

    expect(options(view.container)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options(view.container)[1]?.getAttribute("aria-selected")).toBe("false");
    expect(mocks.push).not.toHaveBeenCalled();
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
