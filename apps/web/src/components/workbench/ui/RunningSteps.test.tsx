/** @vitest-environment jsdom */

/**
 * The run list is the only thing on screen while a module is working, and every
 * part of it is invisible to a screenshot diff: which step the three states land
 * on (an off-by-one paints the step that has not started as finished), the live
 * region that tells a screen reader something is happening at all, and the
 * `motion-reduce` escape on the pulsing dot.
 *
 * The three states are derived here from one index rather than passed in per
 * step, so these cases pin that derivation — a caller cannot get it wrong, and
 * it is the one piece of logic in the file.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RunningSteps } from "./RunningSteps.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const STEPS = ["Crawl signals", "GSC rows", "Third-party metrics", "Assemble"] as const;

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

function states(scope: HTMLElement): readonly (string | null)[] {
  return [...scope.querySelectorAll("[data-wb-step]")].map((node) =>
    node.getAttribute("data-wb-step"),
  );
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("RunningSteps", () => {
  it("marks the steps before the current one done, the current one now and the rest pending", () => {
    const scope = render(<RunningSteps progress={{ steps: [...STEPS], current: 2 }} />);

    expect(states(scope)).toEqual(["done", "done", "now", "pending"]);
    expect(scope.textContent).toContain("Third-party metrics");
  });

  it("has nothing running on the first step yet", () => {
    const scope = render(<RunningSteps progress={{ steps: [...STEPS], current: 0 }} />);

    expect(states(scope)).toEqual(["now", "pending", "pending", "pending"]);
  });

  it("shows every step done once the index has passed the last one", () => {
    const scope = render(<RunningSteps progress={{ steps: [...STEPS], current: STEPS.length }} />);

    expect(states(scope)).toEqual(["done", "done", "done", "done"]);
  });

  it("announces itself politely, so a screen reader is told the run advanced", () => {
    const scope = render(<RunningSteps progress={{ steps: [...STEPS], current: 1 }} />);

    const live = scope.querySelector("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    // The list is the live region, not a wrapper around it: a region that does
    // not contain the steps announces nothing when they change.
    expect(live?.querySelectorAll("[data-wb-step]")).toHaveLength(STEPS.length);
  });

  it("pulses only the current step, and not for a reader who asked for less motion", () => {
    const scope = render(<RunningSteps progress={{ steps: [...STEPS], current: 2 }} />);

    const pulsing = [...scope.querySelectorAll(".animate-pulse")];
    expect(pulsing).toHaveLength(1);
    expect(pulsing[0]?.closest("[data-wb-step]")?.getAttribute("data-wb-step")).toBe("now");
    expect(pulsing[0]?.classList.contains("motion-reduce:animate-none")).toBe(true);
  });

  it("tells done and pending apart by more than colour", () => {
    // WCAG 1.4.1: the dot is filled when the step is finished and an outline
    // while it is still waiting, so the two do not differ by hue alone.
    const scope = render(<RunningSteps progress={{ steps: [...STEPS], current: 2 }} />);
    const dotOf = (state: string): Element | null =>
      scope.querySelector(`[data-wb-step="${state}"] [aria-hidden="true"]`);

    expect(dotOf("pending")?.className).toMatch(/\bborder\b/u);
    expect(dotOf("done")?.className).not.toMatch(/\bborder\b/u);
  });

  it("renders nothing at all for an empty step list", () => {
    const scope = render(<RunningSteps progress={{ steps: [], current: 0 }} />);

    expect(states(scope)).toEqual([]);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(<RunningSteps progress={{ steps: [...STEPS], current: 1 }} />);

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
