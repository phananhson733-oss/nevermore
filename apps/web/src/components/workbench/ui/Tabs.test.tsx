/** @vitest-environment jsdom */

/**
 * A segmented control that looks right but is not a tablist is the failure this
 * file exists to prevent: the roles and `aria-selected` are what a screen reader
 * reads, the roving tabindex is what makes the group one Tab stop, and the arrow
 * keys are the only way a keyboard user inside the group changes tabs. All four
 * are invisible in a screenshot.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, type TabItem } from "./Tabs.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TABS: readonly TabItem[] = [
  ["doc", "Profile"],
  ["json", "JSON"],
  ["ctx", "AI context"],
];

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

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("Tabs", () => {
  it("is a labelled tablist whose selected tab is the only one selected", () => {
    const scope = render(<Tabs tabs={TABS} value="json" onChange={vi.fn()} label="Output view" />);
    const list = scope.querySelector('[role="tablist"]');

    expect(list?.getAttribute("aria-label")).toBe("Output view");
    expect(tabsOf(scope).map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabsOf(scope).map((t) => t.textContent)).toEqual(["Profile", "JSON", "AI context"]);
  });

  it("keeps one Tab stop by roving the tabindex to the selected tab", () => {
    const scope = render(<Tabs tabs={TABS} value="json" onChange={vi.fn()} label="Output view" />);

    expect(tabsOf(scope).map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("selects a tab on click", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = render(<Tabs tabs={TABS} value="doc" onChange={onChange} label="Output view" />);

    act(() => tabsOf(scope)[2]?.click());

    expect(onChange.mock.calls).toEqual([["ctx"]]);
  });

  it("moves to the next tab on ArrowRight and takes focus with it", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = render(<Tabs tabs={TABS} value="doc" onChange={onChange} label="Output view" />);
    const list = scope.querySelector('[role="tablist"]');

    const prevented = keydown(list as HTMLElement, "ArrowRight");

    expect(onChange.mock.calls).toEqual([["json"]]);
    expect(document.activeElement).toBe(tabsOf(scope)[1]);
    // Otherwise the arrow also scrolls the page.
    expect(prevented).toBe(true);
  });

  it("wraps from the first tab to the last on ArrowLeft", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = render(<Tabs tabs={TABS} value="doc" onChange={onChange} label="Output view" />);

    keydown(scope.querySelector('[role="tablist"]') as HTMLElement, "ArrowLeft");

    expect(onChange.mock.calls).toEqual([["ctx"]]);
    expect(document.activeElement).toBe(tabsOf(scope)[2]);
  });

  it("leaves other keys alone", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = render(<Tabs tabs={TABS} value="doc" onChange={onChange} label="Output view" />);

    const prevented = keydown(scope.querySelector('[role="tablist"]') as HTMLElement, "ArrowDown");

    expect(onChange).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("lets the IME keep a composing arrow key", () => {
    // Mid-composition arrows move within the candidate list; stealing them
    // would change tabs while the reader is still choosing a character.
    const onChange = vi.fn<(id: string) => void>();
    const scope = render(<Tabs tabs={TABS} value="doc" onChange={onChange} label="Output view" />);

    const prevented = keydown(scope.querySelector('[role="tablist"]') as HTMLElement, "ArrowRight", true);

    expect(onChange).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("does nothing when the selected id is not one of the tabs", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = render(<Tabs tabs={TABS} value="gone" onChange={onChange} label="Output view" />);

    keydown(scope.querySelector('[role="tablist"]') as HTMLElement, "ArrowRight");

    expect(onChange).not.toHaveBeenCalled();
    expect(tabsOf(scope).map((t) => t.tabIndex)).toEqual([-1, -1, -1]);
  });

  it("gives the inverted selected tab its own focus ring", () => {
    // `.wb-reset :focus-visible` uses currentColor, which is white on this fill.
    const scope = render(<Tabs tabs={TABS} value="doc" onChange={vi.fn()} label="Output view" />);
    const selected = tabsOf(scope)[0];

    expect(selected?.className).toContain("text-white");
    expect(selected?.className).toMatch(/focus-visible:outline-/);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(<Tabs tabs={TABS} value="doc" onChange={vi.fn()} label="Output view" />);

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
