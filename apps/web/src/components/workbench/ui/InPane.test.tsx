/** @vitest-environment jsdom */

/**
 * The input pane is a shell, so what can go wrong is silent: a header rule that
 * stops being drawn (Tailwind runs without preflight, `.wb-reset` zeroes border
 * widths), a note or a footer that renders its wrapper when there is nothing to
 * put in it, and a title that is not a heading — which costs a screen-reader
 * user the only way to jump between the two panes of a view.
 *
 * The class assertions are against the shared constants rather than against
 * spelled-out class names: a pane that hand-rolls its own border is exactly the
 * drift `panel.ts` exists to prevent.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { InPane } from "./InPane.tsx";
import {
  PANEL_BODY,
  PANEL_FOOT,
  PANEL_HEAD,
  PANEL_SHELL,
  PANEL_TAG,
  PANEL_TITLE,
} from "./panel.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Every class of `constant` is on `element` (twMerge would have dropped a conflicting one). */
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

describe("InPane", () => {
  it("wears the shared shell, header, body and footer classes", () => {
    const scope = render(
      <InPane
        title="Basics"
        tag="Input"
        footer={<button type="button">Run</button>}
      >
        <p>fields</p>
      </InPane>,
    );

    const shell = scope.querySelector("section");
    expect(wears(shell, PANEL_SHELL), shell?.className).toBe(true);
    expect(wears(scope.querySelector("[data-wb-pane-head]"), PANEL_HEAD)).toBe(
      true,
    );
    expect(wears(scope.querySelector("[data-wb-pane-body]"), PANEL_BODY)).toBe(
      true,
    );
    expect(wears(scope.querySelector("[data-wb-pane-foot]"), PANEL_FOOT)).toBe(
      true,
    );
  });

  it("titles the pane with a heading and tags it with the caller's word", () => {
    const scope = render(
      <InPane title="Basics" tag="Input">
        <p>fields</p>
      </InPane>,
    );

    const heading = scope.querySelector("h2");
    expect(heading?.textContent).toBe("Basics");
    expect(wears(heading, PANEL_TITLE)).toBe(true);
    const tag = scope.querySelector("[data-wb-pane-head] span");
    expect(tag?.textContent).toBe("Input");
    expect(wears(tag, PANEL_TAG)).toBe(true);
  });

  it("renders the note above the children when there is one", () => {
    const scope = render(
      <InPane title="Basics" note="Everything here feeds the modules.">
        <p>fields</p>
      </InPane>,
    );

    expect(scope.textContent).toContain("Everything here feeds the modules.");
    const body = scope.querySelector("[data-wb-pane-body]");
    // Order matters: a note under the fields is a footnote, not an intro.
    expect(body?.firstElementChild?.textContent).toBe(
      "Everything here feeds the modules.",
    );
  });

  it("renders no tag, note or footer wrapper when it was given none", () => {
    const scope = render(
      <InPane title="Basics">
        <p>fields</p>
      </InPane>,
    );

    expect(scope.querySelectorAll("[data-wb-pane-foot]")).toHaveLength(0);
    expect(scope.querySelector("[data-wb-pane-head]")?.textContent).toBe(
      "Basics",
    );
    expect(scope.querySelector("[data-wb-pane-body]")?.textContent).toBe(
      "fields",
    );
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(
      <InPane
        title="Basics"
        tag="Input"
        note="A note"
        footer={<span>foot</span>}
      >
        <p>fields</p>
      </InPane>,
    );

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
