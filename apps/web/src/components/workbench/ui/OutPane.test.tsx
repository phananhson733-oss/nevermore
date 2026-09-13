/** @vitest-environment jsdom */

/**
 * The output pane is a three-way state machine (running / has content / empty)
 * and every wrong branch looks plausible on screen: children rendered under the
 * run list says a finished result is already there, and an empty state rendered
 * next to content says the opposite. So each case asserts what is NOT rendered
 * as well as what is.
 *
 * The tabs half is the seam with `Tabs`: the pointer between a tab and its panel
 * is followed through the DOM (the panel is this component's, the tab is Tabs's),
 * because two hand-built halves of the same id is how that pointer goes stale.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutPane, type OutPaneTabs } from "./OutPane.tsx";
import { PANEL_FOOT, PANEL_HEAD, PANEL_SHELL } from "./panel.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PREFIX = "wb-profile-output";
const EMPTY = <p>Nothing generated yet</p>;
const CONTENT = <p>the report</p>;

function tabsProp(value: string, onChange = vi.fn<(id: string) => void>()): OutPaneTabs {
  return {
    items: [
      ["doc", "Profile"],
      ["json", "JSON"],
    ],
    value,
    onChange,
    label: "Output view",
    idPrefix: PREFIX,
  };
}

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

function wears(element: Element | null, constant: string): boolean {
  if (element === null) return false;
  return constant
    .split(/\s+/u)
    .filter(Boolean)
    .every((name) => element.classList.contains(name));
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("OutPane", () => {
  it("wears the shared shell, header and footer classes", () => {
    const scope = render(
      <OutPane title="Profile" tag="Output" hasContent empty={EMPTY} footer={<span>foot</span>}>
        {CONTENT}
      </OutPane>,
    );

    expect(wears(scope.querySelector("section"), PANEL_SHELL)).toBe(true);
    expect(wears(scope.querySelector("[data-wb-pane-head]"), PANEL_HEAD)).toBe(true);
    expect(wears(scope.querySelector("[data-wb-pane-foot]"), PANEL_FOOT)).toBe(true);
    expect(scope.querySelector("h2")?.textContent).toBe("Profile");
  });

  it("shows the run list while a run is in flight, and neither the content nor the empty state", () => {
    const scope = render(
      <OutPane
        title="Profile"
        hasContent
        run={{ steps: ["Crawl signals", "Assemble"], current: 1 }}
        empty={EMPTY}
      >
        {CONTENT}
      </OutPane>,
    );

    expect(scope.querySelectorAll("[data-wb-step]")).toHaveLength(2);
    expect(scope.textContent).not.toContain("the report");
    expect(scope.textContent).not.toContain("Nothing generated yet");
  });

  it("shows the content once there is some", () => {
    const scope = render(
      <OutPane title="Profile" hasContent empty={EMPTY}>
        {CONTENT}
      </OutPane>,
    );

    expect(scope.textContent).toContain("the report");
    expect(scope.textContent).not.toContain("Nothing generated yet");
    expect(scope.querySelectorAll("[data-wb-step]")).toHaveLength(0);
  });

  it("shows the empty state when there is no content, and not the children", () => {
    const scope = render(
      <OutPane title="Profile" hasContent={false} empty={EMPTY}>
        {CONTENT}
      </OutPane>,
    );

    expect(scope.textContent).toContain("Nothing generated yet");
    expect(scope.textContent).not.toContain("the report");
  });

  it("renders the tabs only when there is more than one", () => {
    const single = render(
      <OutPane
        title="Profile"
        hasContent
        empty={EMPTY}
        tabs={{ ...tabsProp("doc"), items: [["doc", "Profile"]] }}
      >
        {CONTENT}
      </OutPane>,
    );
    expect(single.querySelectorAll('[role="tablist"]')).toHaveLength(0);
    expect(single.querySelectorAll('[role="tab"]')).toHaveLength(0);
    cleanup?.();
    cleanup = null;

    const many = render(
      <OutPane title="Profile" hasContent empty={EMPTY} tabs={tabsProp("doc")}>
        {CONTENT}
      </OutPane>,
    );
    expect(many.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it("ties the body to the selected tab in both directions", () => {
    const scope = render(
      <OutPane title="Profile" hasContent empty={EMPTY} tabs={tabsProp("json")}>
        {CONTENT}
      </OutPane>,
    );

    const panel = scope.querySelector('[role="tabpanel"]');
    const labelledBy = panel?.getAttribute("aria-labelledby") ?? "";
    const tab = document.getElementById(labelledBy);
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    expect(tab?.textContent).toBe("JSON");
    expect(tab?.getAttribute("aria-controls")).toBe(panel?.id);
    expect(panel?.textContent).toContain("the report");
  });

  it("passes the tab change straight through", () => {
    const onChange = vi.fn<(id: string) => void>();
    const scope = render(
      <OutPane title="Profile" hasContent empty={EMPTY} tabs={tabsProp("doc", onChange)}>
        {CONTENT}
      </OutPane>,
    );

    act(() => scope.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click());

    expect(onChange.mock.calls).toEqual([["json"]]);
  });

  it("marks no body as a tabpanel when it renders no tabs", () => {
    // A lone `role="tabpanel"` with no tablist is a promise to a screen reader
    // that there are tabs to move between.
    const scope = render(
      <OutPane title="Profile" hasContent empty={EMPTY}>
        {CONTENT}
      </OutPane>,
    );

    expect(scope.querySelectorAll('[role="tabpanel"]')).toHaveLength(0);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(
      <OutPane
        title="Profile"
        tag="Output"
        hasContent
        empty={EMPTY}
        tabs={tabsProp("doc")}
        footer={<span>foot</span>}
      >
        {CONTENT}
      </OutPane>,
    );

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
