/** @vitest-environment jsdom */

/**
 * A segmented control that looks right but is not a tablist is the failure this
 * file exists to prevent: the roles and `aria-selected` are what a screen reader
 * reads, the roving tabindex is what makes the group one Tab stop, the arrow keys
 * are the only way a keyboard user inside the group changes tabs, and the
 * `id`/`aria-controls` pair is the only thing tying a tab to its panel. All of it
 * is invisible in a screenshot, and axe flags none of it.
 *
 * The harness renders the panels the way the consuming pane will (built from the
 * exported id helpers) so the pointers can be followed through the real DOM
 * instead of being compared against the same function that produced them.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, tabButtonId, tabPanelId, type TabItem } from "./Tabs.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TABS: readonly TabItem[] = [
  ["doc", "Profile"],
  ["json", "JSON"],
  ["ctx", "AI context"],
];
const PREFIX = "wb-profile-output";

let cleanup: (() => void) | null = null;

function render(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

const ALL_IDS = TABS.map(([id]) => id);

/**
 * Tabs plus the panels a caller renders for them. `renderedIds` is BOTH what
 * the component is told and what this fixture actually puts in the DOM, so the
 * two cannot disagree here — which is also why nothing in this file can catch a
 * caller that renders fewer panels than it declares. That gate is at the seam,
 * in OutPane.test.tsx (裁决 Q34).
 */
function renderTabs(
  value: string,
  onChange: (id: string) => void = vi.fn(),
  renderedIds: readonly string[] = ALL_IDS,
): HTMLElement {
  return render(
    <>
      <Tabs
        tabs={TABS}
        value={value}
        onChange={onChange}
        label="Output view"
        idPrefix={PREFIX}
        renderedIds={renderedIds}
      />
      {TABS.filter(([id]) => renderedIds.includes(id)).map(([id, text]) => (
        <div
          key={id}
          id={tabPanelId(PREFIX, id)}
          role="tabpanel"
          aria-labelledby={tabButtonId(PREFIX, id)}
        >
          {text} body
        </div>
      ))}
    </>,
  );
}

function tabsOf(scope: HTMLElement): readonly HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

/** Dispatches a real keydown so the IME flag can be set on the native event. */
function keydown(el: HTMLElement, key: string, isComposing = false): boolean {
  const event = new KeyboardEvent("keydown", { key, isComposing, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function tablistOf(scope: HTMLElement): HTMLElement {
  const list = scope.querySelector<HTMLElement>('[role="tablist"]');
  if (list === null) throw new Error("no tablist rendered");
  return list;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("Tabs", () => {
  it("is a labelled tablist whose selected tab is the only one selected", () => {
    const scope = renderTabs("json");

    expect(tablistOf(scope).getAttribute("aria-label")).toBe("Output view");
    expect(tabsOf(scope).map((t) => t.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(tabsOf(scope).map((t) => t.textContent)).toEqual(["Profile", "JSON", "AI context"]);
  });

  it("keeps one Tab stop by roving the tabindex to the selected tab", () => {
    const scope = renderTabs("json");

    expect(tabsOf(scope).map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("points each tab at its own panel, and the panel back at the tab", () => {
    // Followed through the DOM: a mismatched `aria-controls` resolves to the
    // wrong element (or to nothing), which comparing two calls of the same id
    // helper would never notice.
    const scope = renderTabs("json");

    const pointing = tabsOf(scope).filter((tab) => tab.hasAttribute("aria-controls"));
    // Every panel is in the DOM in this fixture, so every tab must point.
    expect(pointing).toHaveLength(TABS.length);
    for (const tab of pointing) {
      const controls = tab.getAttribute("aria-controls") ?? "";
      const panel = document.getElementById(controls);

      expect(panel, `aria-controls ${controls}`).not.toBeNull();
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(document.getElementById(panel?.getAttribute("aria-labelledby") ?? "")).toBe(tab);
      expect(tab.id).not.toBe(controls);
    }

    const ids = tabsOf(scope).map((t) => t.id);
    expect(ids.every((id) => id.startsWith(PREFIX))).toBe(true);
    expect(new Set(ids).size).toBe(TABS.length);
  });

  it("points at no panel that the caller has not rendered", () => {
    // 裁决 Q34: OutPane renders one panel at a time, so the other tabs must
    // carry no pointer at all rather than one aimed at an absent id.
    const scope = renderTabs("json", vi.fn(), ["json"]);

    const pointing = tabsOf(scope).filter((tab) => tab.hasAttribute("aria-controls"));
    expect(pointing.map((tab) => tab.textContent)).toEqual(["JSON"]);
    expect(document.getElementById(pointing[0]?.getAttribute("aria-controls") ?? "")).not.toBeNull();
    // The tabs themselves stay whole: same count, same roles, same labels.
    expect(tabsOf(scope)).toHaveLength(TABS.length);
  });

  it("selects a tab on click", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = renderTabs("doc", onChange);

    act(() => tabsOf(scope)[2]?.click());

    expect(onChange.mock.calls).toEqual([["ctx"]]);
  });

  it("moves to the next tab on ArrowRight and takes focus with it", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = renderTabs("doc", onChange);

    const prevented = keydown(tablistOf(scope), "ArrowRight");

    expect(onChange.mock.calls).toEqual([["json"]]);
    expect(document.activeElement).toBe(tabsOf(scope)[1]);
    // Otherwise the arrow also scrolls the page.
    expect(prevented).toBe(true);
  });

  it("wraps from the first tab to the last on ArrowLeft", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = renderTabs("doc", onChange);

    keydown(tablistOf(scope), "ArrowLeft");

    expect(onChange.mock.calls).toEqual([["ctx"]]);
    expect(document.activeElement).toBe(tabsOf(scope)[2]);
  });

  it("leaves other keys alone", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = renderTabs("doc", onChange);

    const prevented = keydown(tablistOf(scope), "ArrowDown");

    expect(onChange).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("lets the IME keep a composing arrow key", () => {
    // Mid-composition arrows move within the candidate list; stealing them
    // would change tabs while the reader is still choosing a character.
    const onChange = vi.fn<(id: string) => void>();
    const scope = renderTabs("doc", onChange);

    const prevented = keydown(tablistOf(scope), "ArrowRight", true);

    expect(onChange).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("does nothing when the selected id is not one of the tabs", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = renderTabs("gone", onChange);

    keydown(tablistOf(scope), "ArrowRight");

    expect(onChange).not.toHaveBeenCalled();
    expect(tabsOf(scope).map((t) => t.tabIndex)).toEqual([-1, -1, -1]);
  });

  it("fills the selected tab from the ink token and gives it its own focus ring", () => {
    // The token, not a look-alike literal: `bg-slate-900` renders the same today
    // and silently leaves the theme. `.wb-reset :focus-visible` uses
    // currentColor, which is white on this fill.
    const scope = renderTabs("doc");
    const selected = tabsOf(scope)[0];

    expect(selected?.className).toContain("bg-wb-ink");
    expect(selected?.className).toContain("text-white");
    expect(selected?.className).toMatch(/focus-visible:outline-/);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = renderTabs("doc");

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
