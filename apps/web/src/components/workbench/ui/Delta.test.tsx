/** @vitest-environment jsdom */

/**
 * Three branches and one absence. The absence is the interesting one: with no
 * comparison point there is no delta, and anything rendered there — a dash, a
 * zero, an empty badge — claims a measurement that was never made.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Delta } from "./Delta.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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

describe("Delta", () => {
  it("signs a rise and colours it up", () => {
    const scope = render(<Delta value={7} />);
    const span = scope.querySelector("span");

    expect(span?.textContent).toBe("+7");
    expect(span?.className).toContain("text-emerald-700");
  });

  it("keeps the minus sign on a fall and colours it down", () => {
    const scope = render(<Delta value={-2} />);
    const span = scope.querySelector("span");

    expect(span?.textContent).toBe("-2");
    expect(span?.className).toContain("text-rose-700");
  });

  it("shows an unchanged metric as a neutral zero with no sign", () => {
    const scope = render(<Delta value={0} />);
    const span = scope.querySelector("span");

    expect(span?.textContent).toBe("0");
    expect(span?.className).toContain("text-slate-500");
    expect(span?.className).not.toContain("emerald");
    expect(span?.className).not.toContain("rose");
  });

  it("appends the unit the caller gave", () => {
    const scope = render(<Delta value={6} unit="pt" />);

    expect(scope.querySelector("span")?.textContent).toBe("+6pt");
  });

  it("renders nothing when there is nothing to compare against", () => {
    const scope = render(<Delta value={null} />);

    expect(scope.textContent).toBe("");
    expect(scope.childElementCount).toBe(0);
  });

  it("renders nothing for a value that is not a number", () => {
    const scope = render(<Delta value={Number.NaN} />);

    expect(scope.textContent).toBe("");
    expect(scope.childElementCount).toBe(0);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(<Delta value={7} unit="pt" />);

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
