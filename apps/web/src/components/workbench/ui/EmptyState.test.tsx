/** @vitest-environment jsdom */

/**
 * The empty state's job is to render the caller's two sentences and nothing
 * else. "Nothing else" is the assertion that matters: a sentence added inside
 * the component would appear under every empty panel in the workbench, and the
 * one thing it could not honestly do there is name a cause — an empty panel has
 * several, and only the view knows which ones apply.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TITLE = "Nothing here yet";
const DETAIL = "This panel fills in once there is something to show.";

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

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("EmptyState", () => {
  it("renders the title and the detail, and adds no copy of its own", () => {
    const scope = render(<EmptyState title={TITLE} detail={DETAIL} />);
    const paragraphs = Array.from(scope.querySelectorAll("p")).map((p) => p.textContent);

    expect(paragraphs).toEqual([TITLE, DETAIL]);
    expect(scope.textContent).toBe(`${TITLE}${DETAIL}`);
  });

  it("renders the action the caller gives it", () => {
    const scope = render(
      <EmptyState title={TITLE} detail={DETAIL} action={<button type="button">Load sample site</button>} />,
    );

    expect(scope.querySelector("button")?.textContent).toBe("Load sample site");
  });

  it("renders no action slot when there is no action", () => {
    const scope = render(<EmptyState title={TITLE} detail={DETAIL} />);

    expect(scope.querySelector("button")).toBeNull();
    // Title and detail only: no empty wrapper left behind to space the layout.
    expect(scope.firstElementChild?.childElementCount).toBe(2);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(<EmptyState title={TITLE} detail={DETAIL} action={<span>x</span>} />);

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
